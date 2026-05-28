import { Effect } from "effect";
import {
  PayerAgent,
  PayerAgentLive,
  kneeReplacementComplete,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "./index.js";
import type {
  AuthorizationRequest,
  Determination,
  SupportingInfo,
  TerminalDetermination
} from "./index.js";

interface StepRecord {
  readonly label: string;
  readonly status: Determination["status"];
  readonly nextAction: Determination["nextAction"];
  readonly authId: string;
  readonly details: Record<string, unknown>;
}

interface ScenarioRecord {
  readonly name: string;
  readonly steps: ReadonlyArray<StepRecord>;
  readonly final: TerminalDetermination;
  readonly verified: boolean;
  readonly sameAuthId: boolean;
}

const evidenceFor = (determination: Determination): ReadonlyArray<SupportingInfo> => {
  if (determination.status !== "info-needed") {
    return [];
  }

  return determination.documentationRequired.map((requirement) => ({
    id: requirement.id,
    value: `dogfood evidence: ${requirement.description}`,
    source: "chart" as const
  }));
};

const step = (label: string, determination: Determination): StepRecord => {
  const details: Record<string, unknown> = {};

  if (determination.status === "info-needed") {
    details.documentationRequired = determination.documentationRequired.map(
      (requirement) => requirement.id
    );
    details.resumeTokenIssued = Boolean(determination.resumeToken);
  }

  if (determination.status === "pended") {
    details.pendingReason = determination.pendingReason;
    details.subscription = determination.subscription;
  }

  if (determination.status === "approved") {
    details.authNumber = determination.authNumber;
    details.validThrough = determination.validThrough;
  }

  if (determination.status === "denied") {
    details.reasonCode = determination.reasonCode;
    details.appealPath = determination.appealPath;
  }

  return {
    label,
    status: determination.status,
    nextAction: determination.nextAction,
    authId: determination.authId,
    details
  };
};

const ensureTerminal = (
  scenario: string,
  determination: Determination
): TerminalDetermination => {
  if (determination.status === "approved" || determination.status === "denied") {
    return determination;
  }

  throw new Error(
    `${scenario} ended in non-terminal status ${determination.status}`
  );
};

const runDogfood = Effect.gen(function* () {
  const payer = yield* PayerAgent;

  const scenarios: Array<ScenarioRecord> = [];

  const complete = yield* payer.authorize(kneeReplacementComplete);
  const completeFinal = ensureTerminal("deterministic approval", complete);
  scenarios.push({
    name: "deterministic approval",
    steps: [step("submit complete request", complete)],
    final: completeFinal,
    verified: yield* payer.verify(kneeReplacementComplete, completeFinal),
    sameAuthId: true
  });

  const infoNeeded = yield* payer.authorize(kneeReplacementMissingDocs);
  const evidence = evidenceFor(infoNeeded);
  const resumed =
    infoNeeded.status === "info-needed"
      ? yield* payer.resume(infoNeeded.authId, infoNeeded.resumeToken, evidence)
      : infoNeeded;
  const resumedFinal = ensureTerminal("info-needed retry", resumed);
  const resumedRequest: AuthorizationRequest = {
    ...kneeReplacementMissingDocs,
    supportingInfo: evidence
  };
  scenarios.push({
    name: "info-needed retry",
    steps: [
      step("submit missing-docs request", infoNeeded),
      step("attach evidence and resume", resumed)
    ],
    final: resumedFinal,
    verified: yield* payer.verify(resumedRequest, resumedFinal),
    sameAuthId: infoNeeded.authId === resumedFinal.authId
  });

  const pended = yield* payer.authorize(spinalStimulatorReview);
  const reviewed =
    pended.status === "pended"
      ? yield* payer.awaitDetermination(pended.subscription)
      : pended;
  const reviewedFinal = ensureTerminal("pended human review", reviewed);
  scenarios.push({
    name: "pended human review",
    steps: [
      step("submit review-required request", pended),
      step("await subscription determination", reviewed)
    ],
    final: reviewedFinal,
    verified: yield* payer.verify(spinalStimulatorReview, reviewedFinal),
    sameAuthId: pended.authId === reviewedFinal.authId
  });

  const denied = yield* payer.authorize(nonCoveredService);
  const deniedFinal = ensureTerminal("coded denial", denied);
  scenarios.push({
    name: "coded denial",
    steps: [step("submit non-covered request", denied)],
    final: deniedFinal,
    verified: yield* payer.verify(nonCoveredService, deniedFinal),
    sameAuthId: true
  });

  const audit = yield* payer.auditLog;
  const failures = scenarios.filter(
    (scenario) => !scenario.verified || !scenario.sameAuthId
  );

  const report = {
    checkedAt: new Date().toISOString(),
    result: failures.length === 0 ? "pass" : "fail",
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      steps: scenario.steps,
      finalStatus: scenario.final.status,
      determinationBy: scenario.final.determinationBy,
      signature: {
        alg: scenario.final.signature.alg,
        keyId: scenario.final.signature.keyId,
        requestHash: scenario.final.signature.requestHash,
        payloadHash: scenario.final.signature.payloadHash
      },
      verified: scenario.verified,
      sameAuthId: scenario.sameAuthId
    })),
    audit: {
      expectedRecords: scenarios.length,
      actualRecords: audit.length,
      records: audit
    }
  };

  console.log(JSON.stringify(report, null, 2));

  if (failures.length > 0 || audit.length !== scenarios.length) {
    throw new Error("Dogfood run failed protocol checks");
  }
}).pipe(Effect.provide(PayerAgentLive));

Effect.runPromise(runDogfood).catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
