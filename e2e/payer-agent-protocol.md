# Payer Agent Test Contract

Payer-agent implementations should expose a local transport that a provider-agent harness can call.

## Required Operations

- `authorize(request)`
- `resume(authId, resumeToken, evidence)`
- `awaitDetermination(subscription)`
- `verify(request, terminalDetermination)`
- `auditLog()`

## Required Behavior

- Return exactly one x278 determination state per call.
- Return actionable `documentationRequired[]` for `info-needed`.
- Reject invalid or replayed resume tokens.
- Reject replayed subscriptions after pended resolution.
- Sign terminal determinations.
- Append terminal determinations to an audit log.

## Required Fixtures

At minimum, an e2e payer should support fixtures for:

- deterministic approval
- missing documentation
- human review pend
- non-covered denial

All fixtures must be synthetic.
