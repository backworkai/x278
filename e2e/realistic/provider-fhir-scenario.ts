import type {
  AuthorizationRequest,
  Determination,
  DeterminationStatus,
  TerminalDetermination
} from "../../src/domain.js";
import type { FhirResource } from "../../src/fhir-pas.js";
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
const fhirBaseUrl = process.env.FHIR_BASE_URL ?? "http://localhost:8080/fhir";

interface Scenario {
  readonly id: string;
  readonly request: AuthorizationRequest;
  readonly expectedFirst: DeterminationStatus;
  readonly expectedFinal: TerminalDetermination["status"];
}

interface ValidationIssue {
  readonly severity?: string;
  readonly code?: string;
  readonly diagnostics?: string;
}

interface ValidationSummary {
  readonly resourceType: string;
  readonly id: string | null;
  readonly issueCount: number;
  readonly fatalCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
  readonly informationCount: number;
}

const scenarios: ReadonlyArray<Scenario> = [
  {
    id: "knee-replacement-missing-docs",
    request: kneeReplacementMissingDocs,
    expectedFirst: "info-needed",
    expectedFinal: "approved"
  },
  {
    id: "spinal-stimulator-human-review",
    request: spinalStimulatorReview,
    expectedFirst: "pended",
    expectedFinal: "approved"
  },
  {
    id: "non-covered-service",
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

const sleep = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

const fhirUrl = (path: string): URL => {
  const base = fhirBaseUrl.endsWith("/") ? fhirBaseUrl : `${fhirBaseUrl}/`;
  return new URL(path, base);
};

const fhirHeaders = {
  accept: "application/fhir+json",
  "content-type": "application/fhir+json"
};

const waitForFhir = async (): Promise<FhirResource> => {
  const deadline = Date.now() + 180_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(fhirUrl("metadata"), {
        headers: { accept: "application/fhir+json" }
      });
      if (response.ok) {
        return (await response.json()) as FhirResource;
      }
      lastError = `HTTP ${response.status}: ${await response.text()}`;
    } catch (error) {
      lastError = error;
    }

    await sleep(1_000);
  }

  throw new Error(
    `FHIR server did not become ready at ${fhirBaseUrl}: ${String(lastError)}`
  );
};

const upsertFhirResource = async (
  resource: FhirResource
): Promise<FhirResource> => {
  assert(resource.id, `${resource.resourceType} resource must have an id`);

  const response = await fetch(
    fhirUrl(`${resource.resourceType}/${encodeURIComponent(resource.id)}`),
    {
      method: "PUT",
      headers: fhirHeaders,
      body: JSON.stringify(resource)
    }
  );

  if (!response.ok) {
    throw new Error(
      `FHIR PUT ${resource.resourceType}/${resource.id} failed with HTTP ${
        response.status
      }: ${await response.text()}`
    );
  }

  return (await response.json()) as FhirResource;
};

const readFhirResource = async (
  resourceType: string,
  id: string
): Promise<FhirResource> => {
  const response = await fetch(
    fhirUrl(`${resourceType}/${encodeURIComponent(id)}`),
    {
      headers: { accept: "application/fhir+json" }
    }
  );

  if (!response.ok) {
    throw new Error(
      `FHIR GET ${resourceType}/${id} failed with HTTP ${
        response.status
      }: ${await response.text()}`
    );
  }

  return (await response.json()) as FhirResource;
};

const validateFhirResource = async (
  resource: FhirResource
): Promise<ValidationSummary> => {
  const response = await fetch(fhirUrl(`${resource.resourceType}/$validate`), {
    method: "POST",
    headers: fhirHeaders,
    body: JSON.stringify(resource)
  });

  if (!response.ok) {
    throw new Error(
      `FHIR $validate ${resource.resourceType}/${resource.id ?? "<new>"} failed with HTTP ${
        response.status
      }: ${await response.text()}`
    );
  }

  const outcome = (await response.json()) as {
    readonly issue?: ReadonlyArray<ValidationIssue>;
  };
  const issues = outcome.issue ?? [];
  const blocking = issues.filter(
    (issue) => issue.severity === "fatal" || issue.severity === "error"
  );

  if (blocking.length > 0) {
    throw new Error(
      `FHIR validation rejected ${resource.resourceType}/${
        resource.id ?? "<new>"
      }: ${JSON.stringify(blocking, null, 2)}`
    );
  }

  return {
    resourceType: resource.resourceType,
    id: resource.id ?? null,
    issueCount: issues.length,
    fatalCount: issues.filter((issue) => issue.severity === "fatal").length,
    errorCount: issues.filter((issue) => issue.severity === "error").length,
    warningCount: issues.filter((issue) => issue.severity === "warning").length,
    informationCount: issues.filter(
      (issue) => issue.severity === "information"
    ).length
  };
};

