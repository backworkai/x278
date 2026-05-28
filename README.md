# x278

[![CI](https://github.com/backworkai/x278/actions/workflows/ci.yml/badge.svg)](https://github.com/backworkai/x278/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2D2824.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-C65D3D.svg)](https://bun.sh)
[![Effect TS](https://img.shields.io/badge/Effect-3.x-2F8F83.svg)](https://effect.website)

An agent-native reference implementation for x278: Backwork's proposed prior authorization protocol for software agents.

x278 turns the prior authorization exchange into a typed, agent-driven loop:

1. provider agent submits a structured request
2. payer agent returns `approved`, `denied`, `info-needed`, or `pended`
3. provider agent attaches evidence or awaits review without restarting the queue
4. terminal determinations are signed, verified, and audit logged

This repository is not a production payer integration. It is a runnable protocol sandbox and SDK foundation for evaluating behavior before wiring to real Da Vinci PAS, DTR, CRD, X12 278/275, payer sandbox endpoints, or FHIR servers.

## Status

Reference implementation. The protocol shape, SDK, conformance harness, FHIR/PAS mapping helpers, signatures, and audit records are implemented. Real payer integrations and executable payer policy publication are intentionally out of scope for this repo's first milestone.

## Quickstart

```bash
bun install
bun run build
```

## Install From GitHub

```bash
bun add github:backworkai/x278
```

Because this is still a reference implementation, the package is marked private to prevent accidental npm publication. Import paths are already structured like a normal SDK package.

## SDK Usage

```ts
import {
  createMockPayer,
  createMockX278Client,
  runX278Conformance
} from "@backwork/x278";

const client = createMockX278Client({
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `chart evidence for ${requirement.id}`,
      source: "chart"
    }))
});

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

const report = await runX278Conformance(createMockPayer());
```

The SDK exports both Effect-native and Promise-based surfaces. Use `createX278EffectClient` and `runX278ConformanceEffect` inside Effect applications; use `createX278Client` for conventional TypeScript services.

Useful import surfaces:

| Import | Purpose |
| --- | --- |
| `@backwork/x278` | Full public surface |
| `@backwork/x278/http` | HTTP transport for provider-to-payer process boundaries |
| `@backwork/x278/sdk` | Promise and Effect SDK clients |
| `@backwork/x278/conformance` | Conformance harness |
| `@backwork/x278/types` | Protocol schemas and types |
| `@backwork/x278/fhir-pas` | FHIR/PAS/DTR mapping helpers |
| `@backwork/x278/signing` | Canonical hashing and receipt verification |

## Protocol States

| State | Meaning | Next action |
| --- | --- | --- |
| `approved` | Deterministic or reviewed approval | Use authorization number |
| `denied` | Coded denial with appeal path | Correct/resubmit or appeal |
| `info-needed` | Missing documentation with DTR-style requirements | Attach evidence and resume same `authId` |
| `pended` | Accepted but awaiting payer-side processing/review | Await returned subscription |
| `error` | Malformed or unprocessable exchange | Contact payer or fix request |

## Specification Layout

The protocol spec lives separately from implementation notes:

- [specs/x278-specification-v0.md](specs/x278-specification-v0.md): core actors, states, messages, signing, replay behavior, and boundaries.
- [specs/transports/http.md](specs/transports/http.md): HTTP representation for an x278 exchange.
- [specs/adapters/fhir-pas.md](specs/adapters/fhir-pas.md): mapping expectations for FHIR PAS, DTR, CRD, and X12 278/275 adapters.
- [e2e/provider-agent-protocol.md](e2e/provider-agent-protocol.md) and [e2e/payer-agent-protocol.md](e2e/payer-agent-protocol.md): future cross-implementation contract expectations.

## What This Demonstrates

- A provider agent can submit one structured request.
- A payer agent can return `approved`, `denied`, `info-needed`, or `pended`.
- `info-needed` carries exact documentation requirements and resumes with the same `authId`.
- `pended` carries a subscription-like handle and later resolves to a clinical-review determination.
- Terminal determinations are signed with an Ed25519 detached receipt and appended to an audit log.

## Implementation Shape

- `src/domain.ts`: Effect schemas, protocol types, and parse errors.
- `src/payer-agent.ts`: mock payer rule set and stateful payer agent service.
- `src/provider-client.ts`: provider agent loop for retrying evidence and awaiting pended determinations.
- `src/signing.ts`: canonical JSON hashing, Ed25519 signing, and verification.
- `src/sdk.ts`: public TypeScript SDK facade, mock payer, Promise client, and Effect client.
- `src/conformance.ts`: conformance runner for implementers.
- `src/fixtures.ts`: medical-service fixtures that exercise each state.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for the next repo milestones.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: keep the protocol behavior explicit, preserve the Effect-native surface, and keep contributor verification separate from the public SDK surface.

## License

MIT. See [LICENSE](LICENSE).
