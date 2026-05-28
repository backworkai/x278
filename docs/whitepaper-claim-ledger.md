# x278 Whitepaper Claim Ledger

This ledger is the proof boundary for the x278 whitepaper. A claim is considered **proven** only when it is backed by a primary source, executable test, or dogfood transcript. Claims that are strategic interpretation, implementation roadmap, or marketing framing are labeled as such.

## Proof Status Key

- **Proven - source**: supported by primary/public source.
- **Proven - executable**: verified by tests, `bun run dogfood`, or live SDK checks.
- **Partially proven**: local/reference behavior works, but real interoperability or production proof remains.
- **Not proven**: claim is interpretive, aspirational, or needs external validation.
- **Paper language**: rhetorical framing rather than a falsifiable claim.

## Claim Ledger

| ID | Paper Claim | Status | Evidence | Gap / Note |
| --- | --- | --- | --- | --- |
| PA-001 | Prior authorization imposes major administrative burden on physician practices. | Proven - source | AMA 2024 PA survey and AMA article. | Supported broadly; exact burden varies by specialty and payer. |
| PA-002 | Practices complete about 40 PAs per physician per week and spend 13 hours weekly. | Proven - source | AMA survey reports 39 PAs per physician/week and 13 hours/week. | Paper's "40" is rounded; ledger treats this as "nearly 40." |
| PA-003 | Much PA work is clerical relay rather than clinical judgment. | Partially proven | Supported by burden data and workflow descriptions; reflected by x278 design. | Needs time-and-motion or practice workflow study for strict proof. |
| PA-004 | Current channels include fax/phone, portals, X12 278, and FHIR PAS. | Proven - source | CMS and HL7 PAS docs discuss FHIR API, X12 flexibility, and PAS. | Relative performance comparisons remain model assumptions unless benchmarked. |
| PA-005 | Fax/phone and portals create human handoff friction. | Partially proven | Supported by CMS burden-reduction rationale and AMA burden data. | Exact latency/handoff counts require field data. |
| PA-006 | Opaque denials make resubmission/appeals harder. | Proven - source | CMS requires specific denial reasons and says this improves resubmission ability. | "Single largest source" language in paper is not proven. |
| PA-007 | CMS-0057-F requires impacted payers to implement FHIR APIs. | Proven - source | CMS CMS-0057-F fact sheet. | Exact payer applicability must be checked per payer. |
| PA-008 | CMS PA API must identify documentation requirements and support request/response. | Proven - source | CMS Prior Authorization API description. | Production implementation details vary. |
| PA-009 | PA API must communicate approval, denial with specific reason, or more information. | Proven - source | CMS fact sheet lines for PA API. | x278 adds `pended`; FHIR `queued` supports a pending/payer-processing concept. |
| PA-010 | Operational provisions generally begin January 1, 2026. | Proven - source | CMS CMS-0057-F fact sheet. | Exact compliance dates vary by payer type. |
| PA-011 | API development/enhancement requirements generally begin January 1, 2027. | Proven - source | CMS CMS-0057-F fact sheet. | Exact compliance dates vary by payer type. |
| PA-012 | Impacted payers excluding QHP issuers on FFEs must decide expedited requests within 72 hours and standard requests within seven calendar days. | Proven - source | CMS decision-timeframes section. | Timeframe is regulatory maximum, not x278 target. |
| PA-013 | CMS-0057-F excludes drugs from baseline PA API/process requirements. | Proven - source | CMS CMS-0057-F fact sheet and CMS FAQ. | Drug PA is future extension territory. |
| PA-014 | CMS-0062-P proposes extending PA requirements to drugs. | Proven - source | CMS 2026 drugs proposed rule fact sheet. | Proposed rule, not final as of May 28, 2026. |
| PA-015 | CMS estimates roughly $15B savings over ten years. | Proven - source | CMS press release says approximately $15B estimated savings over ten years. | It is an estimate, not guaranteed savings. |
| STD-001 | PAS uses FHIR `Claim` and `ClaimResponse` for prior authorization. | Proven - source / executable | HL7 PAS docs; `test/proof.test.ts` checks `Claim.use = "preauthorization"`. | Local mapping is PAS-style, not certified PAS profile validation. |
| STD-002 | PAS bundles can support X12 278/275 where applicable. | Proven - source | HL7 PAS docs. | x278 repo does not implement X12 conversion. |
| STD-003 | DTR uses FHIR `Questionnaire` / `QuestionnaireResponse` style documentation collection. | Proven - source / executable | HL7 DTR docs; `toDtrQuestionnaires` proof tests. | No real SDC/DTR package validation yet. |
| STD-004 | CRD discovers payer requirements in real time. | Proven - source | HL7 CRD docs. | Repo does not implement a CRD adapter yet. |
| STD-005 | FHIR `ClaimResponse.outcome` supports `queued`, `complete`, `error`, and `partial`. | Proven - source / executable | FHIR R4 ClaimResponse docs; proof tests map `pended` to `queued`. | Pended semantics vary by payer implementation. |
| X402-001 | x402 uses HTTP 402 to prompt payment and retry. | Proven - source | x402 docs/site. | x278 borrows the pattern only; it is not a payment protocol. |
| X278-001 | x278 provider agent can submit a structured request. | Proven - executable | `AuthorizationRequestSchema`, `test/x278.test.ts`, `bun run dogfood`. | Real EHR extraction not implemented. |
| X278-002 | x278 payer agent can return `approved`, `denied`, `info-needed`, and `pended`. | Proven - executable | Unit tests, proof tests, dogfood transcript. | Current rule set is a mock reference policy. |
| X278-003 | `info-needed` includes exact documentation requirements and a resume token. | Proven - executable | `test/x278.test.ts`, `test/proof.test.ts`, dogfood transcript. | Real DTR Questionnaire resources are generated locally, not payer-published. |
| X278-004 | `info-needed` retry preserves the same `authId`. | Proven - executable | Unit/proof tests assert same `authId`. | Production idempotency store not implemented. |
| X278-005 | `pended` returns a wait/subscription path and later resolves. | Proven - executable | Unit/proof tests and dogfood transcript. | Subscription is simulated as `x278://subscription/...`; no FHIR server callback. |
| X278-006 | Denial includes coded reason, human-readable text, and appeal path. | Proven - executable | Unit tests and PAS response mapping. | Payer-specific denial code system not implemented. |
| X278-007 | Terminal determinations are signed. | Proven - executable | Ed25519 signing tests and dogfood verification. | Needs JWKS/DID publication and key rotation for production. |
| X278-008 | Terminal determinations are logged in audit records. | Proven - executable | Unit/proof tests and dogfood audit count. | In-memory audit only; no durable store. |
| X278-009 | Deterministic local authorization can resolve under 15 seconds. | Proven - executable | `test/proof.test.ts` measures local deterministic approval under 15 seconds. | Does not prove real payer network latency or production SLA. |
| X278-010 | Human review is reserved for exception paths. | Proven - executable in mock | Deterministic cases resolve by rules; spinal-stimulator fixture returns `human-review`. | Needs real policy corpus to quantify "exceptions only." |
| X278-011 | x278 is agent-native. | Partially proven | Provider client loop, OpenAI Agents SDK live test, Anthropic reviewer live test. | Needs real EHR/payer agent integration and operator UX. |
| X278-012 | x278 layers on PAS/DTR/CRD/X12 rather than replacing them. | Partially proven | PAS/DTR mapping exists; CMS/HL7 sources support rails. | CRD and X12 adapters not implemented. |
| REF-001 | Reference implementation should include core library, middleware, client, signing, adapters. | Partially proven | Core library/client/signing/PAS-DTR mapping exist. | HTTP middleware and CRD/X12 adapters remain. |
| REF-002 | Toolkit should include mock payer, fixtures, pended/human-review, verbose logs. | Partially proven | Mock payer, fixtures, tests, dogfood transcript exist. | Logs are JSON transcript, not full local server observability. |
| MKT-001 | "Prior authorization is slow because the channel is human, not because decisions are hard." | Paper language | Plausible thesis supported by burden data and deterministic examples. | Overbroad; some decisions are clinically hard. |
| MKT-002 | "Rejection ships the spec." | Paper language | Design analogy to x402. | Rhetorical phrase, not a provable fact. |
| MKT-003 | "Human touches only exceptions." | Partially proven | Mock workflow does this. | Real-world proof requires production pilot metrics. |

