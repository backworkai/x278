# x278 E2E Contracts

This directory records the expected behavior for future cross-implementation tests. The current repository already runs SDK, proof, battle, and live agent tests; these documents define the next layer once independent provider and payer implementations exist.

- [Realistic Docker environment](realistic/README.md): provider/payer scenarios over HTTP, including an optional HAPI FHIR persistence path.

Future e2e runners should launch a provider agent, payer agent, and optional audit service, then verify the same transcript across implementations:

1. deterministic approval
2. `info-needed` retry on the same `authId`
3. `pended` subscription resolution
4. coded denial and appeal path
5. signature verification and audit log lookup

Synthetic data only. Do not use real patient records or payer credentials.
