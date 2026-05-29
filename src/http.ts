import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  SupportingInfo,
  TerminalDetermination,
  X278Capabilities
} from "./domain.js";
import { ProtocolError } from "./domain.js";
import {
  type X278Client,
  type X278ClientOptions,
  type X278Transport,
  createX278Client
} from "./sdk.js";

export type X278Fetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export type X278HttpOperation =
  | "capabilities"
  | "authorize"
  | "resume"
  | "awaitDetermination"
  | "auditLog"
  | "verify";

export interface X278HttpRequestEvent {
  readonly requestId: string;
  readonly operation: X278HttpOperation;
  readonly method: "GET" | "POST";
  readonly url: string;
  readonly attempt: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

export interface X278HttpResponseEvent extends X278HttpRequestEvent {
  readonly status: number;
  readonly durationMs: number;
  readonly responseHeaders: Readonly<Record<string, string>>;
  readonly responseBody: unknown;
}

export interface X278HttpRetryEvent extends X278HttpRequestEvent {
  readonly status?: number;
  readonly retryAfterMs: number;
  readonly error?: unknown;
}

export interface X278HttpHooks {
  readonly onRequest?: (event: X278HttpRequestEvent) => void | Promise<void>;
  readonly onResponse?: (event: X278HttpResponseEvent) => void | Promise<void>;
  readonly onRetry?: (event: X278HttpRetryEvent) => void | Promise<void>;
  readonly onError?: (event: X278HttpRetryEvent) => void | Promise<void>;
}

export interface X278Logger {
  readonly debug?: (message: string, context?: unknown) => void;
  readonly warn?: (message: string, context?: unknown) => void;
  readonly error?: (message: string, context?: unknown) => void;
}

export interface X278RetryOptions {
  readonly maxRetries?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly retryStatuses?: ReadonlyArray<number>;
  readonly jitter?: boolean;
}

export interface X278HttpTransportOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: X278Fetch;
  readonly headers?:
    | HeadersInit
    | ((event: X278HttpRequestEvent) => HeadersInit | Promise<HeadersInit>);
  readonly bearerToken?: string | (() => string | Promise<string>);
  readonly timeoutMs?: number;
  readonly retry?: X278RetryOptions;
  readonly debug?: boolean;
  readonly logger?: X278Logger;
  readonly hooks?: X278HttpHooks;
}

export type X278HttpClientOptions = X278HttpTransportOptions &
  X278ClientOptions;

export interface X278HttpTransport extends X278Transport {
  readonly capabilities: () => Promise<X278Capabilities>;
}

export type X278HttpClient = X278Client & {
  readonly capabilities: () => Promise<X278Capabilities>;
};

export interface X278Env extends Readonly<Record<string, string | undefined>> {
  readonly X278_PAYER_URL?: string;
  readonly X278_BEARER_TOKEN?: string;
}

const defaultRetryStatuses = [408, 425, 429, 500, 502, 503, 504];
const defaultTimeoutMs = 30_000;
const defaultMaxRetries = 2;
const defaultBaseDelayMs = 250;
const defaultMaxDelayMs = 2_000;

const normalizeBaseUrl = (baseUrl: string | URL): URL => {
  const normalized = new URL(baseUrl.toString());
  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname = `${normalized.pathname}/`;
  }
  return normalized;
};

const sleep = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));

const headerRecord = (headers: Headers): Readonly<Record<string, string>> =>
  Object.fromEntries([...headers.entries()].sort(([a], [b]) => a.localeCompare(b)));

const redactHeaders = (
  headers: Headers
): Readonly<Record<string, string>> => {
  const redacted = new Headers(headers);
  for (const key of ["authorization", "cookie", "set-cookie", "x-api-key"]) {
    if (redacted.has(key)) {
      redacted.set(key, "[redacted]");
    }
  }

  return headerRecord(redacted);
};

const resolveBearerToken = async (
  bearerToken: X278HttpTransportOptions["bearerToken"]
): Promise<string | undefined> => {
  if (!bearerToken) {
    return undefined;
  }

  return typeof bearerToken === "function" ? bearerToken() : bearerToken;
};

const resolveHeaders = async (
  options: X278HttpTransportOptions,
  event: X278HttpRequestEvent,
  hasBody: boolean
): Promise<Headers> => {
  const resolved =
    typeof options.headers === "function"
      ? await options.headers(event)
      : (options.headers ?? {});
  const output = new Headers(resolved);
  const token = await resolveBearerToken(options.bearerToken);

  if (token && !output.has("authorization")) {
    output.set("authorization", `Bearer ${token}`);
  }
  if (hasBody && !output.has("content-type")) {
    output.set("content-type", "application/json");
  }
  if (!output.has("accept")) {
    output.set("accept", "application/json");
  }
  if (!output.has("x-request-id")) {
    output.set("x-request-id", event.requestId);
  }
  if (!output.has("x-x278-client")) {
    output.set("x-x278-client", "@backwork/x278");
  }

  return output;
};

