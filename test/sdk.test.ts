import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  ProtocolError,
  createMockPayer,
  createMockX278Client,
  createX278EffectClient,
  fromPayerAgent,
  kneeReplacementMissingDocs,
  makeReferencePayerAgent,
  runX278Conformance,
  runX278ConformanceEffect
} from "../src/index.js";

describe("x278 TypeScript SDK", () => {
  it("drives info-needed to a terminal approval with the promise client", async () => {
    const client = createMockX278Client({
      collectEvidence: (_request, requirements) =>
        requirements.map((requirement) => ({
          id: requirement.id,
          value: `sdk test evidence for ${requirement.id}`,
          source: "chart" as const
        }))
    });

    const trace = await client.requestWithTrace(kneeReplacementMissingDocs);

    assert.deepStrictEqual(
      trace.steps.map((step) => step.status),
      ["info-needed", "approved"]
    );
    assert.strictEqual(trace.final.status, "approved");
    assert.strictEqual(trace.steps[0]?.authId, trace.final.authId);
  });

  it("returns actionable evidence-required errors when no collector is configured", async () => {
    const client = createMockX278Client();

    let caught: unknown;
    try {
      await client.request(kneeReplacementMissingDocs);
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof ProtocolError);
    assert.strictEqual(caught.reason, "evidence-required");
  });

  it("runs a conformance report against the mock payer", async () => {
    const report = await runX278Conformance(createMockPayer());

    assert.strictEqual(report.passed, true);
    assert.deepStrictEqual(
      report.checks.map((item) => item.id),
      [
        "x278.approved",
        "x278.info-needed",
        "x278.auth-continuity",
        "x278.pended",
        "x278.denied",
        "x278.signature",
        "x278.audit"
      ]
    );
  });

  it.effect("keeps Effect-native SDK composition available", () =>
    Effect.gen(function* () {
      const payer = yield* makeReferencePayerAgent;
      const client = createX278EffectClient(fromPayerAgent(payer), {
        collectEvidence: (_request, requirements) =>
          Effect.succeed(
            requirements.map((requirement) => ({
              id: requirement.id,
              value: `effect sdk evidence for ${requirement.id}`,
              source: "chart" as const
            }))
          )
      });

      const report = yield* runX278ConformanceEffect(client);

      assert.strictEqual(report.passed, true);
    })
  );
});