const validateAndUpsertFhirResource = async (
  resource: FhirResource
): Promise<{
  readonly resource: FhirResource;
  readonly validation: ValidationSummary;
}> => ({
  validation: await validateFhirResource(resource),
  resource: await upsertFhirResource(resource)
});

const withId = (resource: FhirResource, id: string): FhirResource => ({
  ...resource,
  id
});

const persistStepResponse = async (
  request: AuthorizationRequest,
  step: Determination,
  index: number
) => {
  const response = withId(
    toPasClaimResponse(request, step),
    `${step.authId}-${index + 1}-${step.status}`
  );
  const saved = await validateAndUpsertFhirResource(response);

  const questionnaires =
    step.status === "info-needed"
      ? await Promise.all(
          toDtrQuestionnaires(step.documentationRequired).map(
            validateAndUpsertFhirResource
          )
        )
      : [];

  return {
    responseId: saved.resource.id,
    outcome: saved.resource.outcome,
    validation: saved.validation,
    questionnaires: questionnaires.map((questionnaire) => ({
      id: questionnaire.resource.id,
      validation: questionnaire.validation
    }))
  };
};

const client = createX278Client(createX278HttpTransport({ baseUrl: payerUrl }), {
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `HAPI FHIR scenario evidence for ${requirement.id}`,
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

  const claimBundle = toPasClaimBundle(trace.finalRequest, trace.final.authId);
  const savedBundleResources = [];
  for (const entry of claimBundle.entry) {
    savedBundleResources.push(
      await validateAndUpsertFhirResource(entry.resource)
    );
  }

  const stepResponses = await Promise.all(
    trace.steps.map((step, index) =>
      persistStepResponse(trace.finalRequest, step, index)
    )
  );

  const finalResponse = toPasClaimResponse(trace.finalRequest, trace.final);
  const savedFinalResponse = await validateAndUpsertFhirResource(finalResponse);
  const readClaim = await readFhirResource("Claim", trace.final.authId);
  const readFinalResponse = await readFhirResource(
    "ClaimResponse",
    trace.final.authId
  );

  assert(readClaim.resourceType === "Claim", `${scenario.id} Claim readback failed`);
  assert(
    readFinalResponse.resourceType === "ClaimResponse",
    `${scenario.id} ClaimResponse readback failed`
  );
  assert(
    stepResponses.every((step) => step.responseId),
    `${scenario.id} missing persisted step response`
  );

  return {
    id: scenario.id,
    statuses: trace.steps.map((step) => step.status),
    authId: trace.final.authId,
    finalStatus: trace.final.status,
    persisted: {
      bundleResources: savedBundleResources.map(({ resource, validation }) => ({
        resourceType: resource.resourceType,
        id: resource.id,
        validation
      })),
      stepResponses,
      finalClaimResponse: {
        id: savedFinalResponse.resource.id,
        outcome: savedFinalResponse.resource.outcome,
        validation: savedFinalResponse.validation
      }
    }
  };
};

const main = async () => {
  const capabilityStatement = await waitForFhir();
  const scenarioReports = [];

  for (const scenario of scenarios) {
    scenarioReports.push(await runScenario(scenario));
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        payerUrl,
        fhirBaseUrl,
        fhir: {
          resourceType: capabilityStatement.resourceType,
          fhirVersion: capabilityStatement.fhirVersion
        },
        scenarios: scenarioReports
      },
      null,
      2
    )
  );
};

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
