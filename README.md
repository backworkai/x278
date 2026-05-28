# x278

[![CI](https://github.com/backworkai/x278/actions/workflows/ci.yml/badge.svg)](https://github.com/backworkai/x278/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-2D2824.svg)](LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-C65D3D.svg)](https://bun.sh)
[![Effect TS](https://img.shields.io/badge/Effect-3.x-2F8F83.svg)](https://effect.website)

An agent-native reference implementation for x278: Backwork's proposed prior authorization protocol for software agents.

x278 turns the prior authorization exchange into a typed, testable loop:

1. provider agent submits a structured request
2. payer agent returns `approved`, `denied`, `info-needed`, or `pended`
3. provider agent attaches evidence or awaits review without restarting the queue
4. terminal determinations are signed, verified, and audit logged

This repository is not a production payer integration. It is a runnable protocol sandbox and SDK foundation for proving behavior before wiring to real Da Vinci PAS, DTR, CRD, X12 278/275, payer sandbox endpoints, or FHIR servers.

## Status

Reference implementation. The protocol shape, SDK, conformance harness, FHIR/PAS mapping helpers, signatures, audit records, and live agent tests are implemented. Real payer integrations and executable payer policy publication are intentionally out of scope for this repo's first milestone.

## Run It

```bash
bun install
bun run test
bun run typecheck
bun run dogfood
bun run prove
bun run build
```

Use `bun run test:all` when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are available; it runs typecheck, offline tests, and the live agent-backed tests.

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

## Protocol States

| State | Meaning | Next action |
| --- | --- | --- |
| `approved` | Deterministic or reviewed approval | Use authorization number |
| `denied` | Coded denial with appeal path | Correct/resubmit or appeal |
| `info-needed` | Missing documentation with DTR-style requirements | Attach evidence and resume same `authId` |
| `pended` | Accepted but awaiting payer-side processing/review | Await returned subscription |
| `error` | Malformed or unprocessable exchange | Contact payer or fix request |

## Live Agent Tests

The default test suite is offline. To call real models, provide API keys and run:

```bash
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... bun run test:live
```

Optional model overrides:

```bash
OPENAI_AGENT_MODEL=gpt-5.4-mini ANTHROPIC_MODEL=claude-sonnet-4-5-20250929 bun run test:live
```

The OpenAI live test uses `@openai/agents` with a real agent and a local x278 tool. The Anthropic live test uses `@anthropic-ai/sdk` as an independent reviewer over a generated x278 transcript.

## Dogfood The Actual Flow

`bun run dogfood` prints a full operator transcript for the core x278 behavior:

- deterministic approval
- `info-needed` with documentation requirements, evidence attachment, and same-`authId` resume
- `pended` human review with subscription-style await
- coded denial with appeal path
- signature verification and audit-log checks for every terminal determination

## Prove The Paper Claims

`bun run prove` runs the operator dogfood transcript and the standards-oriented proof tests. The proof tests check that x278 requests can be rendered as PAS-style FHIR `Claim` bundles, that determinations map to FHIR `ClaimResponse` outcomes, and that `info-needed` requirements are representable as DTR-style `Questionnaire` resources.

See [docs/conformance-matrix.md](docs/conformance-matrix.md) for the core proof matrix and [docs/whitepaper-claim-ledger.md](docs/whitepaper-claim-ledger.md) for a broader claim-by-claim ledger of what is proven, partially proven, or still unproven.

## What This Proves

- A provider agent can submit one structured request.
- A payer agent can return `approved`, `denied`, `info-needed`, or `pended`.
- `info-needed` carries exact documentation requirements and resumes with the same `authId`.
- `pended` carries a subscription-like handle and later resolves to a clinical-review determination.
- Terminal determinations are signed with an Ed25519 detached receipt and appended to an audit log.
- Tests verify the agent loop, same-auth retry, coded denial, pended review, signatures, and audit records.

## Implementation Shape

- `src/domain.ts`: Effect schemas, protocol types, and parse errors.
- `src/payer-agent.ts`: mock payer rule set and stateful payer agent service.
- `src/provider-client.ts`: provider agent loop for retrying evidence and awaiting pended determinations.
- `src/signing.ts`: canonical JSON hashing, Ed25519 signing, and verification.
- `src/sdk.ts`: public TypeScript SDK facade, mock payer, Promise client, and Effect client.
- `src/conformance.ts`: conformance runner for implementers.
- `src/fixtures.ts`: medical-service fixtures that exercise each state.
- `test/x278.test.ts`: core protocol tests.
- `test/sdk.test.ts`: SDK facade tests.
- `test/battle.test.ts`: adversarial boundary tests for hostile inputs, replay, evidence validation, and signature tampering.
- `test/live-agents.test.ts`: OpenAI Agents SDK and Anthropic SDK dogfood tests.

## Backwork Test Ladder

1. Keep expanding these protocol tests until every state transition is explicit.
2. Add golden FHIR fixtures that map x278 requests to PAS `Claim` bundles and final decisions to `ClaimResponse`.
3. Add DTR fixtures where `documentationRequired[]` points to real `Questionnaire` resources.
4. Stand up a local HTTP transport only after the pure service tests are stable.
5. Run contract tests against a payer sandbox or HAPI FHIR instance.
6. Pilot on one deterministic use case, such as knee arthroplasty or imaging, and measure auth latency, human touches, denial correction rate, and appeal completeness.

The important Backwork boundary: the x278 envelope should stay agent-native and ergonomic, while adapters do the dull mapping work to PAS, DTR, CRD, X12, and payer-specific quirks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). The short version: keep the protocol behavior test-first, preserve the Effect-native surface, and run `bun run test` plus `bun run typecheck` before opening a PR.

## License

MIT. See [LICENSE](LICENSE).
