import { assert, describe, it } from "@effect/vitest";
import type {
  AuthorizationRequest,
  SupportingInfo,
  TerminalDetermination,
  X278Fetch
} from "../src/index.js";
import {
  ProtocolError,
  createMockPayer,
  createX278HttpClient,
  createX278HttpClientFromEnv,
  createX278HttpTransport,
  createX278Client,
  kneeReplacementMissingDocs
} from "../src/index.js";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });

const createFetchBackedPayer = () => {
  const payer = createMockPayer();
  const calls: Array<string> = [];

  const fetcher: X278Fetch = async (input, init) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url.pathname}`);

    if (method === "POST" && url.pathname === "/authorize") {
      return json(
        await payer.authorize(
          JSON.parse(String(init?.body ?? "{}")) as AuthorizationRequest
        )
      );
    }

    const resumeMatch =
      method === "POST"
        ? /^\/authorizations\/([^/]+)\/resume$/.exec(url.pathname)
        : null;

    if (resumeMatch) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        readonly resumeToken: string;
        readonly evidence: ReadonlyArray<SupportingInfo>;
      };
      return json(
        await payer.resume(
          decodeURIComponent(resumeMatch[1] ?? ""),
          body.resumeToken,
          body.evidence
        )
      );
    }

    if (method === "POST" && url.pathname === "/determinations/await") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        readonly subscription: string;
      };
      return json(await payer.awaitDetermination(body.subscription));
    }

    if (method === "GET" && url.pathname === "/audit-log") {
      return json(await payer.auditLog?.());
    }

    if (method === "POST" && url.pathname === "/verify") {
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        readonly request: AuthorizationRequest;
        readonly determination: TerminalDetermination;
      };
      return json({
        valid: await payer.verify?.(body.request, body.determination)
      });
    }

    return json({ error: "not-found" }, 404);
  };

  return { calls, fetcher };
};

describe("x278 HTTP transport", () => {
  it("drives the provider client through the HTTP route contract", async () => {
    const { calls, fetcher } = createFetchBackedPayer();
    const client = createX278Client(
      createX278HttpTransport({
        baseUrl: "http://payer.example",
        fetch: fetcher
      }),
      {
        collectEvidence: (_request, requirements) =>
          requirements.map((requirement) => ({
            id: requirement.id,
            value: `http transport evidence for ${requirement.id}`,
            source: "chart" as const
          }))
      }
    );

    const trace = await client.requestWithTrace(kneeReplacementMissingDocs);

    assert.deepStrictEqual(
      trace.steps.map((step) => step.status),
      ["info-needed", "approved"]
    );
    assert.strictEqual(trace.final.status, "approved");
    assert.strictEqual(trace.steps[0]?.authId, trace.final.authId);
    assert.strictEqual(
      await client.verify?.(trace.finalRequest, trace.final),
      true
    );
    assert.strictEqual((await client.auditLog?.())?.length, 1);
    assert.deepStrictEqual(calls, [
      "POST /authorize",
      `POST /authorizations/${trace.final.authId}/resume`,
      "POST /verify",
      "GET /audit-log"
    ]);
  });

  it("creates a batteries-included HTTP client with capabilities discovery", async () => {
    const { fetcher } = createFetchBackedPayer();
    const client = createX278HttpClient({
      baseUrl: "http://payer.example",
      fetch: async (input, init) => {
        const url = new URL(input.toString());
        if (url.pathname === "/.well-known/x278") {
          return json({
            protocol: "x278",
            implementation: "test-payer",
            endpoints: {
              authorize: "/authorize",
              resume: "/authorizations/{authId}/resume",
              awaitDetermination: "/determinations/await",
              auditLog: "/audit-log",
              verify: "/verify"
            }
          });
        }

        return fetcher(input, init);
      },
      collectEvidence: (_request, requirements) =>
        requirements.map((requirement) => ({
          id: requirement.id,
          value: `http client evidence for ${requirement.id}`,
          source: "chart" as const
        }))
    });

    const capabilities = await client.capabilities();
    const final = await client.request(kneeReplacementMissingDocs);

    assert.strictEqual(capabilities.protocol, "x278");
    assert.strictEqual(final.status, "approved");
  });

  it("passes transport capabilities through the generic client", async () => {
    const client = createX278Client(
      createX278HttpTransport({
        baseUrl: "http://payer.example",
        fetch: async () =>
          json({
            protocol: "x278",
            implementation: "generic-client-test",
            endpoints: {
              authorize: "/authorize",
              resume: "/authorizations/{authId}/resume",
              awaitDetermination: "/determinations/await"
            }
          })
      })
    );

    const capabilities = await client.capabilities?.();

    assert.strictEqual(capabilities?.implementation, "generic-client-test");
  });

  it("retries transient HTTP failures and exposes hook events", async () => {
    const events: Array<string> = [];
    let failures = 0;
    const { fetcher } = createFetchBackedPayer();
    const client = createX278HttpClient({
      baseUrl: "http://payer.example",
      fetch: async (input, init) => {
        const url = new URL(input.toString());
        if (url.pathname === "/authorize" && failures === 0) {
          failures += 1;
          return json({ error: { reason: "busy" } }, 503);
        }

        return fetcher(input, init);
      },
      retry: { maxRetries: 1, baseDelayMs: 0, jitter: false },
      hooks: {
        onRequest: (event) => {
          events.push(`request:${event.operation}:${event.attempt}`);
        },
        onRetry: (event) => {
          events.push(`retry:${event.operation}:${event.status}`);
        },
        onResponse: (event) => {
          events.push(`response:${event.operation}:${event.status}`);
        }
      }
    });

    const first = await client.authorize(kneeReplacementMissingDocs);

    assert.strictEqual(first.status, "info-needed");
    assert.deepStrictEqual(events.slice(0, 4), [
      "request:authorize:0",
      "response:authorize:503",
      "retry:authorize:503",
      "request:authorize:1"
    ]);
  });

  it("keeps HTTP errors narrowable as ProtocolError", async () => {
    const client = createX278HttpClient({
      baseUrl: "http://payer.example",
      fetch: async () => json({ error: { reason: "bad-request" } }, 400),
      retry: { maxRetries: 0 }
    });

    let caught: unknown;
    try {
      await client.authorize(kneeReplacementMissingDocs);
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof ProtocolError);
    assert.strictEqual(caught.kind, "transport");
    assert.strictEqual(caught.reason, "http-error");
  });

  it("creates a client from environment variables", async () => {
    const { fetcher } = createFetchBackedPayer();
    const client = createX278HttpClientFromEnv(
      {
        X278_PAYER_URL: "http://payer.example",
        X278_BEARER_TOKEN: "test-token"
      },
      { fetch: fetcher }
    );

    const first = await client.authorize(kneeReplacementMissingDocs);

    assert.strictEqual(first.status, "info-needed");
  });
});
