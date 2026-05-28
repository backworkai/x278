# x278 HTTP Transport

This is the draft HTTP representation for x278. The core protocol remains transport-neutral.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/authorize` | Submit a new authorization request |
| `POST` | `/authorize/{authId}/resume` | Attach evidence for an `info-needed` request |
| `GET` | `/subscriptions/{authId}` | Await or poll a pended determination |
| `GET` | `/audit/{authId}` | Retrieve terminal audit records when permitted |

## Request Headers

| Header | Purpose |
| --- | --- |
| `Content-Type: application/json` | JSON request/response payloads |
| `Idempotency-Key` | Client-generated replay guard for new requests |
| `Authorization` | SMART Backend Services, OAuth2, OIDC, or sandbox credential |
| `X278-Version` | Requested x278 protocol version |

## Response Codes

| HTTP status | x278 meaning |
| --- | --- |
| `200` | Terminal or non-terminal determination returned |
| `202` | Pended request accepted when no immediate body is available |
| `400` | Malformed request |
| `401` / `403` | Authentication or authorization failure |
| `409` | Idempotency or replay conflict |
| `422` | Semantically invalid request |

## Body Semantics

HTTP transports should carry the same core `Determination` object used by SDK transports. Headers may duplicate metadata for routing, but the body remains authoritative.

## Out of Scope

- Production payer authentication details
- SMART/OAuth client registration
- FHIR server persistence
- Push notification delivery

Those belong in implementation profiles, not the core transport draft.
