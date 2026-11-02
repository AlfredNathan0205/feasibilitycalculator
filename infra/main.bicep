// CPL Project Feasibility Calculator — Azure infrastructure (resource-group scope).
//
// Creates: virtual network, Azure Database for PostgreSQL Flexible Server
// (private, VNet-integrated), Azure Container Registry, Key Vault, App Service
// (Linux container) with a managed identity, Log Analytics + Application
// Insights, and a Logic App that calls the notification dispatcher every 5
// minutes (the Azure replacement for Vercel Cron).
//
// Deploy:   az deployment group create -g <rg> -f infra/main.bicep -p infra/main.bicepparam
// See docs/deployment-guide.md for the full procedure and prerequisites.
//
// NOT DEPLOYED BY THE BUILDER: this template compiles and lints cleanly
// (az bicep build / bicep lint) but has not been run against a live
// subscription. Expect to review names, SKUs and policies with CPL IT.

targetScope = 'resourceGroup'

@description('Short lowercase prefix used in resource names, 3-12 letters/digits (e.g. cplfeas).')
@minLength(3)
@maxLength(12)
param namePrefix string

@description('Azure region. Defaults to the resource group region.')
param location string = resourceGroup().location

@description('Container image tag deployed to the web app, e.g. 1.0.0. Build and push it first (guide step 5).')
param imageTag string = 'latest'

@description('App Service plan SKU. B1 is fine for testing; P0v3 or higher for production.')
param appServiceSku string = 'P0v3'

@description('PostgreSQL Flexible Server SKU name and tier.')
param postgresSkuName string = 'Standard_B2s'
@allowed(['Burstable', 'GeneralPurpose', 'MemoryOptimized'])
param postgresSkuTier string = 'Burstable'
@description('PostgreSQL storage in GB.')
param postgresStorageGb int = 32

@description('PostgreSQL administrator login.')
param postgresAdminLogin string = 'cpladmin'
@secure()
@description('PostgreSQL administrator password (stored in Key Vault).')
param postgresAdminPassword string

@description('Entra ID tenant ID used for staff sign-in.')
param entraTenantId string
@description('Application (client) ID of the Entra app registration for sign-in.')
param entraClientId string
@secure()
@description('Client secret of the Entra sign-in app registration (stored in Key Vault).')
param entraClientSecret string

@description('Entra app registration (client) ID used to send mail via Microsoft Graph (Mail.Send).')
param graphClientId string
@secure()
@description('Client secret of the Graph mail app registration (stored in Key Vault).')
param graphClientSecret string
@description('Mailbox notifications are sent from, e.g. feasibility@cplaromas.com.')
param graphSender string

@secure()
@description('Random secret that signs session tokens (openssl rand -hex 32). Stored in Key Vault.')
param authSecret string
@secure()
@description('Random shared secret for the scheduled notification dispatcher (openssl rand -hex 32). Stored in Key Vault.')
param cronSecret string

@description('Public URL users will browse to. Leave empty to use the default https://<app>.azurewebsites.net. Set it when you add a custom domain.')
param publicUrl string = ''

@description('Object ID of the group/user given Key Vault Secrets Officer (to rotate secrets). Optional.')
param keyVaultAdminObjectId string = ''

var suffix = uniqueString(resourceGroup().id)
var appName = '${namePrefix}-web-${take(suffix, 5)}'
var kvName = take('${namePrefix}-kv-${suffix}', 24)
var acrName = take('${namePrefix}acr${suffix}', 50)
var pgName = '${namePrefix}-pg-${take(suffix, 5)}'
var defaultUrl = 'https://${appName}.azurewebsites.net'
var effectiveUrl = empty(publicUrl) ? defaultUrl : publicUrl
var pgDnsZone = '${namePrefix}${take(suffix, 5)}.private.postgres.database.azure.com'
var databaseName = 'feasibility'
var loginEndpoint = environment().authentication.loginEndpoint

// ---- Identity -------------------------------------------------------------
resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${namePrefix}-id'
  location: location
}

