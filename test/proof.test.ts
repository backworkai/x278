import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  PayerAgent,
  PayerAgentLive,
  kneeReplacementComplete,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview,
  toDtrQuestionnaires,
  toPasClaimBundle,
  toPasClaimResponse
} from "../src/index.js";

const claimFrom = (bundle: ReturnType<typeof toPasClaimBundle>) => {
  const claim = bundle.entry.find(
    (entry) => entry.resource.resourceType === "Claim"
  )?.resource;
  if (!claim) throw new Error("PAS bundle did not contain a Claim resource");
  return claim;
};

describe("whitepaper proof matrix", () => {
  it.effect("resolves deterministic local authorization within the paper's sub-15s target", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const started = performance.now();
      const determination = yield* payer.authorize(kneeReplacementComplete);
      const elapsedMs = performance.now() - started;

      assert.strictEqual(determination.status, "approved");
      assert.ok(elapsedMs < 15_000);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("maps x278 requests onto a PAS-style FHIR Claim bundle", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const determination = yield* payer.authorize(kneeReplacementComplete);
      const bundle = toPasClaimBundle(
        kneeReplacementComplete,
        determination.authId
      );
      const claim = claimFrom(bundle);

      assert.strictEqual(bundle.resourceType, "Bundle");
      assert.strictEqual(bundle.type, "collection");
      assert.strictEqual(claim.resourceType, "Claim");
      assert.strictEqual(claim.use, "preauthorization");
      assert.strictEqual(claim.status, "active");
      assert.deepStrictEqual(
        (claim.item as Array<any>)[0].productOrService.coding[0].code,
        "27447"
      );
      assert.deepStrictEqual(
        (claim.diagnosis as Array<any>)[0].diagnosisCodeableConcept.coding[0].code,
        "M17.11"
      );
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("maps approval, denial, info-needed, and pended states to ClaimResponse outcomes", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;

      const approved = yield* payer.authorize(kneeReplacementComplete);
      const denied = yield* payer.authorize(nonCoveredService);
      const infoNeeded = yield* payer.authorize(kneeReplacementMissingDocs);
      const pended = yield* payer.authorize(spinalStimulatorReview);

      const approvedResponse = toPasClaimResponse(
        kneeReplacementComplete,
        approved
      );
      const deniedResponse = toPasClaimResponse(nonCoveredService, denied);
      const infoResponse = toPasClaimResponse(
        kneeReplacementMissingDocs,
        infoNeeded
      );
      const pendedResponse = toPasClaimResponse(
        spinalStimulatorReview,
        pended
      );

      assert.strictEqual(approvedResponse.resourceType, "ClaimResponse");
      assert.strictEqual(approvedResponse.use, "preauthorization");
      assert.strictEqual(approvedResponse.outcome, "complete");
      assert.ok(approvedResponse.preAuthRef);

      assert.strictEqual(deniedResponse.outcome, "complete");
      assert.match(String(deniedResponse.disposition), /not-covered/);
      assert.ok(deniedResponse.processNote);

      assert.strictEqual(infoResponse.outcome, "partial");
      assert.match(
        String(infoResponse.disposition),
        /conservative-tx-6wk/
      );
      assert.ok(infoResponse.extension);

      assert.strictEqual(pendedResponse.outcome, "queued");
      assert.match(String(pendedResponse.disposition), /human-review/);
      assert.ok(pendedResponse.extension);
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("represents actionable documentation requests as DTR Questionnaires", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;
      const first = yield* payer.authorize(kneeReplacementMissingDocs);

      assert.strictEqual(first.status, "info-needed");
      if (first.status !== "info-needed") return;

      const questionnaires = toDtrQuestionnaires(first.documentationRequired);

      assert.strictEqual(questionnaires.length, 2);
      assert.deepStrictEqual(
        questionnaires.map((questionnaire) => questionnaire.resourceType),
        ["Questionnaire", "Questionnaire"]
      );
      assert.deepStrictEqual(
        questionnaires.map((questionnaire) => questionnaire.id),
        ["conservative-tx-6wk", "weight-bearing-xray"]
      );
      assert.ok(
        questionnaires.every((questionnaire) =>
          String(questionnaire.url).includes("/Questionnaire/")
        )
      );
    }).pipe(Effect.provide(PayerAgentLive))
  );

  it.effect("proves continuity and receipts across retry and pended workflows", () =>
    Effect.gen(function* () {
      const payer = yield* PayerAgent;

      const infoNeeded = yield* payer.authorize(kneeReplacementMissingDocs);
      assert.strictEqual(infoNeeded.status, "info-needed");
      if (infoNeeded.status !== "info-needed") return;

      const evidence = infoNeeded.documentationRequired.map((requirement) => ({
        id: requirement.id,
        value: `proof fixture evidence for ${requirement.id}`,
        source: "chart" as const
      }));

      const approved = yield* payer.resume(
        infoNeeded.authId,
        infoNeeded.resumeToken,
        evidence
      );
      assert.strictEqual(approved.status, "approved");
      if (approved.status !== "approved") return;

      assert.strictEqual(approved.authId, infoNeeded.authId);
      assert.strictEqual(
        yield* payer.verify(
          {
            ...kneeReplacementMissingDocs,
            supportingInfo: evidence
          },
          approved
        ),
        true
      );

      const pended = yield* payer.authorize(spinalStimulatorReview);
      assert.strictEqual(pended.status, "pended");
      if (pended.status !== "pended") return;

      const reviewed = yield* payer.awaitDetermination(pended.subscription);
      assert.strictEqual(reviewed.status, "approved");
      assert.strictEqual(reviewed.authId, pended.authId);
      assert.strictEqual(reviewed.determinationBy, "clinical-reviewer");
      assert.strictEqual(
        yield* payer.verify(spinalStimulatorReview, reviewed),
        true
      );

      const audit = yield* payer.auditLog;
      assert.strictEqual(audit.length, 2);
    }).pipe(Effect.provide(PayerAgentLive))
  );
});
