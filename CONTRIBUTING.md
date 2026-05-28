# Contributing

Thanks for helping make x278 more concrete and testable.

## Local Setup

```bash
bun install
bun run typecheck
bun run test
bun run build
```

The public SDK README stays focused on installation and usage. Dogfood transcripts, proof checks, and live model tests live here because they are contributor verification workflows, not SDK API surface.

## Contributor Verification

Use the smallest check that proves the change:

```bash
bun run typecheck
bun run test
bun run build
```

Run the deeper proof ladder when changing protocol behavior, signing, FHIR mapping, or conformance logic:

```bash
bun run dogfood
bun run prove
```

`bun run dogfood` prints a local operator transcript for deterministic approval, `info-needed` evidence retry, `pended` human review, coded denial, signature verification, and audit-log checks.

`bun run prove` runs the dogfood transcript plus standards-oriented proof tests for PAS-style FHIR `Claim` bundles, `ClaimResponse` outcome mapping, and DTR-style `Questionnaire` generation.

Use `bun run test:all` only when `OPENAI_API_KEY` and `ANTHROPIC_API_KEY` are available. It runs typecheck, offline tests, and the live agent-backed tests.

## Test Inventory

- `test/x278.test.ts`: core protocol tests.
- `test/sdk.test.ts`: SDK facade tests.
- `test/battle.test.ts`: adversarial boundary tests for hostile inputs, replay, evidence validation, and signature tampering.
- `test/proof.test.ts`: standards-oriented proof tests for the whitepaper claims.
- `test/live-agents.test.ts`: OpenAI Agents SDK and Anthropic SDK contributor dogfood tests.

## Backwork Test Ladder

1. Keep expanding protocol tests until every state transition is explicit.
2. Add golden FHIR fixtures that map x278 requests to PAS `Claim` bundles and final decisions to `ClaimResponse`.
3. Add DTR fixtures where `documentationRequired[]` points to real `Questionnaire` resources.
4. Stand up a local HTTP transport only after the pure service tests are stable.
5. Run contract tests against a payer sandbox or HAPI FHIR instance.
6. Pilot on one deterministic use case, such as knee arthroplasty or imaging, and measure auth latency, human touches, denial correction rate, and appeal completeness.

The important Backwork boundary: the x278 envelope should stay agent-native and ergonomic, while adapters do the dull mapping work to PAS, DTR, CRD, X12, and payer-specific quirks.

## Development Principles

- Keep spec changes in `specs/` and implementation notes in `docs/`.
- Keep the Effect-native API first; Promise APIs should remain a thin SDK facade.
- Treat every protocol state transition as a tested contract.
- Add adversarial tests for any boundary that accepts untrusted input.
- Preserve `authId` continuity through retry and pended flows.
- Keep production payer integrations separate from this reference sandbox until there is a real adapter boundary.
- Update [docs/conformance-matrix.md](docs/conformance-matrix.md) when a whitepaper claim becomes more or less proven.

## AI-Assisted Contributions

AI-assisted work is welcome, but protocol code is not a place for vibes.

- Review generated output before opening a PR.
- Remove filler comments, redundant tests, and generic prose.
- Verify field names, state transitions, signatures, and FHIR mappings against `specs/` and existing tests.
- Do not invent payer behavior, CMS requirements, or HL7/X12 mappings from memory.
- Disclose significant AI assistance in the PR notes when it shaped most of the change.

## Live Agent Tests

Live tests are opt-in because they call external model APIs:

```bash
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... bun run test:live
```

Do not commit API keys, payer credentials, patient data, or real protected health information.