// ---- Network --------------------------------------------------------------
resource vnet 'Microsoft.Network/virtualNetworks@2023-11-01' = {
  name: '${namePrefix}-vnet'
  location: location
  properties: {
    addressSpace: { addressPrefixes: ['10.20.0.0/16'] }
    subnets: [
      {
        name: 'snet-app'
        properties: {
          addressPrefix: '10.20.1.0/24'
          delegations: [
            { name: 'web', properties: { serviceName: 'Microsoft.Web/serverFarms' } }
          ]
        }
      }
      {
        name: 'snet-db'
        properties: {
          addressPrefix: '10.20.2.0/24'
          delegations: [
            {
              name: 'pg'
              properties: { serviceName: 'Microsoft.DBforPostgreSQL/flexibleServers' }
            }
          ]
        }
      }
      {
        // For one-off migration/seed jobs (Azure Container Instances) that must reach the private database.
        name: 'snet-jobs'
        properties: {
          addressPrefix: '10.20.3.0/24'
          delegations: [
            {
              name: 'aci'
              properties: { serviceName: 'Microsoft.ContainerInstance/containerGroups' }
            }
          ]
        }
      }
    ]
  }
}

resource pgDns 'Microsoft.Network/privateDnsZones@2020-06-01' = {
  name: pgDnsZone
  location: 'global'
}

resource pgDnsLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2020-06-01' = {
  parent: pgDns
  name: '${namePrefix}-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: { id: vnet.id }
  }
}

// ---- Database -------------------------------------------------------------
resource pg 'Microsoft.DBforPostgreSQL/flexibleServers@2023-12-01-preview' = {
  name: pgName
  location: location
  sku: { name: postgresSkuName, tier: postgresSkuTier }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: { storageSizeGB: postgresStorageGb }
    backup: { backupRetentionDays: 14, geoRedundantBackup: 'Disabled' }
    highAvailability: { mode: 'Disabled' }
    network: {
      delegatedSubnetResourceId: '${vnet.id}/subnets/snet-db'
      privateDnsZoneArmResourceId: pgDns.id
      publicNetworkAccess: 'Disabled'
    }
  }
  dependsOn: [pgDnsLink]
}

resource db 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-12-01-preview' = {
  parent: pg
  name: databaseName
  properties: { charset: 'UTF8', collation: 'en_US.utf8' }
}

// ---- Registry -------------------------------------------------------------
resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

var acrPullRole = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, identity.id, acrPullRole)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRole)
  }
}

// ---- Key Vault ------------------------------------------------------------
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: kvName
  location: location
  properties: {
    tenantId: subscription().tenantId
    sku: { family: 'A', name: 'standard' }
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

var kvSecretsUserRole = '4633458b-17de-408a-b874-0445c86b69e6'
var kvSecretsOfficerRole = 'b86a8fe4-44ce-4948-aee5-eccb2c155cd7'

resource kvUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: kv
  name: guid(kv.id, identity.id, kvSecretsUserRole)
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsUserRole)
  }
}

resource kvOfficer 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(keyVaultAdminObjectId)) {
  scope: kv
  name: guid(kv.id, keyVaultAdminObjectId, kvSecretsOfficerRole)
  properties: {
    principalId: keyVaultAdminObjectId
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', kvSecretsOfficerRole)
  }
}

// The auth and cron secrets are derived deterministically from the resource group
// and the Postgres password so a redeploy does not change them. Rotate by changing the
// secret value in Key Vault (guide: "Rotating secrets").
resource secAuth 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'auth-secret'
  properties: { value: authSecret }
}
resource secCron 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'cron-secret'
  properties: { value: cronSecret }
}
resource secDb 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'database-url'
  properties: {
    value: 'postgresql://${postgresAdminLogin}:${uriComponent(postgresAdminPassword)}@${pg.properties.fullyQualifiedDomainName}:5432/${databaseName}?sslmode=require'
  }
}
resource secEntra 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'entra-client-secret'
  properties: { value: entraClientSecret }
}
resource secGraph 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: kv
  name: 'graph-client-secret'
  properties: { value: graphClientSecret }
}

// ---- Observability --------------------------------------------------------
resource logs 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: '${namePrefix}-logs'
  location: location
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 90 }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-ai'
  location: location
  kind: 'web'
  properties: { Application_Type: 'web', WorkspaceResourceId: logs.id }
}

