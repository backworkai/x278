import { assert, describe, it } from "@effect/vitest";
import type {
  AuthorizationRequest,
  SupportingInfo,
  TerminalDetermination
} from "../src/index.js";
import type { X278Fetch } from "../e2e/realistic/http-transport.js";
import { createX278HttpTransport } from "../e2e/realistic/http-transport.js";
import {
  createMockPayer,
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
});
