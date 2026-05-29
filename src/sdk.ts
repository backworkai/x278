import { Cause, Effect, Exit, Option } from "effect";
import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  DocumentationRequirement,
  PendedDetermination,
  SupportingInfo,
  TerminalDetermination,
  X278Capabilities
} from "./domain.js";
import {
  ProtocolError,
  type ProtocolErrorKind,
  type ProtocolErrorReason,
  decodeAuthorizationRequest,
  decodeDetermination,
  decodeSupportingInfoList,
  decodeTerminalDetermination
} from "./domain.js";
import {
  type PayerAgentOptions,
  type PayerAgentService,
  makePayerAgent,
  makeReferencePayerAgent
} from "./payer-agent.js";

/**
 * Effect-native transport implemented by payer adapters.
 *
 * @example
 * const client = createX278EffectClient(fromPayerAgent(payer));
 */
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
  readonly capabilities?: Effect.Effect<X278Capabilities, ProtocolError>;
}

/**
 * Promise transport for applications that do not expose Effect at their edge.
 *
 * @example
 * const client = createX278Client({
 *   authorize: (request) => fetchDetermination(request),
 *   resume: (authId, token, evidence) => resumeDetermination(authId, token, evidence),
 *   awaitDetermination: (subscription) => waitForFinal(subscription)
 * });
 */
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
  readonly capabilities?: () => Promise<X278Capabilities>;
}

/**
 * Context passed to evidence collection hooks during an info-needed retry.
 */
export interface EvidenceCollectionContext {
  readonly authId: string;
  readonly attempt: number;
}

/**
 * Client behavior knobs. Defaults keep the loop bounded and require callers to
 * opt into automatic evidence collection.
 *
 * @example
 * const client = createMockX278Client({
 *   maxSteps: 4,
 *   collectEvidence: (_request, requirements) =>
 *     requirements.map((requirement) => ({
 *       id: requirement.id,
 *       value: "chart evidence",
 *       source: "chart"
 *     }))
 * });
 */
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
  readonly awaitPended?: (
    request: AuthorizationRequest,
    pended: PendedDetermination,
    context: EvidenceCollectionContext
  ) =>
    | TerminalDetermination
    | Promise<TerminalDetermination>
    | Effect.Effect<TerminalDetermination, ProtocolError>;
}

/**
 * Full transcript for a provider-side request loop.
 */
export interface X278RequestTrace {
  readonly originalRequest: AuthorizationRequest;
  readonly finalRequest: AuthorizationRequest;
  readonly steps: ReadonlyArray<Determination>;
  readonly final: TerminalDetermination;
}

/**
 * Effect-native x278 client that validates unknown inputs before transport use.
 */
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
  readonly capabilities?: Effect.Effect<X278Capabilities, ProtocolError>;
}

/**
 * Promise x278 client for provider applications.
 *
 * @example
 * const client = createMockX278Client({ collectEvidence });
 * const determination = await client.request(authorizationRequest);
 */
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
  readonly capabilities?: () => Promise<X278Capabilities>;
}

const fromPromise = <A>(
  promise: () => Promise<A>,
  reason: ProtocolErrorReason,
  kind: ProtocolErrorKind = "transport"
): Effect.Effect<A, ProtocolError> =>
  Effect.tryPromise({
    try: promise,
    catch: (detail) =>
      detail instanceof ProtocolError
        ? detail
        : new ProtocolError({ kind, reason, detail })
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
        kind: "workflow",
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
      return fromPromise(
        () => result,
        "evidence-collection-failed",
        "workflow"
      ).pipe(
        Effect.flatMap(decodeSupportingInfoList)
      );
    }

    return decodeSupportingInfoList(result ?? []);
  });
};

