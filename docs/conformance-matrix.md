# x278 Proof Matrix

This matrix turns the whitepaper claims into executable evidence. The reference implementation proves protocol behavior locally; it does not yet prove payer-sandbox or certified PAS conformance.

## Standards Anchors

- [CMS-0057-F](https://www.cms.gov/newsroom/fact-sheets/cms-interoperability-and-prior-authorization-final-rule-cms-0057-f) says impacted payers' Prior Authorization APIs must identify documentation requirements and support approval, denial with a specific reason, or a request for more information.
- [Da Vinci PAS STU 2.1](https://hl7.org/fhir/us/davinci-pas/STU2.1/specification.html) uses FHIR `Claim` and `ClaimResponse` for prior authorization, with `Claim.use = "preauthorization"`.
- [Da Vinci DTR STU 2.1](https://hl7.org/fhir/us/davinci-dtr/specification.html) uses FHIR `Questionnaire` / `QuestionnaireResponse` patterns for documentation templates and rules.
- [FHIR ClaimResponse](https://www.hl7.org/fhir/r4/claimresponse.html) supports `queued`, `complete`, `error`, and `partial`; `queued` is the proof anchor for a pended/payer-processing state.

## Executable Claims

| ID | Whitepaper Claim | Current Executable Proof | Remaining Gap |
| --- | --- | --- | --- |
| X278-001 | Provider agent submits structured authorization request | `AuthorizationRequestSchema`, unit tests, dogfood transcript | EHR extraction adapter |
| X278-002 | Payer returns `approved`, `denied`, `info-needed`, or `pended` | `test/x278.test.ts` and `bun run dogfood` cover all states | Broader payer policy corpus |
| X278-003 | `info-needed` is actionable and resumes same auth context | Tests assert exact documentation list, resume token, same `authId`, signed approval | Real DTR Questionnaire packages and QuestionnaireResponse submission |
| X278-004 | `pended` preserves continuity until final determination | Tests assert queued/pended state and later clinical-review determination on same `authId` | Real FHIR Subscription / payer callback |
| X278-005 | Denial is coded and appeal-actionable | Tests assert `reasonCode`, `reasonText`, and `appealPath`; PAS response has process note | Payer-specific denial code systems |
| X278-006 | Determinations are signed and logged | Ed25519 receipt verification and audit-record tests | Durable audit store, JWKS/DID key rotation |
| X278-007 | x278 is a thin shape over PAS/DTR/FHIR rails | `test/proof.test.ts` checks PAS `Claim`, `ClaimResponse`, and DTR `Questionnaire` mappings | Official HL7 validator / payer sandbox certification |

## Proof Commands

```bash
bun run dogfood
bun run test
bun run test:live
```

Use `bun run test:all` when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are available.
