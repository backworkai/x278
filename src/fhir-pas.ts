import type {
  AuthorizationRequest,
  Determination,
  DocumentationRequirement
} from "./domain.js";

export interface FhirResource {
  readonly resourceType: string;
  readonly id?: string;
  [key: string]: unknown;
}

export interface FhirBundle extends FhirResource {
  readonly resourceType: "Bundle";
  readonly type: "collection";
  readonly entry: ReadonlyArray<{
    readonly fullUrl: string;
    readonly resource: FhirResource;
  }>;
}

const claimTypeProfessional = {
  coding: [
    {
      system: "http://terminology.hl7.org/CodeSystem/claim-type",
      code: "professional"
    }
  ]
};

const identifier = (system: string, value: string) => ({
  system,
  value
});

const patientId = (request: AuthorizationRequest) =>
  `patient-${request.patient.memberId.toLowerCase()}`;

const providerId = (request: AuthorizationRequest) =>
  `provider-${request.provider.npi}`;

const coverageId = (request: AuthorizationRequest) =>
  `coverage-${request.patient.memberId.toLowerCase()}`;

export const toPasClaimBundle = (
  request: AuthorizationRequest,
  authId: string
): FhirBundle => {
  const patient: FhirResource = {
    resourceType: "Patient",
    id: patientId(request),
    identifier: [
      identifier("urn:backwork:member-id", request.patient.memberId)
    ],
    birthDate: request.patient.dob
  };

  const provider: FhirResource = {
    resourceType: "Organization",
    id: providerId(request),
    identifier: [
      identifier("http://hl7.org/fhir/sid/us-npi", request.provider.npi),
      identifier("urn:irs:tin", request.provider.tin)
    ]
  };

  const coverage: FhirResource = {
    resourceType: "Coverage",
    id: coverageId(request),
    status: "active",
    beneficiary: {
      reference: `Patient/${patient.id}`
    },
    payor: [
      {
        display: "Backwork Reference Payer"
      }
    ]
  };

  const diagnosis = request.service.diagnosis.map((code, index) => ({
    sequence: index + 1,
    diagnosisCodeableConcept: {
      coding: [
        {
          system: "http://hl7.org/fhir/sid/icd-10-cm",
          code
        }
      ]
    }
  }));
  const diagnosisSequence = request.service.diagnosis.map(
    (_, index) => index + 1
  );
  const supportingInfo = request.supportingInfo.map((info, index) => ({
    sequence: index + 1,
    category: {
      coding: [
        {
          system: "https://backwork.example/fhir/CodeSystem/x278-supporting-info",
          code: info.id
        }
      ]
    },
    valueString: info.value
  }));

  const claim: FhirResource = {
    resourceType: "Claim",
    id: authId,
    status: "active",
    use: "preauthorization",
    type: claimTypeProfessional,
    patient: {
      reference: `Patient/${patient.id}`
    },
    provider: {
      reference: `Organization/${provider.id}`
    },
    insurance: [
      {
        sequence: 1,
        focal: true,
        coverage: {
          reference: `Coverage/${coverage.id}`
        }
      }
    ],
    created: new Date().toISOString(),
    priority: {
      coding: [
        {
          system: "http://terminology.hl7.org/CodeSystem/processpriority",
          code: request.service.urgency === "expedited" ? "stat" : "normal"
        }
      ]
    },
    ...(diagnosis.length > 0 ? { diagnosis } : {}),
    item: [
      {
        sequence: 1,
        productOrService: {
          coding: [
            {
              system:
                request.service.codeSystem === "CPT"
                  ? "http://www.ama-assn.org/go/cpt"
                  : request.service.codeSystem,
              code: request.service.code
            }
          ]
        },
        ...(diagnosisSequence.length > 0 ? { diagnosisSequence } : {}),
        quantity: {
          value: request.service.units
        },
        servicedDate: request.service.requestedStart,
        locationCodeableConcept: {
          coding: [
            {
              system:
                "https://www.cms.gov/Medicare/Coding/place-of-service-codes",
              code: request.service.placeOfService
            }
          ]
        }
      }
    ],
    ...(supportingInfo.length > 0 ? { supportingInfo } : {})
  };

  return {
    resourceType: "Bundle",
    id: `pas-${authId}`,
    type: "collection",
    entry: [
      {
        fullUrl: `urn:uuid:${patient.id}`,
        resource: patient
      },
      {
        fullUrl: `urn:uuid:${provider.id}`,
        resource: provider
      },
      {
        fullUrl: `urn:uuid:${coverage.id}`,
        resource: coverage
      },
      {
        fullUrl: `urn:uuid:claim-${authId}`,
        resource: claim
      }
    ]
  };
};

export const toDtrQuestionnaires = (
  requirements: ReadonlyArray<DocumentationRequirement>
): ReadonlyArray<FhirResource> =>
  requirements.map((requirement) => ({
    resourceType: "Questionnaire",
    id: requirement.id,
    url: requirement.questionnaire,
    status: "active",
    title: requirement.description,
    item: [
      {
        linkId: requirement.id,
        text: requirement.description,
        type: "text",
        required: true
      }
    ]
  }));

const outcomeFor = (determination: Determination): "complete" | "partial" | "queued" | "error" => {
  switch (determination.status) {
    case "approved":
    case "denied":
      return "complete";
    case "info-needed":
      return "partial";
    case "pended":
      return "queued";
    case "error":
      return "error";
  }
};

const dispositionFor = (determination: Determination): string => {
  switch (determination.status) {
    case "approved":
      return "Approved";
    case "denied":
      return `${determination.reasonCode}: ${determination.reasonText}`;
    case "info-needed":
      return `Additional information required: ${determination.documentationRequired
        .map((requirement) => requirement.id)
        .join(", ")}`;
    case "pended":
      return `Pending payer action: ${determination.pendingReason}`;
    case "error":
      return `${determination.reasonCode}: ${determination.reasonText}`;
  }
};

export const toPasClaimResponse = (
  request: AuthorizationRequest,
  determination: Determination
): FhirResource => {
  const response: FhirResource = {
    resourceType: "ClaimResponse",
    id: determination.authId,
    status: "active",
    use: "preauthorization",
    type: claimTypeProfessional,
    patient: {
      reference: `Patient/${patientId(request)}`
    },
    created: new Date().toISOString(),
    insurer: {
      display: "Backwork Reference Payer"
    },
    request: {
      reference: `Claim/${determination.authId}`
    },
    outcome: outcomeFor(determination),
    disposition: dispositionFor(determination)
  };

  if (determination.status === "approved") {
    response.preAuthRef = determination.authNumber;
    response.preAuthPeriod = {
      start: determination.validFrom,
      end: determination.validThrough
    };
  }

  if (determination.status === "denied") {
    response.processNote = [
      {
        number: 1,
        type: "display",
        text: determination.reasonText
      }
    ];
  }

  if (determination.status === "info-needed") {
    response.extension = determination.documentationRequired.map((requirement) => ({
      url: "https://backwork.example/fhir/StructureDefinition/x278-dtr-questionnaire",
      valueCanonical: requirement.questionnaire
    }));
    response.processNote = [
      {
        number: 1,
        type: "display",
        text: dispositionFor(determination)
      }
    ];
  }

  if (determination.status === "pended") {
    response.preAuthRef = determination.authId;
    response.extension = [
      {
        url: "https://backwork.example/fhir/StructureDefinition/x278-subscription",
        valueUrl: determination.subscription
      }
    ];
  }

  return response;
};
