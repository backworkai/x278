# x278 Protocol Specification

Protocol version: v0 reference draft

## Scope

x278 defines an agent-native prior authorization exchange. It standardizes the request shape, determination states, retry semantics, pended semantics, and signed terminal receipts. It does not define payer medical policy, clinical correctness, provider credentialing, or production compliance controls.

## Actors

- **Provider agent**: submits authorization requests, gathers evidence, resumes `info-needed` requests, and awaits `pended` determinations.
- **Payer agent**: evaluates requests against a policy version, returns actionable determinations, signs terminal determinations, and records audit entries.
- **Clinical reviewer**: handles pended cases requiring human judgment.
- **Audit log**: records terminal determinations and their hashes.

## Request

An authorization request contains:

- `patient.memberId`
- `patient.dob`
- `provider.npi`
- `provider.tin`
- `service.code`
- `service.codeSystem`
- `service.diagnosis[]`
- `service.placeOfService`
- `service.requestedStart`
- `service.units`
- `service.urgency`
- `supportingInfo[]`

The reference SDK validates dates, NPI/TIN shape, positive integer units, and evidence source values.

## Determination States

| State | Terminal | Next action | Required fields |
| --- | --- | --- | --- |
| `approved` | yes | `none` | `authNumber`, `approvedUnits`, `validFrom`, `validThrough`, `signature` |
| `denied` | yes | `appeal` | `reasonCode`, `reasonText`, `appealPath`, `signature` |
| `info-needed` | no | `attach-evidence` | `documentationRequired[]`, `resumeToken` |
| `pended` | no | `await-payer` | `pendingReason`, `subscription` |
| `error` | no | `contact-payer` | `reasonCode`, `reasonText` |

Terminal determinations must be signed. Non-terminal states must be actionable.

## Retry Semantics

`info-needed` is a retry, not a restart.

1. Payer returns `authId`, `documentationRequired[]`, and `resumeToken`.
2. Provider attaches evidence matching the requested documentation.
3. Provider resumes with the same `authId` and `resumeToken`.
4. Payer either returns a terminal determination or another `info-needed` with a new resume token.

Resume token replay after terminal resolution must fail.

## Pended Semantics

`pended` means the request was accepted but cannot be determined synchronously.

1. Payer returns `authId`, `pendingReason`, and `subscription`.
2. Provider awaits the subscription.
3. Payer returns a signed terminal determination.
4. Subscription replay after resolution must fail.

## Signing

The reference implementation signs terminal determinations with Ed25519 over a canonical payload containing:

- canonical request hash
- unsigned determination body
- key id
- issued-at timestamp
- nonce

Verification must fail if the request, determination body, payload hash, or signature changes.

## Audit

Each terminal determination appends an audit record with:

- `authId`
- terminal `status`
- request hash
- determination hash
- signing key id
- append timestamp

The audit log proves what was returned, not whether the payer's underlying medical policy was clinically correct.

## Versioning

This v0 draft is intended for reference implementation and conformance development. Breaking changes are allowed until the first stable protocol version is declared.
