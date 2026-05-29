import type {
  AuthorizationRequest,
  DeterminationStatus,
  TerminalDetermination
} from "../../src/domain.js";
import {
  toDtrQuestionnaires,
  toPasClaimBundle,
  toPasClaimResponse
} from "../../src/fhir-pas.js";
import {
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "../../src/fixtures.js";
import { createX278HttpTransport } from "../../src/http.js";
import { createX278Client } from "../../src/sdk.js";

const payerUrl = process.env.X278_PAYER_URL ?? "http://localhost:8787";

interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly request: AuthorizationRequest;
  readonly expectedFirst: DeterminationStatus;
  readonly expectedFinal: TerminalDetermination["status"];
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    id: "knee-replacement-missing-docs",
    label: "Knee replacement starts info-needed, resumes with chart evidence, then approves",
    request: kneeReplacementMissingDocs,
    expectedFirst: "info-needed",
    expectedFinal: "approved"
  },
  {
    id: "spinal-stimulator-human-review",
    label: "Spinal stimulator pends for human review, then resolves by reviewer",
    request: spinalStimulatorReview,
    expectedFirst: "pended",
    expectedFinal: "approved"
  },
  {
    id: "non-covered-service",
    label: "Non-covered service returns a coded denial and appeal path",
    request: nonCoveredService,
    expectedFirst: "denied",
    expectedFinal: "denied"
  }
];

const assert: (condition: unknown, message: string) => asserts condition = (
  condition,
  message
) => {
  if (!condition) {
    throw new Error(message);
  }
};

const fetchJson = async (path: string): Promise<unknown> => {
  const response = await fetch(new URL(path, payerUrl));
  assert(response.ok, `GET ${path} returned HTTP ${response.status}`);
  return response.json();
};

const client = createX278Client(createX278HttpTransport({ baseUrl: payerUrl }), {
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `containerized EHR fixture evidence for ${requirement.id}`,
      source: "chart"
    }))
});

const runScenario = async (scenario: Scenario) => {
  const trace = await client.requestWithTrace(scenario.request);
  const first = trace.steps[0];
  assert(first, `${scenario.id} did not produce an initial determination`);
  assert(
    first.status === scenario.expectedFirst,
    `${scenario.id} expected first status ${scenario.expectedFirst}, got ${first.status}`
  );
  assert(
    trace.final.status === scenario.expectedFinal,
    `${scenario.id} expected final status ${scenario.expectedFinal}, got ${trace.final.status}`
  );
  assert(
    trace.steps.every((step) => step.authId === trace.final.authId),
    `${scenario.id} lost authId continuity`
  );

  const verified = await client.verify?.(trace.finalRequest, trace.final);
  assert(verified, `${scenario.id} final determination signature did not verify`);

  const pasClaim = toPasClaimBundle(trace.finalRequest, trace.final.authId);
  const claimResponse = toPasClaimResponse(trace.finalRequest, trace.final);
  const dtrQuestionnaires =
    first.status === "info-needed"
      ? toDtrQuestionnaires(first.documentationRequired)
      : [];

  return {
    id: scenario.id,
    label: scenario.label,
    statuses: trace.steps.map((step) => step.status),
    authId: trace.final.authId,
    finalStatus: trace.final.status,
    determinationBy: trace.final.determinationBy,
    sameAuthId: trace.steps.every((step) => step.authId === trace.final.authId),
    signatureVerified: verified,
    pas: {
      bundleResources: pasClaim.entry.map((entry) => entry.resource.resourceType),
      claimResponseOutcome: claimResponse.outcome,
      dtrQuestionnaires: dtrQuestionnaires.length
    }
  };
};

const main = async () => {
  const capabilities = await fetchJson("/.well-known/x278");
  const reports = [];

  for (const scenario of scenarios) {
    reports.push(await runScenario(scenario));
  }

  const auditLog = (await client.auditLog?.()) ?? [];
  assert(
    auditLog.length === scenarios.length,
    `expected ${scenarios.length} audit records, got ${auditLog.length}`
  );

  const report = {
    ok: true,
    payerUrl,
    capabilities,
    scenarios: reports,
    audit: {
      count: auditLog.length,
      statuses: auditLog.map((record) => record.status)
    }
  };

  console.log(JSON.stringify(report, null, 2));
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
