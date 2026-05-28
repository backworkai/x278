# Security

This repository is a reference implementation and sandbox. It is not certified for production healthcare use and must not be used with real patient data without a separate security, privacy, compliance, and clinical review.

## Reporting

Please report security issues privately to the Backwork maintainers. If you do not have a private contact, open a minimal GitHub issue that says a security report is available without including exploit details or sensitive data.

## Data Handling

- Do not commit real PHI, payer credentials, API keys, private keys, or production authorization data.
- Fixtures must stay synthetic.
- Live agent tests must use synthetic transcripts only.
- The included signing keys are generated at runtime for local testing.

## Scope

Interesting security areas include malformed protocol payloads, signature verification, replay behavior, audit log integrity, SDK boundary validation, and FHIR/PAS mapping correctness.