const readJson = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const responseRequestId = (
  response: Response,
  fallback: string
): string => response.headers.get("x-request-id") ?? fallback;

const retryDelay = (
  response: Response | undefined,
  attempt: number,
  retry: Required<X278RetryOptions>
): number => {
  const retryAfter = response?.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const dateMs = Date.parse(retryAfter);
    if (Number.isFinite(dateMs)) {
      return Math.max(0, dateMs - Date.now());
    }
  }

  const exponential = Math.min(
    retry.maxDelayMs,
    retry.baseDelayMs * 2 ** Math.max(0, attempt - 1)
  );
  return retry.jitter ? Math.round(exponential * (0.5 + Math.random() / 2)) : exponential;
};

const isAbortError = (error: unknown): boolean =>
  error instanceof DOMException
    ? error.name === "AbortError" || error.name === "TimeoutError"
    : error instanceof Error && error.name === "AbortError";

const toProtocolError = (
  reason:
    | "http-error"
    | "http-timeout"
    | "http-request-failed"
    | "missing-base-url",
  event: X278HttpRequestEvent,
  detail: unknown,
  requestId = event.requestId
): ProtocolError =>
  new ProtocolError({
    kind: reason === "missing-base-url" ? "validation" : "transport",
    reason,
    requestId,
    detail
  });

const toRetryOptions = (
  retry: X278RetryOptions | undefined
): Required<X278RetryOptions> => ({
  maxRetries: retry?.maxRetries ?? defaultMaxRetries,
  baseDelayMs: retry?.baseDelayMs ?? defaultBaseDelayMs,
  maxDelayMs: retry?.maxDelayMs ?? defaultMaxDelayMs,
  retryStatuses: retry?.retryStatuses ?? defaultRetryStatuses,
  jitter: retry?.jitter ?? true
});

const log = (
  options: X278HttpTransportOptions,
  level: keyof X278Logger,
  message: string,
  context: unknown
) => {
  if (!options.debug && !options.logger?.[level]) {
    return;
  }

  const logger = options.logger ?? console;
  logger[level]?.(message, context);
};

const withTimeout = <A>(
  timeoutMs: number,
  run: (signal: AbortSignal) => Promise<A>
): Promise<A> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  return run(controller.signal).finally(() => clearTimeout(timeout));
};

const makeInitialEvent = (
  operation: X278HttpOperation,
  method: "GET" | "POST",
  url: string,
  body: unknown | undefined
): X278HttpRequestEvent => ({
  requestId: crypto.randomUUID(),
  operation,
  method,
  url,
  attempt: 0,
  headers: {},
  ...(body === undefined ? {} : { body })
});

export const defineX278HttpConfig = <Config extends X278HttpClientOptions>(
  config: Config
): Config => config;

/**
 * Creates a fetch-backed x278 transport for production payer endpoints.
 *
 * @example
 * const transport = createX278HttpTransport({
 *   baseUrl: "https://payer.example",
 *   bearerToken: process.env.X278_BEARER_TOKEN,
 *   debug: true
 * });
 */
