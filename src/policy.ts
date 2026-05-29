import { Effect } from "effect";
import type {
  AuthorizationRequest,
  DocumentationRequirement,
  InfoNeededDetermination,
  PendedDetermination,
  UnsignedApprovedDetermination,
  UnsignedTerminalDetermination
} from "./domain.js";
import { ProtocolError } from "./domain.js";

export type X278PolicyDecision =
  | UnsignedTerminalDetermination
  | InfoNeededDetermination
  | PendedDetermination;

export interface X278PolicyEvaluationContext {
  readonly authId: string;
  readonly ruleSetVersion: string;
  readonly now: Date;
  readonly authNumber: (authId: string) => string;
  readonly addDays: (date: string, days: number) => string;
  readonly daysFromNow: (days: number) => string;
  readonly questionnaireUrl: (id: string) => string;
  readonly createResumeToken: () => string;
  readonly createSubscription: (authId: string) => string;
}

export interface X278PolicyReviewContext extends X278PolicyEvaluationContext {
  readonly subscription: string;
}

export interface X278PolicyAdapter {
  readonly ruleSetVersion: string;
  readonly evaluate: (
    request: AuthorizationRequest,
    context: X278PolicyEvaluationContext
  ) =>
    | X278PolicyDecision
    | Promise<X278PolicyDecision>
    | Effect.Effect<X278PolicyDecision, ProtocolError>;
  readonly review?: (
    request: AuthorizationRequest,
    context: X278PolicyReviewContext
  ) =>
    | UnsignedTerminalDetermination
    | Promise<UnsignedTerminalDetermination>
    | Effect.Effect<UnsignedTerminalDetermination, ProtocolError>;
}

const defaultRuleSetVersion = "backwork/reference-medical-policy@2026.1";

const daysFrom = (base: Date, days: number): string =>
  new Date(base.getTime() + days * 24 * 60 * 60 * 1000).toISOString();

const addDays = (date: string, days: number): string => {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
};

const defaultAuthNumber = (authId: string): string =>
  `BW-${authId.slice(0, 8).toUpperCase()}`;

const defaultQuestionnaireUrl = (id: string): string =>
  `https://backwork.example/fhir/Questionnaire/${id}`;

const referenceRequirements: ReadonlyArray<DocumentationRequirement> = [
  {
    id: "conservative-tx-6wk",
    description: "Evidence of at least six weeks of conservative treatment",
    questionnaire: defaultQuestionnaireUrl("conservative-tx-6wk")
  },
  {
    id: "weight-bearing-xray",
    description: "Recent weight-bearing knee x-ray report",
    questionnaire: defaultQuestionnaireUrl("weight-bearing-xray")
  }
];

const missingRequirements = (
  request: AuthorizationRequest,
  requirements: ReadonlyArray<DocumentationRequirement>
): ReadonlyArray<DocumentationRequirement> => {
  const supplied = new Set(request.supportingInfo.map((item) => item.id));
  return requirements.filter((requirement) => !supplied.has(requirement.id));
};

const base = (authId: string, ruleSetVersion: string) => ({
  authId,
  ruleSetVersion,
  expiresAt: null
});

export const createPolicyEvaluationContext = (
  authId: string,
  ruleSetVersion: string,
  now: Date = new Date()
): X278PolicyEvaluationContext => ({
  authId,
  ruleSetVersion,
  now,
  authNumber: defaultAuthNumber,
  addDays,
  daysFromNow: (days) => daysFrom(now, days),
  questionnaireUrl: defaultQuestionnaireUrl,
  createResumeToken: () => `rt_${crypto.randomUUID()}`,
  createSubscription: (id) => `x278://subscription/${id}`
});

export const createReferencePolicyAdapter = (
  ruleSetVersion = defaultRuleSetVersion
): X278PolicyAdapter => ({
  ruleSetVersion,
  evaluate: (request, context) => {
    if (request.service.code === "99999") {
      return {
        ...base(context.authId, context.ruleSetVersion),
        status: "denied",
        nextAction: "appeal",
        determinationBy: "rules",
        reasonCode: "not-covered",
        reasonText:
          "The requested service is not covered by the reference policy.",
        appealPath: "https://backwork.example/appeals"
      };
    }

    if (request.service.code === "63650") {
      return {
        ...base(context.authId, context.ruleSetVersion),
        status: "pended",
        nextAction: "await-payer",
        pendingReason: "human-review",
        subscription: context.createSubscription(context.authId),
        expiresAt: context.daysFromNow(7),
        determinationBy: "clinical-reviewer"
      };
    }

    if (request.service.code === "27447") {
      const missing = missingRequirements(request, referenceRequirements);
      if (missing.length > 0) {
        return {
          ...base(context.authId, context.ruleSetVersion),
          status: "info-needed",
          nextAction: "attach-evidence",
          documentationRequired: missing,
          resumeToken: context.createResumeToken(),
          expiresAt: context.daysFromNow(7),
          determinationBy: null
        };
      }
    }

    return {
      ...base(context.authId, context.ruleSetVersion),
      status: "approved",
      nextAction: "none",
      authNumber: context.authNumber(context.authId),
      approvedUnits: request.service.units,
      validFrom: request.service.requestedStart,
      validThrough: context.addDays(request.service.requestedStart, 90),
      determinationBy: "rules"
    };
  },
  review: (request, context): UnsignedApprovedDetermination => ({
    ...base(context.authId, context.ruleSetVersion),
    status: "approved",
    nextAction: "none",
    authNumber: context.authNumber(context.authId),
    approvedUnits: request.service.units,
    validFrom: request.service.requestedStart,
    validThrough: context.addDays(request.service.requestedStart, 90),
    determinationBy: "clinical-reviewer"
  })
});

export const resolvePolicyDecision = <A>(
  result: A | Promise<A> | Effect.Effect<A, ProtocolError>,
  reason: "policy-evaluation-failed" | "policy-review-failed"
): Effect.Effect<A, ProtocolError> => {
  if (Effect.isEffect(result)) {
    return result;
  }

  if (result instanceof Promise) {
    return Effect.tryPromise({
      try: () => result,
      catch: (detail) =>
        detail instanceof ProtocolError
          ? detail
          : new ProtocolError({ kind: "payer", reason, detail })
    });
  }

  return Effect.succeed(result);
};
