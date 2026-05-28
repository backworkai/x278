import { Context, Effect, Layer, Ref } from "effect";
import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  DocumentationRequirement,
  InfoNeededDetermination,
  PendedDetermination,
  SupportingInfo,
  TerminalDetermination,
  UnsignedApprovedDetermination,
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

const ruleSetVersion = "backwork/reference-medical-policy@2026.1";

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

const daysFromNow = (days: number): string =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const authNumber = (authId: string): string =>
  `BW-${authId.slice(0, 8).toUpperCase()}`;

const questionnaireUrl = (id: string): string =>
  `https://backwork.example/fhir/Questionnaire/${id}`;

const kneeRequirements: ReadonlyArray<DocumentationRequirement> = [
  {
    id: "conservative-tx-6wk",
    description: "Evidence of at least six weeks of conservative treatment",
    questionnaire: questionnaireUrl("conservative-tx-6wk")
  },
  {
    id: "weight-bearing-xray",
    description: "Recent weight-bearing knee x-ray report",
    questionnaire: questionnaireUrl("weight-bearing-xray")
  }
];

const missingRequirements = (
  request: AuthorizationRequest,
  requirements: ReadonlyArray<DocumentationRequirement>
): ReadonlyArray<DocumentationRequirement> => {
  const supplied = new Set(request.supportingInfo.map((item) => item.id));
  return requirements.filter((requirement) => !supplied.has(requirement.id));
};

const base = (authId: string) => ({
  authId,
  ruleSetVersion,
  expiresAt: null
});

const evaluateRules = (
  authId: string,
  request: AuthorizationRequest
):
  | UnsignedTerminalDetermination
  | InfoNeededDetermination
  | PendedDetermination => {
  if (request.service.code === "99999") {
    return {
      ...base(authId),
      status: "denied",
      nextAction: "appeal",
      determinationBy: "rules",
      reasonCode: "not-covered",
      reasonText: "The requested service is not covered by the reference policy.",
      appealPath: "https://backwork.example/appeals"
    };
  }

  if (request.service.code === "63650") {
    return {
      ...base(authId),
      status: "pended",
      nextAction: "await-payer",
      pendingReason: "human-review",
      subscription: `x278://subscription/${authId}`,
      expiresAt: daysFromNow(7),
      determinationBy: "clinical-reviewer"
    };
  }

  if (request.service.code === "27447") {
    const missing = missingRequirements(request, kneeRequirements);
    if (missing.length > 0) {
      return {
        ...base(authId),
        status: "info-needed",
        nextAction: "attach-evidence",
        documentationRequired: missing,
        resumeToken: `rt_${crypto.randomUUID()}`,
        expiresAt: daysFromNow(7),
        determinationBy: null
      };
    }
  }

  return {
    ...base(authId),
    status: "approved",
    nextAction: "none",
    authNumber: authNumber(authId),
    approvedUnits: request.service.units,
    validFrom: request.service.requestedStart,
    validThrough: addDays(request.service.requestedStart, 90),
    determinationBy: "rules"
  };
};

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

export const makeReferencePayerAgent: Effect.Effect<PayerAgentService> =
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<PayerState>({
      pending: new Map(),
      pended: new Map(),
      audit: []
    });
    const keyPair = generatePayerKeyPair("did:web:backwork.example#x278-dev");

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
      determination:
        | UnsignedTerminalDetermination
        | InfoNeededDetermination
        | PendedDetermination
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
        const result = evaluateRules(authId, request);
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
            new ProtocolError({ reason: "invalid-resume-token" })
          );
        }

        const decodedEvidence = yield* decodeSupportingInfoList(evidence);
        const request = mergeEvidence(pending.request, decodedEvidence);
        const result = evaluateRules(authId, request);

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
            new ProtocolError({ reason: "unknown-subscription" })
          );
        }

        state.pended.delete(subscription);

        const determination: UnsignedApprovedDetermination = {
          ...base(pended.authId),
          status: "approved",
          nextAction: "none",
          authNumber: authNumber(pended.authId),
          approvedUnits: pended.request.service.units,
          validFrom: pended.request.service.requestedStart,
          validThrough: addDays(pended.request.service.requestedStart, 90),
          determinationBy: "clinical-reviewer"
        };

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

export const PayerAgentLive = Layer.effect(PayerAgent, makeReferencePayerAgent);
