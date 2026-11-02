/**
 * Sends notification email through Microsoft Graph (POST /users/{sender}/sendMail)
 * using the app-only (client credentials) flow. This is the sender CPL's Azure
 * deployment uses, so no third-party mail service is needed.
 *
 * Required environment:
 *   GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET — an Entra app
 *     registration with the *application* permission Mail.Send (admin consent).
 *   GRAPH_SENDER — the mailbox the mail is sent from (a shared mailbox such as
 *     feasibility@cplaromas.com). Restrict the app to that mailbox with an
 *     Exchange Application Access Policy; see docs/deployment-guide.md.
 *
 * NOT VERIFIED AGAINST A REAL TENANT: the request shapes follow Microsoft's
 * documented API and are unit-tested with an injected fetch, but the first
 * real send must be checked on CPL's tenant (deployment guide, step "Test
 * email").
 */
import type { SendEmailFn } from "../services/notifications/dispatch-notifications.js";

export class GraphSendError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "GraphSendError";
  }
}

export interface GraphMailConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  sender: string;
}

export function graphConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): GraphMailConfig | null {
  const { GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET, GRAPH_SENDER } = env;
  if (!GRAPH_TENANT_ID || !GRAPH_CLIENT_ID || !GRAPH_CLIENT_SECRET || !GRAPH_SENDER) {
    return null;
  }
  return {
    tenantId: GRAPH_TENANT_ID,
    clientId: GRAPH_CLIENT_ID,
    clientSecret: GRAPH_CLIENT_SECRET,
    sender: GRAPH_SENDER,
  };
}

type FetchFn = typeof fetch;

export function createGraphSender(
  config: GraphMailConfig,
  fetchImpl: FetchFn = fetch,
  now: () => number = Date.now,
): SendEmailFn {
  let token: { value: string; expiresAt: number } | null = null;

  async function getToken(): Promise<string> {
    if (token && token.expiresAt - 60_000 > now()) return token.value;
    const response = await fetchImpl(
      `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "https://graph.microsoft.com/.default",
          grant_type: "client_credentials",
        }),
      },
    );
    if (!response.ok) {
      throw new GraphSendError(
        `Microsoft token request failed (${response.status}): ${await safeText(response)}`,
        response.status,
      );
    }
    const body = (await response.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token)
      throw new GraphSendError("Microsoft token response had no access_token");
    token = {
      value: body.access_token,
      expiresAt: now() + (body.expires_in ?? 3600) * 1000,
    };
    return token.value;
  }

  return async (message) => {
    const accessToken = await getToken();
    const response = await fetchImpl(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.sender)}/sendMail`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          saveToSentItems: false,
        }),
      },
    );
    if (response.status === 401) token = null; // force a fresh token next attempt
    if (!response.ok) {
      throw new GraphSendError(
        `Microsoft Graph sendMail failed (${response.status}): ${await safeText(response)}`,
        response.status,
      );
    }
  };
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 500);
  } catch {
    return "";
  }
}
