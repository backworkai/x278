# TypeScript Example

This example shows the intended SDK shape. It is written as a copyable snippet rather than a separate package.

```ts
import {
  createMockX278Client,
  kneeReplacementMissingDocs
} from "@backwork/x278";

const client = createMockX278Client({
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `synthetic chart evidence for ${requirement.id}`,
      source: "chart"
    }))
});

const trace = await client.requestWithTrace(kneeReplacementMissingDocs);

console.log({
  statuses: trace.steps.map((step) => step.status),
  finalStatus: trace.final.status,
  sameAuthId: trace.steps.every((step) => step.authId === trace.final.authId)
});
```
