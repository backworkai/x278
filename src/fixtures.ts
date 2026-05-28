import type { AuthorizationRequest } from "./domain.js";

const provider = {
  npi: "1972648392",
  tin: "84-1234567"
};

const patient = {
  memberId: "A1234567",
  dob: "1971-03-02"
};

export const kneeReplacementMissingDocs: AuthorizationRequest = {
  patient,
  provider,
  service: {
    code: "27447",
    codeSystem: "CPT",
    diagnosis: ["M17.11"],
    placeOfService: "21",
    requestedStart: "2026-06-01",
    units: 1,
    urgency: "standard"
  },
  supportingInfo: []
};

export const kneeReplacementComplete: AuthorizationRequest = {
  ...kneeReplacementMissingDocs,
  supportingInfo: [
    {
      id: "conservative-tx-6wk",
      value: "Physical therapy and NSAID trial documented for eight weeks.",
      source: "chart"
    },
    {
      id: "weight-bearing-xray",
      value: "Weight-bearing x-ray confirms severe right knee OA.",
      source: "chart"
    }
  ]
};

export const nonCoveredService: AuthorizationRequest = {
  patient,
  provider,
  service: {
    code: "99999",
    codeSystem: "CPT",
    diagnosis: ["Z00.00"],
    placeOfService: "11",
    requestedStart: "2026-06-01",
    units: 1,
    urgency: "standard"
  },
  supportingInfo: []
};

export const spinalStimulatorReview: AuthorizationRequest = {
  patient,
  provider,
  service: {
    code: "63650",
    codeSystem: "CPT",
    diagnosis: ["M54.16"],
    placeOfService: "22",
    requestedStart: "2026-06-03",
    units: 1,
    urgency: "standard"
  },
  supportingInfo: []
};
