# Realistic Docker Environment

This harness runs the reference x278 flow across separate provider and payer processes on a Docker network. It is still a reference sandbox, not a production payer integration or certified FHIR server.

## Services

- `payer-api`: a Bun HTTP payer service exposing the x278 transport endpoints.
- `provider-scenario`: a one-shot provider-side runner that calls the payer over HTTP, attaches evidence, awaits pended review, verifies signatures, maps the exchange to PAS/DTR-shaped resources, and checks the audit log.

## Run

```bash
bun run docker:realistic
```

The scenario covers:

- knee arthroplasty returning `info-needed`, then resuming with chart evidence to `approved`
- spinal stimulator returning `pended`, then resolving through clinical-review approval
- a non-covered service returning `denied` with an appeal path
- Ed25519 signature verification over each terminal determination
- one audit record per terminal determination

To leave the payer API running for manual calls:

```bash
docker compose up --build payer-api
```

Then inspect:

```bash
curl http://localhost:8787/healthz
curl http://localhost:8787/.well-known/x278
```
