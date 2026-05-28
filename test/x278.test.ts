import { assert, describe, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import {
  EvidenceRepositoryLive,
  PayerAgent,
  PayerAgentLive,
  ProviderClient,
  ProviderClientLive,
  kneeReplacementComplete,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "../src/index.js";

const ProviderLive = () =>
  ProviderClientLive.pipe(
    Layer.provide([PayerAgentLive, EvidenceRepositoryLive])
  );

describe("x278 reference implementation", () => {
  it.effect("approves complete deterministic requests with a verifiable signed receipt", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const result = yield* payer.authorize(kneeReplacementComplete);

      assert.strictEqual(result.status, "approved");
      if (result.status !== "approved") return;

      assert.strictEqual(result.nextAction, "none");
      assert.strictEqual(result.determinationBy, "rules");
      assert.strictEqual(result.signature.alg, "EdDSA");

      const verified = yield* payer.verify(kneeReplacementComplete, result);
      assert.strictEqual(verified, true);

      const audit = yield* payer.auditLog;
      assert.strictEqual(audit.length, 1);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("turns missing documentation into an actionable retry on the same authId", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const first = yield* payer.authorize(kneeReplacementMissingDocs);

      assert.strictEqual(first.status, "info-needed");
      if (first.status !== "info-needed") return;

      assert.strictEqual(first.nextAction, "attach-evidence");
      assert.strictEqual(first.documentationRequired.length, 2);

      const evidence = first.documentationRequired.map((requirement) => ({
        id: requirement.id,
        value: `test evidence for ${requirement.id}`,
        source: "chart" as const
      }));

      const final = yield* payer.resume(
        first.authId,
        first.resumeToken,
        evidence
      );

      assert.strictEqual(final.status, "approved");
      if (final.status !== "approved") return;

      assert.strictEqual(final.authId, first.authId);
      const verified = yield* payer.verify(
        {
          ...kneeReplacementMissingDocs,
          supportingInfo: evidence
        },
        final
      );
      assert.strictEqual(verified, true);

      const audit = yield* payer.auditLog;
      assert.strictEqual(audit.length, 1);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("pends human-review requests and later returns a signed clinical determination", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const first = yield* payer.authorize(spinalStimulatorReview);

      assert.strictEqual(first.status, "pended");
      if (first.status !== "pended") return;

      assert.strictEqual(first.nextAction, "await-payer");
      assert.strictEqual(first.pendingReason, "human-review");

      const final = yield* payer.awaitDetermination(first.subscription);

      assert.strictEqual(final.status, "approved");
      assert.strictEqual(final.authId, first.authId);
      assert.strictEqual(final.determinationBy, "clinical-reviewer");

      const verified = yield* payer.verify(spinalStimulatorReview, final);
      assert.strictEqual(verified, true);

      const audit = yield* payer.auditLog;
      assert.strictEqual(audit.length, 1);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("returns coded denial reasons and appeal paths", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const result = yield* payer.authorize(nonCoveredService);

      assert.strictEqual(result.status, "denied");
      if (result.status !== "denied") return;

      assert.strictEqual(result.nextAction, "appeal");
      assert.strictEqual(result.reasonCode, "not-covered");
      assert.match(result.appealPath, /^https:/);

      const verified = yield* payer.verify(nonCoveredService, result);
      assert.strictEqual(verified, true);

      const audit = yield* payer.auditLog;
      assert.strictEqual(audit.length, 1);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("lets the provider agent drive info-needed and pended workflows to terminal states", () =>
    Effect.gen(function* () {
      const provider = yield* ProviderClient;

      const approved = yield* provider.request(kneeReplacementMissingDocs);
      const reviewed = yield* provider.request(spinalStimulatorReview);

      assert.strictEqual(approved.status, "approved");
      assert.strictEqual(reviewed.status, "approved");
      assert.strictEqual(reviewed.determinationBy, "clinical-reviewer");
    }).pipe(Effect.provide(ProviderLive()))
  );
});
