import {
  createX278HttpClient,
  kneeReplacementMissingDocs
} from "@backwork/x278";

const payerUrl = process.env.X278_PAYER_URL ?? "http://localhost:8787";
const bearerToken = process.env.X278_BEARER_TOKEN;

const client = createX278HttpClient({
  baseUrl: payerUrl,
  ...(bearerToken ? { bearerToken } : {}),
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `synthetic chart evidence for ${requirement.id}`,
      source: "chart" as const
    })),
  hooks: {
    onRetry: (event) => {
      console.warn(
        `retrying ${event.operation} after ${event.retryAfterMs}ms`
      );
    }
  }
});

const capabilities = await client.capabilities();
const trace = await client.requestWithTrace(kneeReplacementMissingDocs);

console.log(
  JSON.stringify(
    {
      payerUrl,
      implementation: capabilities.implementation,
      statuses: trace.steps.map((step) => step.status),
      finalStatus: trace.final.status,
      authId: trace.final.authId,
      signatureVerified:
        trace.final.status === "approved"
          ? await client.verify?.(trace.finalRequest, trace.final)
          : undefined
    },
    null,
    2
  )
);
