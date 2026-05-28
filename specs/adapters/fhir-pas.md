# FHIR PAS Adapter

x278 is an agent-facing envelope over existing prior authorization rails. A FHIR/PAS adapter maps the core x278 shapes to implementation-guide artifacts.

## Mapping Targets

| x278 concept | FHIR / PAS target |
| --- | --- |
| Authorization request | PAS `Claim` bundle |
| Determination | PAS `ClaimResponse` |
| Missing documentation | DTR `Questionnaire` or supporting-information request |
| Coverage rule discovery | CRD hooks or cached rule lookup |
| Terminal receipt | FHIR `Provenance` / `Signature` profile or detached x278 receipt |
| Audit record | FHIR `AuditEvent`, append-only log, or both |

## Adapter Responsibilities

- Preserve `authId` across retries and pended resolution.
- Preserve coded denial reasons and appeal paths.
- Preserve DTR questionnaire identifiers for `info-needed`.
- Preserve `pendingReason` and reviewer path for `pended`.
- Keep x278 signing independent from FHIR server persistence.

## Non-Goals

- Replacing Da Vinci PAS, DTR, or CRD.
- Defining X12 278/275 conversion rules in this repo.
- Claiming clinical correctness from a signed receipt alone.

The signature proves what was returned for a canonical request and policy version. Reproducible adjudication requires executable rules and canonical data mappings from the payer.
