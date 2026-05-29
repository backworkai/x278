# x278

[![npm](https://img.shields.io/npm/v/@backwork/x278.svg)](https://www.npmjs.com/package/@backwork/x278)
[![CI](https://github.com/backworkai/x278/actions/workflows/ci.yml/badge.svg)](https://github.com/backworkai/x278/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2D2824.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-C65D3D.svg)](https://bun.sh)
[![Effect TS](https://img.shields.io/badge/Effect-3.x-2F8F83.svg)](https://effect.website)

TypeScript SDK and reference implementation for x278, Backwork's proposed
agent-native protocol for prior authorization.

x278 models prior authorization as a typed exchange between provider-side and
payer-side software agents. A provider agent submits a structured request. A
payer agent returns an actionable determination: `approved`, `denied`,
`info-needed`, or `pended`. The provider agent can then attach evidence, wait for
review, correct the request, or appeal without restarting the authorization
context.

This package is a protocol SDK and runnable reference environment. It is not a
certified payer integration, a substitute for Da Vinci PAS conformance testing,
or legal/compliance advice.

## Install

```bash
npm install @backwork/x278
```

```bash
bun add @backwork/x278
```

The package ships dual ESM/CJS builds, declaration maps, and subpath exports for
SDK, HTTP transport, FHIR/PAS helpers, signing, conformance, and protocol types.

## Quick Start

Run the provider loop against the deterministic in-memory payer:

```ts
import {
  createMockX278Client,
  kneeReplacementMissingDocs
} from "@backwork/x278";

const client = createMockX278Client({
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `chart evidence for ${requirement.id}`,
      source: "chart"
    }))
});

const trace = await client.requestWithTrace(kneeReplacementMissingDocs);

console.log(trace.steps.map((step) => step.status));
// ["info-needed", "approved"]

console.log(trace.final.authNumber);
```

The same client loop also handles `pended` determinations by awaiting the
returned subscription handle, and `denied` determinations by returning a coded
reason plus appeal path.

## HTTP Client

Use `@backwork/x278/http` when calling an x278-compatible payer endpoint:

```ts
import { createX278HttpClient } from "@backwork/x278/http";

const client = createX278HttpClient({
  baseUrl: "https://payer.example/x278",
  bearerToken: process.env.X278_BEARER_TOKEN,
  collectEvidence: async (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: "supporting chart evidence",
      source: "chart"
    }))
});

const capabilities = await client.capabilities();
const determination = await client.request({
  patient: { memberId: "A1234567", dob: "1971-03-02" },
  provider: { npi: "1972648392", tin: "84-1234567" },
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
});
```

The HTTP client includes production-oriented defaults:

- 30 second request timeout
- retry support for transient HTTP failures
- `Retry-After` handling
- bearer token and custom header hooks
- request, response, retry, and error lifecycle hooks
- redacted debug logging
- typed `ProtocolError` failures with request IDs where available
- `/.well-known/x278` capabilities discovery

For local parity, `createX278HttpClientFromEnv()` reads `X278_PAYER_URL` and
`X278_BEARER_TOKEN`.

## Protocol States

| State | Meaning | Next action |
| --- | --- | --- |
| `approved` | Authorization approved by rules or reviewer | Use the returned authorization number and validity window |
| `denied` | Request denied with coded reason and appeal path | Correct, resubmit, or appeal |
| `info-needed` | Payer needs specific documentation | Attach evidence and resume the same `authId` |
| `pended` | Request accepted but not final | Await the returned subscription/update handle |
| `error` | Malformed or unprocessable exchange | Fix the request or contact the payer |

## Public Exports

| Import | Purpose |
| --- | --- |
| `@backwork/x278` | Full public SDK surface |
| `@backwork/x278/http` | Fetch-backed HTTP client and transport |
| `@backwork/x278/sdk` | Promise and Effect provider clients |
| `@backwork/x278/conformance` | Conformance harness for x278 transports |
| `@backwork/x278/types` | Protocol schemas, domain types, and typed errors |
| `@backwork/x278/schemas` | Schema-focused alias for protocol validation |
| `@backwork/x278/fhir-pas` | FHIR/PAS/DTR mapping helpers |
| `@backwork/x278/signing` | Canonical hashing and signed receipt utilities |
| `@backwork/x278/payer-agent` | Reference payer agent service |
| `@backwork/x278/provider-client` | Lower-level provider loop primitives |

## Effect and Promise APIs

x278 is implemented with Effect schemas and services internally, while exposing a
Promise API for conventional TypeScript applications.

- Use `createX278EffectClient` and `runX278ConformanceEffect` inside Effect
  applications.
- Use `createX278Client`, `createX278HttpClient`, and `runX278Conformance` in
  Promise-based services.
- API boundaries accept `unknown` where appropriate and validate into typed
  protocol objects before transport use.

## Conformance

Transport implementers can run the conformance harness against any x278 transport:

```ts
import { createMockPayer, runX278Conformance } from "@backwork/x278";

const report = await runX278Conformance(createMockPayer());

if (!report.ok) {
  throw new Error("x278 conformance failed");
}
```

The harness exercises the core behaviors described by the protocol: approval,
denial, information-needed retry, pended review, signature verification, audit
records, and bounded workflow handling.

## Examples

The repository includes runnable examples that use the same public package
exports consumers install from npm:

| Command | What it shows |
| --- | --- |
| `bun run example:mock` | Full provider loop against the in-memory payer, including `info-needed`, `pended`, and `denied` paths |
| `bun run example:conformance` | Running the conformance harness against a transport |
| `bun run payer:http` + `bun run example:http` | HTTP client usage against the local reference payer |

For the HTTP example, start the payer in one terminal:

```bash
bun run payer:http
```

Then run the client from another terminal:

```bash
bun run example:http
```

## Local Development

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Useful verification commands:

| Command | Purpose |
| --- | --- |
| `bun run test` | Unit and protocol behavior tests |
| `bun run test:live` | Live OpenAI Agents SDK and Anthropic SDK proof tests |
| `bun run release:smoke` | Packaged ESM/CJS consumer smoke test |
| `bun run release:attw` | Package export/type validation |
| `bun run docker:realistic` | Provider and payer containers over HTTP |
| `bun run docker:fhir` | HTTP scenario with HAPI FHIR validation |
| `bun run prove:full` | Full local release proof gate |

Live agent tests require provider API keys in the environment. The normal test
suite does not call paid model APIs.

## Specification

- [Core x278 specification](specs/x278-specification-v0.md)
- [HTTP transport](specs/transports/http.md)
- [FHIR/PAS adapter expectations](specs/adapters/fhir-pas.md)

x278 is designed to interoperate with FHIR prior authorization infrastructure,
including Da Vinci PAS, DTR, and CRD patterns, rather than replace those rails.
Where X12 278/275 applies, production implementers still need the appropriate
mapping, licensing, and trading-partner testing outside this SDK.

## Status and Boundaries

The repository currently includes:

- protocol schemas and typed determination states
- Promise and Effect SDK clients
- production HTTP client and transport
- deterministic reference payer agent
- signed terminal determinations and audit records
- FHIR/PAS mapping helpers
- conformance and release proof harnesses
- Docker-based realistic scenarios

Before production healthcare use, organizations still need real payer endpoint
registration, SMART Backend Services/OAuth configuration, PAS/FHIR conformance
testing, HIPAA/security review, operational monitoring, and policy/legal review.

This project is not affiliated with CMS, HL7, X12, or the Da Vinci Project.

## License

MIT. See [LICENSE](LICENSE).
