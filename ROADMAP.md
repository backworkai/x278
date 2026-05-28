# Roadmap

This repository starts as a reference implementation. The path to a credible x278 ecosystem is staged:

## Milestone 1: Reference SDK

- TypeScript SDK with Effect-native and Promise facades.
- Mock payer and provider loop for every determination state.
- Signed terminal determinations and audit records.
- Conformance runner and adversarial tests.

Status: implemented.

## Milestone 2: Specification Hardening

- Freeze a v0 protocol specification under `specs/`.
- Add JSON examples for every request and response state.
- Define HTTP transport headers/body placement.
- Define adapter boundaries for PAS, DTR, CRD, and X12.

Status: started.

## Milestone 3: Local Transport

- Add a local HTTP payer server and provider client.
- Add fixture-based contract tests across SDK and HTTP transport.
- Add golden request/response transcripts for conformance.

Status: planned.

## Milestone 4: FHIR Sandbox

- Run against a local HAPI FHIR or payer-style sandbox.
- Persist PAS `Claim` and `ClaimResponse` artifacts.
- Exercise DTR questionnaire generation and response attachment.

Status: started. Local HAPI FHIR persistence is covered by `bun run docker:fhir`; official profile validation remains.

## Milestone 5: Pilot Candidate

- Pick one deterministic use case.
- Measure latency, human touches, retry count, denial correction, and audit completeness.
- Document what remains human-reviewed by design.

Status: planned.
