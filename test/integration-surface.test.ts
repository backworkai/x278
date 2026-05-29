import { assert, describe, it } from "@effect/vitest";
import type { DocumentationRequirement, X278Fetch } from "../src/index.js";
import {
  ProtocolError,
  createConfiguredMockPayer,
  createEvidenceForRequirements,
  createMockPayer,
  createReferencePolicyAdapter,
  createSmartBackendTokenProvider,
  createX278Client,
  createX278SubscriptionBroker,
  createX278SubscriptionEvent,
  discoverSmartConfiguration,
  evidenceSatisfiesRequirements,
  kneeReplacementMissingDocs,
  missingEvidenceRequirements,
  spinalStimulatorReview,
  summarizeConformanceReport,
  toDtrQuestionnaireResponses,
  toConformanceBadge,
  toConformanceMarkdown,
  runX278Conformance
} from "../src/index.js";

const decodeJwtPart = (jwt: string, index: number): unknown => {
  const part = jwt.split(".")[index];
  if (!part) {
    throw new Error("missing jwt part");
  }

  return JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
};

describe("new integration SDK surfaces", () => {
  it("builds and validates DTR-style evidence helpers", () => {
    const requirements: ReadonlyArray<DocumentationRequirement> = [
      {
        id: "chart-note",
        description: "Chart note",
        questionnaire: "https://payer.example/Questionnaire/chart-note"
      }
    ];
    const evidence = createEvidenceForRequirements(
      requirements,
      (requirement) => `evidence for ${requirement.id}`
    );
    const responses = toDtrQuestionnaireResponses(
      requirements,
      evidence,
      { authored: "2026-06-01T00:00:00.000Z" }
    );

    assert.strictEqual(evidenceSatisfiesRequirements(requirements, evidence), true);
    assert.deepStrictEqual(missingEvidenceRequirements(requirements, []), requirements);
    assert.strictEqual(responses[0]?.resourceType, "QuestionnaireResponse");
  });

  it("serializes conformance reports for artifacts and badges", async () => {
    const report = await runX278Conformance(createMockPayer());
    const summary = summarizeConformanceReport(report);
    const badge = toConformanceBadge(report);
    const markdown = toConformanceMarkdown(report);

    assert.strictEqual(report.passed, true);
    assert.strictEqual(summary.failedCount, 0);
    assert.strictEqual(badge.message, "passing");
    assert.match(markdown, /x278 Conformance Report/);
  });

  it("allows a custom executable policy adapter", async () => {
    const reference = createReferencePolicyAdapter("custom/reference@1");
    const payer = createConfiguredMockPayer({
      policy: {
        ruleSetVersion: "custom/reference@1",
        evaluate: (request, context) => {
          if (request.service.code === "27447") {
            return {
              authId: context.authId,
              ruleSetVersion: context.ruleSetVersion,
              expiresAt: null,
              status: "approved",
              nextAction: "none",
              authNumber: `CUSTOM-${context.authId.slice(0, 6)}`,
              approvedUnits: request.service.units,
              validFrom: request.service.requestedStart,
              validThrough: context.addDays(request.service.requestedStart, 30),
              determinationBy: "rules"
            };
          }

          return reference.evaluate(request, context);
        },
        review: reference.review ?? ((_request, context) => ({
          authId: context.authId,
          ruleSetVersion: context.ruleSetVersion,
          expiresAt: null,
          status: "approved",
          nextAction: "none",
          authNumber: `CUSTOM-${context.authId.slice(0, 6)}`,
          approvedUnits: 1,
          validFrom: "2026-06-01",
          validThrough: "2026-07-01",
          determinationBy: "clinical-reviewer"
        }))
      }
    });

    const determination = await payer.authorize(kneeReplacementMissingDocs);

    assert.strictEqual(determination.status, "approved");
    assert.strictEqual(determination.ruleSetVersion, "custom/reference@1");
  });

  it("can resolve pended determinations through a subscription broker", async () => {
    const payer = createMockPayer();
    const broker = createX278SubscriptionBroker();
    let pendedSubscription: string | undefined;
    let publishFinal: (() => Promise<void>) | undefined;

    const client = createX278Client(payer, {
      awaitPended: async (_request, pended) => {
        pendedSubscription = pended.subscription;
        publishFinal = async () => {
          const final = await payer.awaitDetermination(pended.subscription);
          const event = createX278SubscriptionEvent(pended, final, "evt_1");
          assert.strictEqual(await broker.publish(event), "accepted");
          assert.strictEqual(await broker.publish(event), "duplicate");
        };
        return broker.waitFor(pended.subscription, { timeoutMs: 1000 });
      }
    });

    const tracePromise = client.requestWithTrace(spinalStimulatorReview);
    for (let index = 0; index < 10 && !publishFinal; index += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await publishFinal?.();
    const trace = await tracePromise;

    assert.strictEqual(pendedSubscription?.startsWith("x278://subscription/"), true);
    assert.deepStrictEqual(
      trace.steps.map((step) => step.status),
      ["pended", "approved"]
    );
    assert.deepStrictEqual(broker.seenEvents(), ["evt_1"]);
  });

  it("creates cached SMART Backend Services bearer tokens", async () => {
    const requests: Array<URLSearchParams> = [];
    const fetcher: X278Fetch = async (_input, init) => {
      requests.push(new URLSearchParams(String(init?.body)));
      return new Response(
        JSON.stringify({
          access_token: "smart-token",
          token_type: "Bearer",
          expires_in: 600,
          scope: "system/Patient.read"
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };
    const tokenProvider = createSmartBackendTokenProvider({
      tokenEndpoint: "https://payer.example/oauth/token",
      clientId: "client-123",
      scopes: ["system/Patient.read"],
      fetch: fetcher,
      now: () => 1_000_000,
      randomUUID: () => "jwt-id",
      authentication: {
        method: "private-key-jwt",
        alg: "RS384",
        signJwt: (header, claims) =>
          `${Buffer.from(JSON.stringify(header)).toString("base64url")}.${Buffer.from(
            JSON.stringify(claims)
          ).toString("base64url")}.signature`
      }
    });

    assert.strictEqual(await tokenProvider(), "smart-token");
    assert.strictEqual(await tokenProvider(), "smart-token");
    assert.strictEqual(requests.length, 1);
    assert.strictEqual(requests[0]?.get("grant_type"), "client_credentials");
    assert.strictEqual(requests[0]?.get("client_assertion_type")?.includes("jwt-bearer"), true);

    const assertion = requests[0]?.get("client_assertion");
    assert.ok(assertion);
    const claims = decodeJwtPart(assertion, 1) as {
      readonly iss: string;
      readonly sub: string;
      readonly aud: string;
      readonly jti: string;
    };
    assert.deepStrictEqual(
      {
        iss: claims.iss,
        sub: claims.sub,
        aud: claims.aud,
        jti: claims.jti
      },
      {
        iss: "client-123",
        sub: "client-123",
        aud: "https://payer.example/oauth/token",
        jti: "jwt-id"
      }
    );
  });

  it("discovers SMART configuration and supports client-secret-basic auth", async () => {
    let discoveryUrl: string | undefined;
    let authorizationHeader: string | null = null;
    let tokenBody: URLSearchParams | undefined;
    const fetcher: X278Fetch = async (input, init) => {
      const url = input.toString();

      if (init?.method === "GET") {
        discoveryUrl = url;
        return new Response(
          JSON.stringify({
            token_endpoint: "https://payer.example/oauth/token"
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        );
      }

      authorizationHeader = new Headers(init?.headers).get("authorization");
      tokenBody = new URLSearchParams(String(init?.body));
      return new Response(
        JSON.stringify({
          access_token: "basic-token",
          token_type: "Bearer",
          expires_in: 300
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      );
    };

    const config = await discoverSmartConfiguration(
      "https://payer.example/fhir",
      fetcher
    );
    const tokenProvider = createSmartBackendTokenProvider({
      tokenEndpoint: config.token_endpoint,
      clientId: "client:123",
      scopes: "system/Patient.read",
      fetch: fetcher,
      authentication: {
        method: "client-secret-basic",
        clientSecret: "sec ret"
      }
    });

    assert.strictEqual(await tokenProvider(), "basic-token");
    assert.strictEqual(
      discoveryUrl,
      "https://payer.example/fhir/.well-known/smart-configuration"
    );
    assert.strictEqual(tokenBody?.get("grant_type"), "client_credentials");
    assert.strictEqual(
      authorizationHeader,
      `Basic ${Buffer.from("client%3A123:sec+ret").toString("base64")}`
    );
  });

  it("surfaces SMART token failures as ProtocolError", async () => {
    const fetcher: X278Fetch = async () =>
      new Response(JSON.stringify({ error: "invalid_client" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    const tokenProvider = createSmartBackendTokenProvider({
      tokenEndpoint: "https://payer.example/oauth/token",
      clientId: "client-123",
      scopes: "system/Patient.read",
      fetch: fetcher,
      authentication: {
        method: "client-secret-post",
        clientSecret: "secret"
      }
    });

    let caught: unknown;
    try {
      await tokenProvider();
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof ProtocolError);
    assert.strictEqual(caught.reason, "smart-token-request-failed");
  });
});
