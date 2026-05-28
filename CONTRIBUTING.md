# Contributing

Thanks for helping make x278 more concrete and testable.

## Local Setup

```bash
bun install
bun run typecheck
bun run test
bun run build
```

Run `bun run prove` when changing protocol behavior, signing, FHIR mapping, or conformance logic.

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
