import { Effect } from "effect";
import type { AuthorizationRequest, DocumentationRequirement, SupportingInfo } from "./domain.js";
import { ProtocolError, decodeSupportingInfoList } from "./domain.js";
import type { FhirResource } from "./fhir-pas.js";

export type EvidenceValueResolver = (
  requirement: DocumentationRequirement
) => string | SupportingInfo;

export interface DtrQuestionnaireResponseOptions {
  readonly authored?: string;
  readonly authorReference?: string;
  readonly subjectReference?: string;
}

const isEvidenceArray = (
  value: AuthorizationRequest | ReadonlyArray<SupportingInfo>
): value is ReadonlyArray<SupportingInfo> => Array.isArray(value);

const evidenceIds = (
  evidenceOrRequest: AuthorizationRequest | ReadonlyArray<SupportingInfo>
): Set<string> => {
  const evidence: ReadonlyArray<SupportingInfo> = isEvidenceArray(evidenceOrRequest)
    ? evidenceOrRequest
    : evidenceOrRequest.supportingInfo;

  return new Set(evidence.map((item) => item.id));
};

/**
 * Creates a supporting-info attachment for a documentation requirement.
 *
 * @example
 * const evidence = createEvidenceForRequirement(requirement, "chart note text");
 */
export const createEvidenceForRequirement = (
  requirement: DocumentationRequirement,
  value: string,
  source: SupportingInfo["source"] = "chart"
): SupportingInfo => ({
  id: requirement.id,
  value,
  source
});

/**
 * Creates evidence for every returned documentation requirement.
 */
export const createEvidenceForRequirements = (
  requirements: ReadonlyArray<DocumentationRequirement>,
  resolve: EvidenceValueResolver
): ReadonlyArray<SupportingInfo> =>
  requirements.map((requirement) => {
    const resolved = resolve(requirement);
    return typeof resolved === "string"
      ? createEvidenceForRequirement(requirement, resolved)
      : resolved;
  });

/**
 * Returns the requirements not yet satisfied by the supplied request/evidence.
 */
export const missingEvidenceRequirements = (
  requirements: ReadonlyArray<DocumentationRequirement>,
  evidenceOrRequest: AuthorizationRequest | ReadonlyArray<SupportingInfo>
): ReadonlyArray<DocumentationRequirement> => {
  const supplied = evidenceIds(evidenceOrRequest);
  return requirements.filter((requirement) => !supplied.has(requirement.id));
};

export const evidenceSatisfiesRequirements = (
  requirements: ReadonlyArray<DocumentationRequirement>,
  evidenceOrRequest: AuthorizationRequest | ReadonlyArray<SupportingInfo>
): boolean => missingEvidenceRequirements(requirements, evidenceOrRequest).length === 0;

export const assertEvidenceSatisfiesRequirements = async (
  requirements: ReadonlyArray<DocumentationRequirement>,
  evidence: unknown
): Promise<ReadonlyArray<SupportingInfo>> => {
  const decoded = await Effect.runPromise(decodeSupportingInfoList(evidence));
  const missing = missingEvidenceRequirements(requirements, decoded);

  if (missing.length > 0) {
    throw new ProtocolError({
      kind: "validation",
      reason: "evidence-missing-requirements",
      detail: missing
    });
  }

  return decoded;
};

/**
 * Converts x278 evidence into DTR-style QuestionnaireResponse resources.
 */
export const toDtrQuestionnaireResponses = (
  requirements: ReadonlyArray<DocumentationRequirement>,
  evidence: ReadonlyArray<SupportingInfo>,
  options: DtrQuestionnaireResponseOptions = {}
): ReadonlyArray<FhirResource> => {
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));

  return requirements.map((requirement) => {
    const answer = evidenceById.get(requirement.id);

    return {
      resourceType: "QuestionnaireResponse",
      id: `qr-${requirement.id}`,
      questionnaire: requirement.questionnaire,
      status: answer ? "completed" : "in-progress",
      ...(options.authored ? { authored: options.authored } : {}),
      ...(options.authorReference
        ? { author: { reference: options.authorReference } }
        : {}),
      ...(options.subjectReference
        ? { subject: { reference: options.subjectReference } }
        : {}),
      item: [
        {
          linkId: requirement.id,
          text: requirement.description,
          ...(answer
            ? {
                answer: [
                  {
                    valueString: answer.value
                  }
                ]
              }
            : {})
        }
      ]
    };
  });
};