// ---- Web app --------------------------------------------------------------
resource plan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${namePrefix}-plan'
  location: location
  kind: 'linux'
  sku: { name: appServiceSku }
  properties: { reserved: true }
}

func kvRef(vaultName string, secretName string) string =>
  '@Microsoft.KeyVault(SecretUri=https://${vaultName}${environment().suffixes.keyvaultDns}/secrets/${secretName}/)'

resource web 'Microsoft.Web/sites@2023-12-01' = {
  name: appName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: { '${identity.id}': {} }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    keyVaultReferenceIdentity: identity.id
    virtualNetworkSubnetId: '${vnet.id}/subnets/snet-app'
    vnetRouteAllEnabled: true
    siteConfig: {
      linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/feasibility:${imageTag}'
      acrUseManagedIdentityCreds: true
      acrUserManagedIdentityID: identity.properties.clientId
      alwaysOn: true
      http20Enabled: true
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/api/health'
      appSettings: [
        { name: 'WEBSITES_PORT', value: '3000' }
        { name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE', value: 'false' }
        { name: 'NEXTAUTH_URL', value: effectiveUrl }
        { name: 'AUTH_TRUST_HOST', value: 'true' }
        { name: 'DB_POOL_MAX', value: '5' }
        { name: 'AUTH_SECRET', value: kvRef(kv.name, 'auth-secret') }
        { name: 'CRON_SECRET', value: kvRef(kv.name, 'cron-secret') }
        { name: 'DATABASE_URL', value: kvRef(kv.name, 'database-url') }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ID', value: entraClientId }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_SECRET', value: kvRef(kv.name, 'entra-client-secret') }
        { name: 'AUTH_MICROSOFT_ENTRA_ID_ISSUER', value: '${loginEndpoint}${entraTenantId}/v2.0' }
        { name: 'EMAIL_PROVIDER', value: 'graph' }
        { name: 'GRAPH_TENANT_ID', value: entraTenantId }
        { name: 'GRAPH_CLIENT_ID', value: graphClientId }
        { name: 'GRAPH_CLIENT_SECRET', value: kvRef(kv.name, 'graph-client-secret') }
        { name: 'GRAPH_SENDER', value: graphSender }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
      ]
    }
  }
  dependsOn: [acrPull, kvUser, secAuth, secCron, secDb, secEntra, secGraph]
}

resource webDiag 'Microsoft.Insights/diagnosticSettings@2021-05-01-preview' = {
  scope: web
  name: 'to-log-analytics'
  properties: {
    workspaceId: logs.id
    logs: [
      { category: 'AppServiceHTTPLogs', enabled: true }
      { category: 'AppServiceConsoleLogs', enabled: true }
      { category: 'AppServiceAppLogs', enabled: true }
    ]
    metrics: [{ category: 'AllMetrics', enabled: true }]
  }
}

// ---- Scheduled notification dispatch (replaces Vercel Cron) ---------------
// The same shared secret is stored in Key Vault for the web app and passed to
// the workflow as a secure parameter.
resource dispatchLogic 'Microsoft.Logic/workflows@2019-05-01' = {
  name: '${namePrefix}-dispatch'
  location: location
  properties: {
    state: 'Enabled'
    parameters: {
      cronSecret: { value: cronSecret }
    }
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        cronSecret: { type: 'SecureString' }
      }
      triggers: {
        every5Minutes: {
          type: 'Recurrence'
          recurrence: { frequency: 'Minute', interval: 5 }
        }
      }
      actions: {
        dispatch: {
          type: 'Http'
          runAfter: {}
          inputs: {
            method: 'GET'
            uri: '${effectiveUrl}/api/notifications/dispatch'
            headers: { Authorization: 'Bearer @{parameters(\'cronSecret\')}' }
          }
        }
      }
    }
  }
}

output webAppName string = web.name
output webAppUrl string = effectiveUrl
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output keyVaultName string = kv.name
output postgresServer string = pg.properties.fullyQualifiedDomainName
output jobsSubnetId string = '${vnet.id}/subnets/snet-jobs'
output managedIdentityId string = identity.id
output entraRedirectUri string = '${effectiveUrl}/api/auth/callback/microsoft-entra-id'
