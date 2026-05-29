import { Context, Effect, Layer, Ref } from "effect";
import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  SupportingInfo,
  TerminalDetermination,
  UnsignedTerminalDetermination
} from "./domain.js";
import {
  ProtocolError,
  decodeAuthorizationRequest,
  decodeSupportingInfoList
} from "./domain.js";
import {
  determinationHash,
  generatePayerKeyPair,
  requestHash,
  signDetermination,
  verifyDetermination
} from "./signing.js";
import {
  type X278PolicyAdapter,
  type X278PolicyDecision,
  createPolicyEvaluationContext,
  createReferencePolicyAdapter,
  resolvePolicyDecision
} from "./policy.js";

interface PendingAuth {
  readonly request: AuthorizationRequest;
  readonly resumeToken: string;
}

interface PendedAuth {
  readonly request: AuthorizationRequest;
  readonly authId: string;
}

interface PayerState {
  readonly pending: Map<string, PendingAuth>;
  readonly pended: Map<string, PendedAuth>;
  readonly audit: Array<AuditRecord>;
}

export interface PayerAgentService {
  readonly authorize: (
    request: unknown
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly resume: (
    authId: string,
    resumeToken: string,
    evidence: unknown
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly awaitDetermination: (
    subscription: string
  ) => Effect.Effect<TerminalDetermination, ProtocolError>;
  readonly auditLog: Effect.Effect<ReadonlyArray<AuditRecord>>;
  readonly publicKeyPem: string;
  readonly verify: (
    request: AuthorizationRequest,
    determination: TerminalDetermination
  ) => Effect.Effect<boolean>;
}

export class PayerAgent extends Context.Tag("PayerAgent")<
  PayerAgent,
  PayerAgentService
>() {}

export interface PayerAgentOptions {
  readonly policy?: X278PolicyAdapter;
  readonly keyId?: string;
}

const mergeEvidence = (
  request: AuthorizationRequest,
  evidence: ReadonlyArray<SupportingInfo>
): AuthorizationRequest => ({
  ...request,
  supportingInfo: [...request.supportingInfo, ...evidence]
});

const attachSignature = (
  determination: UnsignedTerminalDetermination,
  signature: TerminalDetermination["signature"]
): TerminalDetermination => {
  if (determination.status === "approved") {
    return { ...determination, signature };
  }

  return { ...determination, signature };
};

export const makePayerAgent = (
  options: PayerAgentOptions = {}
): Effect.Effect<PayerAgentService> =>
  Effect.gen(function* () {
    const policy = options.policy ?? createReferencePolicyAdapter();
    const stateRef = yield* Ref.make<PayerState>({
      pending: new Map(),
      pended: new Map(),
      audit: []
    });
    const keyPair = generatePayerKeyPair(
      options.keyId ?? "did:web:backwork.example#x278-dev"
    );

    const appendAudit = (
      request: AuthorizationRequest,
      determination: TerminalDetermination
    ) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        state.audit.push({
          authId: determination.authId,
          status: determination.status,
          requestHash: requestHash(request),
          determinationHash: determinationHash(determination),
          signatureKeyId: determination.signature.keyId,
          appendedAt: new Date().toISOString()
        });
      });

    const signAndRecord = (
      request: AuthorizationRequest,
      determination: UnsignedTerminalDetermination
    ): Effect.Effect<TerminalDetermination> =>
      signDetermination(request, determination, keyPair).pipe(
        Effect.map((signature) => attachSignature(determination, signature)),
        Effect.tap((signed) => appendAudit(request, signed))
      );

    const materialize = (
      request: AuthorizationRequest,
      determination: X278PolicyDecision
    ): Effect.Effect<Determination> => {
      if (
        determination.status === "approved" ||
        determination.status === "denied"
      ) {
        return signAndRecord(request, determination);
      }

      return Effect.succeed(determination);
    };

    const authorize = (raw: unknown) =>
      Effect.gen(function* () {
        const request = yield* decodeAuthorizationRequest(raw);
        const authId = crypto.randomUUID().replaceAll("-", "");
        const context = createPolicyEvaluationContext(
          authId,
          policy.ruleSetVersion
        );
        const result = yield* resolvePolicyDecision(
          policy.evaluate(request, context),
          "policy-evaluation-failed"
        );
        const state = yield* Ref.get(stateRef);

        if (result.status === "info-needed") {
          state.pending.set(authId, {
            request,
            resumeToken: result.resumeToken
          });
        }

        if (result.status === "pended") {
          state.pended.set(result.subscription, { authId, request });
        }

        return yield* materialize(request, result);
      });

    const resume = (
      authId: string,
      resumeToken: string,
      evidence: unknown
    ) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const pending = state.pending.get(authId);

        if (!pending || pending.resumeToken !== resumeToken) {
          return yield* Effect.fail(
            new ProtocolError({
              kind: "payer",
              reason: "invalid-resume-token"
            })
          );
        }

        const decodedEvidence = yield* decodeSupportingInfoList(evidence);
        const request = mergeEvidence(pending.request, decodedEvidence);
        const context = createPolicyEvaluationContext(
          authId,
          policy.ruleSetVersion
        );
        const result = yield* resolvePolicyDecision(
          policy.evaluate(request, context),
          "policy-evaluation-failed"
        );

        if (result.status !== "info-needed") {
          state.pending.delete(authId);
        } else {
          state.pending.set(authId, {
            request,
            resumeToken: result.resumeToken
          });
        }

        return yield* materialize(request, result);
      });

    const awaitDetermination = (subscription: string) =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const pended = state.pended.get(subscription);

        if (!pended) {
          return yield* Effect.fail(
            new ProtocolError({
              kind: "payer",
              reason: "unknown-subscription"
            })
          );
        }

        state.pended.delete(subscription);

        const context = {
          ...createPolicyEvaluationContext(
            pended.authId,
            policy.ruleSetVersion
          ),
          subscription
        };
        const determination = yield* resolvePolicyDecision(
          policy.review
            ? policy.review(pended.request, context)
            : createReferencePolicyAdapter(policy.ruleSetVersion).review!(
                pended.request,
                context
              ),
          "policy-review-failed"
        );

        return yield* signAndRecord(pended.request, determination);
      });

    return {
      authorize,
      resume,
      awaitDetermination,
      auditLog: Ref.get(stateRef).pipe(Effect.map((state) => [...state.audit])),
      publicKeyPem: keyPair.publicKeyPem,
      verify: (request, determination) =>
        Effect.sync(() =>
          verifyDetermination(request, determination, keyPair.publicKeyPem)
        )
    };
  });

export const makeReferencePayerAgent: Effect.Effect<PayerAgentService> =
  makePayerAgent();

export const PayerAgentLive = Layer.effect(PayerAgent, makeReferencePayerAgent);