export const createX278HttpTransport = (
  options: X278HttpTransportOptions
): X278HttpTransport => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher: X278Fetch =
    options.fetch ?? ((input, init) => fetch(input, init));
  const retry = toRetryOptions(options.retry);

  const requestJson = async <A>(
    operation: X278HttpOperation,
    path: string,
    init: {
      readonly method: "GET" | "POST";
      readonly body?: unknown;
    }
  ): Promise<A> => {
    const url = new URL(path, baseUrl);
    const firstEvent = makeInitialEvent(
      operation,
      init.method,
      url.toString(),
      init.body
    );
    let lastError: unknown;

    for (let attempt = 0; attempt <= retry.maxRetries; attempt += 1) {
      const event = { ...firstEvent, attempt };
      const hasBody = init.body !== undefined;
      const headers = await resolveHeaders(options, event, hasBody);
      const requestEvent = { ...event, headers: redactHeaders(headers) };
      const startedAt = performance.now();

      await options.hooks?.onRequest?.(requestEvent);
      log(options, "debug", "x278 http request", requestEvent);

      try {
        const requestInit: RequestInit = {
          method: init.method,
          headers
        };

        if (hasBody) {
          requestInit.body = JSON.stringify(init.body);
        }

        const response = await withTimeout(options.timeoutMs ?? defaultTimeoutMs, (signal) =>
          fetcher(url, { ...requestInit, signal })
        );
        const body = await readJson(response);
        const durationMs = Math.round(performance.now() - startedAt);
        const responseEvent: X278HttpResponseEvent = {
          ...requestEvent,
          requestId: responseRequestId(response, event.requestId),
          status: response.status,
          durationMs,
          responseHeaders: redactHeaders(response.headers),
          responseBody: body
        };

        await options.hooks?.onResponse?.(responseEvent);
        log(options, "debug", "x278 http response", responseEvent);

        if (response.ok) {
          return body as A;
        }

        lastError = toProtocolError(
          "http-error",
          requestEvent,
          {
            status: response.status,
            statusText: response.statusText,
            body,
            operation,
            url: url.toString()
          },
          responseEvent.requestId
        );

        if (
          attempt < retry.maxRetries &&
          retry.retryStatuses.includes(response.status)
        ) {
          const retryAfterMs = retryDelay(response, attempt + 1, retry);
          const retryEvent = {
            ...requestEvent,
            status: response.status,
            retryAfterMs,
            error: lastError
          };
          await options.hooks?.onRetry?.(retryEvent);
          log(options, "warn", "x278 http retry", retryEvent);
          await sleep(retryAfterMs);
          continue;
        }

        throw lastError;
      } catch (error) {
        const protocolError =
          error instanceof ProtocolError
            ? error
            : toProtocolError(
                isAbortError(error) ? "http-timeout" : "http-request-failed",
                requestEvent,
                {
                  error,
                  operation,
                  url: url.toString()
                }
              );

        lastError = protocolError;

        if (attempt < retry.maxRetries && !(error instanceof ProtocolError)) {
          const retryAfterMs = retryDelay(undefined, attempt + 1, retry);
          const retryEvent = {
            ...requestEvent,
            retryAfterMs,
            error: protocolError
          };
          await options.hooks?.onRetry?.(retryEvent);
          log(options, "warn", "x278 http retry", retryEvent);
          await sleep(retryAfterMs);
          continue;
        }

        const errorEvent = {
          ...requestEvent,
          retryAfterMs: 0,
          error: protocolError
        };
        await options.hooks?.onError?.(errorEvent);
        log(options, "error", "x278 http error", errorEvent);
        throw protocolError;
      }
    }

    throw lastError;
  };

  return {
    capabilities: () =>
      requestJson<X278Capabilities>("capabilities", ".well-known/x278", {
        method: "GET"
      }),
    authorize: (request: AuthorizationRequest) =>
      requestJson<Determination>("authorize", "authorize", {
        method: "POST",
        body: request
      }),
    resume: (
      authId: string,
      resumeToken: string,
      evidence: ReadonlyArray<SupportingInfo>
    ) =>
      requestJson<Determination>(
        "resume",
        `authorizations/${encodeURIComponent(authId)}/resume`,
        {
          method: "POST",
          body: { resumeToken, evidence }
        }
      ),
    awaitDetermination: (subscription: string) =>
      requestJson<TerminalDetermination>(
        "awaitDetermination",
        "determinations/await",
        {
          method: "POST",
          body: { subscription }
        }
      ),
    auditLog: () =>
      requestJson<ReadonlyArray<AuditRecord>>("auditLog", "audit-log", {
        method: "GET"
      }),
    verify: (
      request: AuthorizationRequest,
      determination: TerminalDetermination
    ) =>
      requestJson<{ readonly valid: boolean }>("verify", "verify", {
        method: "POST",
        body: { request, determination }
      }).then((result) => result.valid)
  };
};

/**
 * Creates the batteries-included Promise client for an x278 HTTP endpoint.
 *
 * @example
 * const client = createX278HttpClient({
 *   baseUrl: "https://payer.example",
 *   collectEvidence
 * });
 */
export const createX278HttpClient = (
  options: string | URL | X278HttpClientOptions
): X278HttpClient => {
  const resolved =
    typeof options === "string" || options instanceof URL
      ? { baseUrl: options }
      : options;
  const { maxSteps, collectEvidence, ...transportOptions } = resolved;
  const transport = createX278HttpTransport(transportOptions);
  const clientOptions: X278ClientOptions = {
    ...(maxSteps === undefined ? {} : { maxSteps }),
    ...(collectEvidence ? { collectEvidence } : {})
  };

  const client = createX278Client(transport, clientOptions);

  return {
    ...client,
    capabilities: transport.capabilities
  };
};

/**
 * Creates an HTTP client from environment variables for local parity.
 *
 * @example
 * const client = createX278HttpClientFromEnv(process.env, { collectEvidence });
 */
export const createX278HttpClientFromEnv = (
  env: X278Env = process.env,
  options: Omit<X278HttpClientOptions, "baseUrl" | "bearerToken"> = {}
): X278HttpClient => {
  if (!env.X278_PAYER_URL) {
    throw toProtocolError(
      "missing-base-url",
      makeInitialEvent("capabilities", "GET", "env:X278_PAYER_URL", undefined),
      "Set X278_PAYER_URL to the payer x278 endpoint."
    );
  }

  return createX278HttpClient({
    ...options,
    baseUrl: env.X278_PAYER_URL,
    ...(env.X278_BEARER_TOKEN ? { bearerToken: env.X278_BEARER_TOKEN } : {})
  });
};
