# Provider Agent Test Contract

Provider-agent implementations should expose a CLI or process entrypoint that can be driven by an e2e harness.

## Required Inputs

- payer endpoint or in-process transport configuration
- synthetic authorization fixture
- optional evidence repository fixture
- output path or stdout mode for transcript JSON

## Required Behavior

- Submit a structured authorization request.
- On `info-needed`, attach evidence and resume with the same `authId`.
- On `pended`, await the returned subscription.
- On `approved`, emit authorization details.
- On `denied`, emit reason code and appeal path.
- Preserve a transcript of every determination state.

## Required Output

The final stdout line should be JSON:

```json
{
  "success": true,
  "statuses": ["info-needed", "approved"],
  "sameAuthId": true,
  "finalStatus": "approved",
  "signedFinal": true
}
```

Failures should exit non-zero and still emit a structured JSON error on the final line.
