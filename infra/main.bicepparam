using './main.bicep'

// Fill these in. Secrets can be supplied on the command line instead of here:
//   az deployment group create ... -p postgresAdminPassword="$(openssl rand -base64 24)" ...
param namePrefix = 'cplfeas'
param appServiceSku = 'P0v3'
param entraTenantId = '<CPL Entra tenant id>'
param entraClientId = '<sign-in app registration client id>'
param entraClientSecret = readEnvironmentVariable('ENTRA_CLIENT_SECRET', '')
param graphClientId = '<mail app registration client id>'
param graphClientSecret = readEnvironmentVariable('GRAPH_CLIENT_SECRET', '')
param authSecret = readEnvironmentVariable('AUTH_SECRET', '')
param cronSecret = readEnvironmentVariable('CRON_SECRET', '')
param graphSender = 'feasibility@cplaromas.com'
param postgresAdminPassword = readEnvironmentVariable('POSTGRES_ADMIN_PASSWORD', '')
// param publicUrl = 'https://feasibility.cplaromas.com'   // once a custom domain is set up
// param keyVaultAdminObjectId = '<object id of the IT admins group>'