const awaitPendedEffect = (
  request: AuthorizationRequest,
  pended: PendedDetermination,
  context: EvidenceCollectionContext,
  options: X278ClientOptions
): Effect.Effect<TerminalDetermination, ProtocolError> => {
  if (!options.awaitPended) {
    return Effect.fail(
      new ProtocolError({
        kind: "workflow",
        reason: "unknown-subscription",
        detail: pended.subscription
      })
    );
  }

  const awaitPended = options.awaitPended;

  return Effect.suspend(() => {
    const result = awaitPended(request, pended, context);

    if (isEffect<TerminalDetermination, ProtocolError>(result)) {
      return result.pipe(Effect.flatMap(decodeTerminalDetermination));
    }

    if (result instanceof Promise) {
      return fromPromise(
        () => result,
        "transport-await-failed"
      ).pipe(Effect.flatMap(decodeTerminalDetermination));
    }

    return decodeTerminalDetermination(result);
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
  const capabilities = transport.capabilities;

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
      : {}),
    ...(capabilities
      ? {
          capabilities: fromPromise(
            () => capabilities(),
            "transport-capabilities-failed"
          )
        }
      : {})
  };
};

/**
 * Adapts an Effect payer service into an SDK transport.
 *
 * @example
 * const transport = fromPayerAgent(payer);
 * const client = createX278EffectClient(transport);
 */
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

/**
 * Creates an Effect-native provider client.
 *
 * @example
 * const client = createX278EffectClient(transport, { maxSteps: 4 });
 * const final = yield* client.request(request);
 */
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
          current = yield* (options.awaitPended
            ? awaitPendedEffect(
                workingRequest,
                current,
                { authId: current.authId, attempt },
                options
              )
            : transport.awaitDetermination(current.subscription));
          steps.push(current);
          continue;
        }

        return yield* Effect.fail(
          new ProtocolError({
            kind: "payer",
            reason: current.reasonCode,
            detail: current.reasonText
          })
        );
      }

      return yield* Effect.fail(
        new ProtocolError({
          kind: "workflow",
          reason: "max-steps-exceeded",
          detail: { maxSteps, steps }
        })
      );
    });

  const auditLog = transport.auditLog;
  const verify = transport.verify;
  const capabilities = transport.capabilities;

  return {
    authorize,
    resume,
    awaitDetermination,
    request: (request) =>
      requestWithTrace(request).pipe(Effect.map((trace) => trace.final)),
    requestWithTrace,
    ...(auditLog ? { auditLog } : {}),
    ...(verify ? { verify } : {}),
    ...(capabilities ? { capabilities } : {})
  };
};

/**
 * Creates a Promise-based provider client.
 *
 * @example
 * const client = createX278Client(transport, { collectEvidence });
 * const final = await client.request(request);
 */
export const createX278Client = (
  transport: X278Transport,
  options: X278ClientOptions = {}
): X278Client => {
  const effectClient = createX278EffectClient(toEffectTransport(transport), options);

  const auditLog = effectClient.auditLog;
  const verify = effectClient.verify;
  const capabilities = effectClient.capabilities;

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
      : {}),
    ...(capabilities
      ? { capabilities: () => runProtocolPromise(capabilities) }
      : {})
  };
};

/**
 * Creates the deterministic in-memory payer used by examples and consumer tests.
 *
 * @example
 * const payer = createMockPayer();
 * const client = createX278Client(payer);
 */
export const createMockPayer = (
  options: PayerAgentOptions = {}
): X278Transport & {
  readonly publicKeyPem: string;
} => {
  const payer = Effect.runSync(
    options.policy || options.keyId ? makePayerAgent(options) : makeReferencePayerAgent
  );

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

/**
 * Creates a deterministic in-memory payer with custom policy options.
 *
 * @example
 * const payer = createConfiguredMockPayer({ policy });
 */
export const createConfiguredMockPayer = (
  options: PayerAgentOptions = {}
): X278Transport & {
  readonly publicKeyPem: string;
} => createMockPayer(options);

/**
 * Creates a Promise client wired to the deterministic in-memory payer.
 *
 * @example
 * const client = createMockX278Client({ collectEvidence });
 * const final = await client.request(kneeReplacementMissingDocs);
 */
export const createMockX278Client = (
  options: X278ClientOptions = {}
): X278Client => createX278Client(createMockPayer(), options);
