import { Context, Effect, Layer } from "effect";
import type {
  AuthorizationRequest,
  Determination,
  DocumentationRequirement,
  SupportingInfo,
  TerminalDetermination
} from "./domain.js";
import { ProtocolError } from "./domain.js";
import { PayerAgent } from "./payer-agent.js";

export class EvidenceRepository extends Context.Tag("EvidenceRepository")<
  EvidenceRepository,
  {
    readonly collect: (
      request: AuthorizationRequest,
      requirements: ReadonlyArray<DocumentationRequirement>
    ) => Effect.Effect<ReadonlyArray<SupportingInfo>>;
  }
>() {}

export const EvidenceRepositoryLive = Layer.succeed(EvidenceRepository, {
  collect: (_request, requirements) =>
    Effect.succeed(
      requirements.map((requirement) => ({
        id: requirement.id,
        value: `reference fixture: ${requirement.description}`,
        source: "chart" as const
      }))
    )
});

export class ProviderClient extends Context.Tag("ProviderClient")<
  ProviderClient,
  {
    readonly request: (
      request: AuthorizationRequest
    ) => Effect.Effect<TerminalDetermination, ProtocolError>;
  }
>() {}

export const ProviderClientLive = Layer.effect(
  ProviderClient,
  Effect.gen(function* () {
    const payer = yield* PayerAgent;
    const evidence = yield* EvidenceRepository;

    const loop = (
      originalRequest: AuthorizationRequest,
      result: Determination
    ): Effect.Effect<TerminalDetermination, ProtocolError> =>
      Effect.gen(function* () {
        if (result.status === "approved" || result.status === "denied") {
          return result;
        }

        if (result.status === "info-needed") {
          const supportingInfo = yield* evidence.collect(
            originalRequest,
            result.documentationRequired
          );
          const resumed = yield* payer.resume(
            result.authId,
            result.resumeToken,
            supportingInfo
          );
          return yield* loop(
            {
              ...originalRequest,
              supportingInfo: [
                ...originalRequest.supportingInfo,
                ...supportingInfo
              ]
            },
            resumed
          );
        }

        if (result.status === "pended") {
          const final = yield* payer.awaitDetermination(result.subscription);
          return final;
        }

        return yield* Effect.fail(
          new ProtocolError({
            reason: result.reasonCode,
            detail: result.reasonText
          })
        );
      });

    return {
      request: (request) =>
        payer.authorize(request).pipe(
          Effect.flatMap((result) => loop(request, result))
        )
    };
  })
);
