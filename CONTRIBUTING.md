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

- Keep the Effect-native API first; Promise APIs should remain a thin SDK facade.
- Treat every protocol state transition as a tested contract.
- Add adversarial tests for any boundary that accepts untrusted input.
- Preserve `authId` continuity through retry and pended flows.
- Keep production payer integrations separate from this reference sandbox until there is a real adapter boundary.

## Live Agent Tests

Live tests are opt-in because they call external model APIs:

```bash
OPENAI_API_KEY=... ANTHROPIC_API_KEY=... bun run test:live
```

Do not commit API keys, payer credentials, patient data, or real protected health information.
