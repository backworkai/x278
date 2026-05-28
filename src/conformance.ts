import { Effect } from "effect";
import type { DocumentationRequirement, SupportingInfo } from "./domain.js";
import { ProtocolError } from "./domain.js";
import {
  kneeReplacementComplete,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "./fixtures.js";
import {
  type X278ClientOptions,
  type X278EffectClient,
  type X278EffectTransport,
  type X278Transport,
  createX278Client,
  createX278EffectClient
} from "./sdk.js";

export interface ConformanceCheck {
  readonly id: string;
  readonly description: string;
  readonly passed: boolean;
  readonly details?: unknown;
}

export interface ConformanceReport {
  readonly passed: boolean;
  readonly checkedAt: string;
  readonly checks: ReadonlyArray<ConformanceCheck>;
}

const conformanceEvidence = (
  requirements: ReadonlyArray<DocumentationRequirement>
): ReadonlyArray<SupportingInfo> =>
  requirements.map((requirement) => ({
    id: requirement.id,
    value: `conformance evidence for ${requirement.id}`,
    source: "chart" as const
  }));

const check = (
  id: string,
  description: string,
  passed: boolean,
  details?: unknown
): ConformanceCheck => ({
  id,
  description,
  passed,
  details
});

export const runX278ConformanceEffect = (
  client: X278EffectClient
): Effect.Effect<ConformanceReport, ProtocolError> =>
  Effect.gen(function* () {
    const checks: Array<ConformanceCheck> = [];

    const approved = yield* client.authorize(kneeReplacementComplete);
    checks.push(
      check(
        "x278.approved",
        "Complete deterministic request returns approved",
        approved.status === "approved",
        { status: approved.status }
      )
    );

    const trace = yield* client.requestWithTrace(kneeReplacementMissingDocs);
    checks.push(
      check(
        "x278.info-needed",
        "Missing documentation returns info-needed then resumes to approved",
        trace.steps[0]?.status === "info-needed" &&
          trace.final.status === "approved",
        trace.steps.map((step) => step.status)
      )
    );
    checks.push(
      check(
        "x278.auth-continuity",
        "Retry preserves authId across info-needed resume",
        trace.steps.every((step) => step.authId === trace.final.authId),
        trace.steps.map((step) => step.authId)
      )
    );

    const pended = yield* client.authorize(spinalStimulatorReview);
    const reviewed =
      pended.status === "pended"
        ? yield* client.awaitDetermination(pended.subscription)
        : pended;
    checks.push(
      check(
        "x278.pended",
        "Pended request returns awaitable final determination",
        pended.status === "pended" &&
          reviewed.status === "approved" &&
          pended.authId === reviewed.authId,
        { first: pended.status, final: reviewed.status }
      )
    );

    const denied = yield* client.authorize(nonCoveredService);
    checks.push(
      check(
        "x278.denied",
        "Non-covered request returns coded denial and appeal next action",
        denied.status === "denied" &&
          denied.nextAction === "appeal" &&
          Boolean(denied.reasonCode),
        denied.status === "denied"
          ? { reasonCode: denied.reasonCode, appealPath: denied.appealPath }
          : { status: denied.status }
      )
    );

    if (client.verify && trace.final.status === "approved") {
      const verified = yield* client.verify(trace.finalRequest, trace.final);
      checks.push(
        check(
          "x278.signature",
          "Terminal determination signature verifies against final request",
          verified
        )
      );
    }

    if (client.auditLog) {
      const audit = yield* client.auditLog;
      checks.push(
        check(
          "x278.audit",
          "Terminal determinations are audit logged",
          audit.length >= 4,
          { records: audit.length }
        )
      );
    }

    return {
      passed: checks.every((item) => item.passed),
      checkedAt: new Date().toISOString(),
      checks
    };
  });

export const createConformanceClientOptions = (): X278ClientOptions => ({
  collectEvidence: (_request, requirements) => conformanceEvidence(requirements)
});

export const runX278Conformance = async (
  transport: X278Transport
): Promise<ConformanceReport> => {
  const client = createX278Client(transport, createConformanceClientOptions());
  const checks: Array<ConformanceCheck> = [];

  const approved = await client.authorize(kneeReplacementComplete);
  checks.push(
    check(
      "x278.approved",
      "Complete deterministic request returns approved",
      approved.status === "approved",
      { status: approved.status }
    )
  );

  const trace = await client.requestWithTrace(kneeReplacementMissingDocs);
  checks.push(
    check(
      "x278.info-needed",
      "Missing documentation returns info-needed then resumes to approved",
      trace.steps[0]?.status === "info-needed" && trace.final.status === "approved",
      trace.steps.map((step) => step.status)
    )
  );
  checks.push(
    check(
      "x278.auth-continuity",
      "Retry preserves authId across info-needed resume",
      trace.steps.every((step) => step.authId === trace.final.authId),
      trace.steps.map((step) => step.authId)
    )
  );

  const pended = await client.authorize(spinalStimulatorReview);
  const reviewed =
    pended.status === "pended"
      ? await client.awaitDetermination(pended.subscription)
      : pended;
  checks.push(
    check(
      "x278.pended",
      "Pended request returns awaitable final determination",
      pended.status === "pended" &&
        reviewed.status === "approved" &&
        pended.authId === reviewed.authId,
      { first: pended.status, final: reviewed.status }
    )
  );

  const denied = await client.authorize(nonCoveredService);
  checks.push(
    check(
      "x278.denied",
      "Non-covered request returns coded denial and appeal next action",
      denied.status === "denied" &&
        denied.nextAction === "appeal" &&
        Boolean(denied.reasonCode),
      denied.status === "denied"
        ? { reasonCode: denied.reasonCode, appealPath: denied.appealPath }
        : { status: denied.status }
    )
  );

  if (client.verify && trace.final.status === "approved") {
    checks.push(
      check(
        "x278.signature",
        "Terminal determination signature verifies against final request",
        await client.verify(trace.finalRequest, trace.final)
      )
    );
  }

  if (client.auditLog) {
    const audit = await client.auditLog();
    checks.push(
      check("x278.audit", "Terminal determinations are audit logged", audit.length >= 4, {
        records: audit.length
      })
    );
  }

  return {
    passed: checks.every((item) => item.passed),
    checkedAt: new Date().toISOString(),
    checks
  };
};

export const runX278EffectTransportConformance = (
  transport: X278EffectTransport
): Effect.Effect<ConformanceReport, ProtocolError> =>
  runX278ConformanceEffect(
    createX278EffectClient(transport, createConformanceClientOptions())
  );
