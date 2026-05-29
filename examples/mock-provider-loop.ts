import {
  createMockX278Client,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "@backwork/x278";

const client = createMockX278Client({
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: `synthetic chart evidence for ${requirement.id}`,
      source: "chart" as const
    }))
});

const missingDocsTrace = await client.requestWithTrace(
  kneeReplacementMissingDocs
);
const humanReviewTrace = await client.requestWithTrace(spinalStimulatorReview);
const denied = await client.request(nonCoveredService);

console.log(
  JSON.stringify(
    {
      missingDocs: {
        statuses: missingDocsTrace.steps.map((step) => step.status),
        finalStatus: missingDocsTrace.final.status,
        sameAuthId: missingDocsTrace.steps.every(
          (step) => step.authId === missingDocsTrace.final.authId
        )
      },
      humanReview: {
        statuses: humanReviewTrace.steps.map((step) => step.status),
        finalStatus: humanReviewTrace.final.status,
        determinationBy: humanReviewTrace.final.determinationBy
      },
      denial: {
        status: denied.status,
        nextAction: denied.nextAction,
        reasonCode: denied.status === "denied" ? denied.reasonCode : null
      }
    },
    null,
    2
  )
);
