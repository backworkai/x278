import { Cause, Effect, Exit, Option } from "effect";
import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  DocumentationRequirement,
  SupportingInfo,
  TerminalDetermination
} from "./domain.js";
import {
  ProtocolError,
  decodeAuthorizationRequest,
  decodeDetermination,
  decodeSupportingInfoList,
  decodeTerminalDetermination
} from "./domain.js";
import {
  type PayerAgentService,
  makeReferencePayerAgent
} from "./payer-agent.js";

export interface X278EffectTransport {
  readonly authorize: (
    request: AuthorizationRequest
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly resume: (
    authId: string,
    resumeToken: string,
    evidence: ReadonlyArray<SupportingInfo>
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly awaitDetermination: (
    subscription: string
  ) => Effect.Effect<TerminalDetermination, ProtocolError>;
  readonly auditLog?: Effect.Effect<ReadonlyArray<AuditRecord>, ProtocolError>;
  readonly verify?: (
    request: AuthorizationRequest,
    determination: TerminalDetermination
  ) => Effect.Effect<boolean, ProtocolError>;
}

export interface X278Transport {
  readonly authorize: (request: AuthorizationRequest) => Promise<Determination>;
  readonly resume: (
    authId: string,
    resumeToken: string,
    evidence: ReadonlyArray<SupportingInfo>
  ) => Promise<Determination>;
  readonly awaitDetermination: (
    subscription: string
  ) => Promise<TerminalDetermination>;
  readonly auditLog?: () => Promise<ReadonlyArray<AuditRecord>>;
  readonly verify?: (
    request: AuthorizationRequest,
    determination: TerminalDetermination
  ) => Promise<boolean>;
}

export interface EvidenceCollectionContext {
  readonly authId: string;
  readonly attempt: number;
}

export interface X278ClientOptions {
  readonly maxSteps?: number;
  readonly collectEvidence?: (
    request: AuthorizationRequest,
    requirements: ReadonlyArray<DocumentationRequirement>,
    context: EvidenceCollectionContext
  ) =>
    | ReadonlyArray<SupportingInfo>
    | Promise<ReadonlyArray<SupportingInfo>>
    | Effect.Effect<ReadonlyArray<SupportingInfo>, ProtocolError>;
}

export interface X278RequestTrace {
  readonly originalRequest: AuthorizationRequest;
  readonly finalRequest: AuthorizationRequest;
  readonly steps: ReadonlyArray<Determination>;
  readonly final: TerminalDetermination;
}

export interface X278EffectClient {
  readonly authorize: (
    request: unknown
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly resume: (
    authId: string,
    resumeToken: string,
    evidence: ReadonlyArray<SupportingInfo>
  ) => Effect.Effect<Determination, ProtocolError>;
  readonly awaitDetermination: (
    subscription: string
  ) => Effect.Effect<TerminalDetermination, ProtocolError>;
  readonly request: (
    request: unknown
  ) => Effect.Effect<TerminalDetermination, ProtocolError>;
  readonly requestWithTrace: (
    request: unknown
  ) => Effect.Effect<X278RequestTrace, ProtocolError>;
  readonly auditLog?: Effect.Effect<ReadonlyArray<AuditRecord>, ProtocolError>;
  readonly verify?: (
    request: AuthorizationRequest,
    determination: TerminalDetermination
  ) => Effect.Effect<boolean, ProtocolError>;
}

export interface X278Client {
  readonly authorize: (request: unknown) => Promise<Determination>;
  readonly resume: (
    authId: string,
    resumeToken: string,
    evidence: ReadonlyArray<SupportingInfo>
  ) => Promise<Determination>;
  readonly awaitDetermination: (
    subscription: string
  ) => Promise<TerminalDetermination>;
  readonly request: (request: unknown) => Promise<TerminalDetermination>;
  readonly requestWithTrace: (request: unknown) => Promise<X278RequestTrace>;
  readonly auditLog?: () => Promise<ReadonlyArray<AuditRecord>>;
  readonly verify?: (
    request: AuthorizationRequest,
    determination: TerminalDetermination
  ) => Promise<boolean>;
}

const fromPromise = <A>(
  promise: () => Promise<A>,
  reason: string
): Effect.Effect<A, ProtocolError> =>
  Effect.tryPromise({
    try: promise,
    catch: (detail) => new ProtocolError({ reason, detail })
  });

const runProtocolPromise = async <A>(
  effect: Effect.Effect<A, ProtocolError>
): Promise<A> => {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = Cause.failureOption(exit.cause);
  if (Option.isSome(failure)) {
    throw failure.value;
  }

  throw Cause.squash(exit.cause);
};

const isEffect = <A, E>(value: unknown): value is Effect.Effect<A, E> =>
  Effect.isEffect(value);

const collectEvidenceEffect = (
  request: AuthorizationRequest,
  requirements: ReadonlyArray<DocumentationRequirement>,
  context: EvidenceCollectionContext,
  options: X278ClientOptions
): Effect.Effect<ReadonlyArray<SupportingInfo>, ProtocolError> => {
  if (!options.collectEvidence) {
    return Effect.fail(
      new ProtocolError({
        reason: "evidence-required",
        detail: requirements
      })
    );
  }

  const collectEvidence = options.collectEvidence;

  return Effect.suspend(() => {
    const result = collectEvidence(request, requirements, context);

    if (isEffect<ReadonlyArray<SupportingInfo>, ProtocolError>(result)) {
      return result.pipe(Effect.flatMap(decodeSupportingInfoList));
    }

    if (result instanceof Promise) {
      return fromPromise(() => result, "evidence-collection-failed").pipe(
        Effect.flatMap(decodeSupportingInfoList)
      );
    }

    return decodeSupportingInfoList(result ?? []);
  });
};

const appendEvidence = (
  request: AuthorizationRequest,
  evidence: ReadonlyArray<SupportingInfo>
): AuthorizationRequest => ({
  ...request,
  supportingInfo: [...request.supportingInfo, ...evidence]
});

const toEffectTransport = (transport: X278Transport): X278EffectTransport => {
  const auditLog = transport.auditLog;
  const verify = transport.verify;

  return {
    authorize: (request) =>
      fromPromise(() => transport.authorize(request), "transport-authorize-failed").pipe(
        Effect.flatMap(decodeDetermination)
      ),
    resume: (authId, resumeToken, evidence) =>
      fromPromise(
        () => transport.resume(authId, resumeToken, evidence),
        "transport-resume-failed"
      ).pipe(Effect.flatMap(decodeDetermination)),
    awaitDetermination: (subscription) =>
      fromPromise(
        () => transport.awaitDetermination(subscription),
        "transport-await-failed"
      ).pipe(Effect.flatMap(decodeTerminalDetermination)),
    ...(auditLog
      ? {
          auditLog: fromPromise(() => auditLog(), "transport-audit-failed")
        }
      : {}),
    ...(verify
      ? {
          verify: (request, determination) =>
            fromPromise(
              () => verify(request, determination),
              "transport-verify-failed"
            )
        }
      : {})
  };
};

export const fromPayerAgent = (
  payer: PayerAgentService
): X278EffectTransport => ({
  authorize: (request) => payer.authorize(request),
  resume: (authId, resumeToken, evidence) =>
    payer.resume(authId, resumeToken, evidence),
  awaitDetermination: (subscription) => payer.awaitDetermination(subscription),
  auditLog: payer.auditLog,
  verify: (request, determination) => payer.verify(request, determination)
});

export const createX278EffectClient = (
  transport: X278EffectTransport,
  options: X278ClientOptions = {}
): X278EffectClient => {
  const maxSteps = options.maxSteps ?? 8;

  const authorize = (request: unknown) =>
    decodeAuthorizationRequest(request).pipe(
      Effect.flatMap((decoded) => transport.authorize(decoded)),
      Effect.flatMap(decodeDetermination)
    );

  const resume = (
    authId: string,
    resumeToken: string,
    evidence: ReadonlyArray<SupportingInfo>
  ) =>
    decodeSupportingInfoList(evidence).pipe(
      Effect.flatMap((decodedEvidence) =>
        transport.resume(authId, resumeToken, decodedEvidence)
      ),
      Effect.flatMap(decodeDetermination)
    );

  const awaitDetermination = (subscription: string) =>
    transport
      .awaitDetermination(subscription)
      .pipe(Effect.flatMap(decodeTerminalDetermination));

  const requestWithTrace = (
    input: unknown
  ): Effect.Effect<X278RequestTrace, ProtocolError> =>
    Effect.gen(function* () {
      const originalRequest = yield* decodeAuthorizationRequest(input);
      let workingRequest = originalRequest;
      const steps: Array<Determination> = [];

      let current = yield* transport.authorize(workingRequest);
      steps.push(current);

      for (let attempt = 1; attempt <= maxSteps; attempt += 1) {
        if (current.status === "approved" || current.status === "denied") {
          return {
            originalRequest,
            finalRequest: workingRequest,
            steps,
            final: current
          };
        }

        if (current.status === "info-needed") {
          const evidence = yield* collectEvidenceEffect(
            workingRequest,
            current.documentationRequired,
            { authId: current.authId, attempt },
            options
          );
          workingRequest = appendEvidence(workingRequest, evidence);
          current = yield* transport.resume(
            current.authId,
            current.resumeToken,
            evidence
          );
          steps.push(current);
          continue;
        }

        if (current.status === "pended") {
          current = yield* transport.awaitDetermination(current.subscription);
          steps.push(current);
          continue;
        }

        return yield* Effect.fail(
          new ProtocolError({
            reason: current.reasonCode,
            detail: current.reasonText
          })
        );
      }

      return yield* Effect.fail(
        new ProtocolError({
          reason: "max-steps-exceeded",
          detail: { maxSteps, steps }
        })
      );
    });

  const auditLog = transport.auditLog;
  const verify = transport.verify;

  return {
    authorize,
    resume,
    awaitDetermination,
    request: (request) =>
      requestWithTrace(request).pipe(Effect.map((trace) => trace.final)),
    requestWithTrace,
    ...(auditLog ? { auditLog } : {}),
    ...(verify ? { verify } : {})
  };
};

export const createX278Client = (
  transport: X278Transport,
  options: X278ClientOptions = {}
): X278Client => {
  const effectClient = createX278EffectClient(toEffectTransport(transport), options);

  const auditLog = effectClient.auditLog;
  const verify = effectClient.verify;

  return {
    authorize: (request) => runProtocolPromise(effectClient.authorize(request)),
    resume: (authId, resumeToken, evidence) =>
      runProtocolPromise(effectClient.resume(authId, resumeToken, evidence)),
    awaitDetermination: (subscription) =>
      runProtocolPromise(effectClient.awaitDetermination(subscription)),
    request: (request) => runProtocolPromise(effectClient.request(request)),
    requestWithTrace: (request) =>
      runProtocolPromise(effectClient.requestWithTrace(request)),
    ...(auditLog
      ? { auditLog: () => runProtocolPromise(auditLog) }
      : {}),
    ...(verify
      ? {
          verify: (request, determination) =>
            runProtocolPromise(verify(request, determination))
        }
      : {})
  };
};

export const createMockPayer = (): X278Transport & {
  readonly publicKeyPem: string;
} => {
  const payer = Effect.runSync(makeReferencePayerAgent);

  return {
    authorize: (request) => runProtocolPromise(payer.authorize(request)),
    resume: (authId, resumeToken, evidence) =>
      runProtocolPromise(payer.resume(authId, resumeToken, evidence)),
    awaitDetermination: (subscription) =>
      runProtocolPromise(payer.awaitDetermination(subscription)),
    auditLog: () => runProtocolPromise(payer.auditLog),
    verify: (request, determination) =>
      runProtocolPromise(payer.verify(request, determination)),
    publicKeyPem: payer.publicKeyPem
  };
};

export const createMockX278Client = (
  options: X278ClientOptions = {}
): X278Client => createX278Client(createMockPayer(), options);
