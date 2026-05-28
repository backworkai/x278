import { Effect, Layer } from "effect";
import {
  EvidenceRepositoryLive,
  PayerAgentLive,
  ProviderClient,
  ProviderClientLive,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "./index.js";

const MainLive = ProviderClientLive.pipe(
  Layer.provide([PayerAgentLive, EvidenceRepositoryLive])
);

const program = Effect.gen(function* () {
  const provider = yield* ProviderClient;

  const approved = yield* provider.request(kneeReplacementMissingDocs);
  const denied = yield* provider.request(nonCoveredService);
  const reviewed = yield* provider.request(spinalStimulatorReview);

  console.log(
    JSON.stringify(
      {
        approved,
        denied,
        reviewed
      },
      null,
      2
    )
  );
}).pipe(Effect.provide(MainLive));

Effect.runPromise(program);