## Commands That Produce Evidence

```bash
bun run prove
bun run dogfood
bun run test
bun run test:live
```

## Primary Sources

- CMS CMS-0057-F fact sheet: https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f
- CMS CMS-0057-F press release: https://www.cms.gov/newsroom/press-releases/cms-finalizes-rule-expand-access-health-information-and-improve-prior-authorization-process
- CMS CMS-0062-P fact sheet: https://www.cms.gov/newsroom/fact-sheets/2026-cms-interoperability-standards-prior-authorization-drugs-proposed-rule
- AMA PA survey PDF: https://www.ama-assn.org/system/files/prior-authorization-survey.pdf
- AMA prior authorization article: https://www.ama-assn.org/practice-management/prior-authorization/fixing-prior-auth-nearly-40-prior-authorizations-week-way
- HL7 Da Vinci PAS: https://hl7.org/fhir/us/davinci-pas/STU2.1/specification.html
- HL7 Da Vinci DTR: https://hl7.org/fhir/us/davinci-dtr/specification.html
- HL7 Da Vinci CRD: https://www.hl7.org/fhir/us/davinci-crd/STU2/usecases.html
- FHIR R4 ClaimResponse: https://www.hl7.org/fhir/r4/claimresponse.html
- x402 docs: https://docs.x402.org/core-concepts/http-402
