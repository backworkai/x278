# x278 Specifications

This directory contains protocol specifications. Keep these separate from implementation docs so SDKs, transports, and adapters can evolve without blurring the protocol contract.

Current documents:

- [x278 core specification v0](x278-specification-v0.md)
- [HTTP transport](transports/http.md)
- [FHIR PAS adapter](adapters/fhir-pas.md)

The core split mirrors x278's design:

- **Types**: request, evidence, determination, receipt, and audit shapes.
- **Logic**: state transitions for `approved`, `denied`, `info-needed`, `pended`, and `error`.
- **Representation**: HTTP, FHIR/PAS, DTR, CRD, X12, or future agent transports.

Specification changes should include conformance or proof updates.
