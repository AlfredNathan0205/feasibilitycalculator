import { describe, expect, it, vi } from "vitest";
import { GraphSendError, createGraphSender, graphConfigFromEnv } from "./graph-mail.js";
import { getEmailSender } from "./mail.js";
import { sendEmailViaResend } from "./resend.js";

const config = {
  tenantId: "t-1",
  clientId: "c-1",
  clientSecret: "s-1",
  sender: "feasibility@cplaromas.com",
};
const msg = { to: "a@b.com", subject: "Hi", html: "<p>x</p>", text: "x" };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("createGraphSender", () => {
  it("gets a token then posts sendMail with the right shape", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(new Response(null, { status: 202 }));
    await createGraphSender(config, fetchMock as never)(msg);

    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe("https://login.microsoftonline.com/t-1/oauth2/v2.0/token");
    const form = (tokenInit.body as URLSearchParams).toString();
    expect(form).toContain("grant_type=client_credentials");
    expect(form).toContain("scope=https%3A%2F%2Fgraph.microsoft.com%2F.default");

    const [mailUrl, mailInit] = fetchMock.mock.calls[1]!;
    expect(mailUrl).toBe(
      "https://graph.microsoft.com/v1.0/users/feasibility%40cplaromas.com/sendMail",
    );
    expect(mailInit.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(mailInit.body)).toEqual({
      message: {
        subject: "Hi",
        body: { contentType: "HTML", content: "<p>x</p>" },
        toRecipients: [{ emailAddress: { address: "a@b.com" } }],
      },
      saveToSentItems: false,
    });
  });

  it("caches the token until shortly before expiry", async () => {
    let clock = 0;
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("oauth2")
        ? json({ access_token: "tok", expires_in: 3600 })
        : new Response(null, { status: 202 }),
    );
    const send = createGraphSender(config, fetchMock as never, () => clock);
    await send(msg);
    await send(msg);
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("oauth2")),
    ).toHaveLength(1);
    clock = 3_600_000; // past expiry
    await send(msg);
    expect(
      fetchMock.mock.calls.filter((c) => String(c[0]).includes("oauth2")),
    ).toHaveLength(2);
  });

  it("throws GraphSendError on token and send failures", async () => {
    const tokenFail = vi.fn().mockResolvedValue(json({ error: "invalid_client" }, 401));
    await expect(createGraphSender(config, tokenFail as never)(msg)).rejects.toThrow(
      GraphSendError,
    );

    const sendFail = vi
      .fn()
      .mockResolvedValueOnce(json({ access_token: "tok", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ error: { code: "ErrorAccessDenied" } }, 403));
    await expect(createGraphSender(config, sendFail as never)(msg)).rejects.toThrow(
      /403/,
    );
  });
});

describe("provider selection", () => {
  const graphEnv = {
    GRAPH_TENANT_ID: "t",
    GRAPH_CLIENT_ID: "c",
    GRAPH_CLIENT_SECRET: "s",
    GRAPH_SENDER: "x@y.com",
  };
  it("reads the Graph config only when complete", () => {
    expect(graphConfigFromEnv(graphEnv)).not.toBeNull();
    expect(graphConfigFromEnv({ ...graphEnv, GRAPH_SENDER: undefined })).toBeNull();
  });
  it("defaults to Resend, picks Graph when configured, and honours EMAIL_PROVIDER", () => {
    expect(getEmailSender({})).toBe(sendEmailViaResend);
    expect(getEmailSender(graphEnv)).not.toBe(sendEmailViaResend);
    expect(getEmailSender({ ...graphEnv, EMAIL_PROVIDER: "resend" })).toBe(
      sendEmailViaResend,
    );
    expect(() => getEmailSender({ EMAIL_PROVIDER: "graph" })).toThrow(/needs GRAPH_/);
    expect(() => getEmailSender({ EMAIL_PROVIDER: "smtp" })).toThrow(/must be/);
  });
});
