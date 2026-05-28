import type {
  AuditRecord,
  AuthorizationRequest,
  Determination,
  SupportingInfo,
  TerminalDetermination
} from "../../src/domain.js";
import type { X278Transport } from "../../src/sdk.js";

export type X278Fetch = (
  input: string | URL | Request,
  init?: RequestInit
) => Promise<Response>;

export interface X278HttpTransportOptions {
  readonly baseUrl: string | URL;
  readonly fetch?: X278Fetch;
  readonly headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
}

const normalizeBaseUrl = (baseUrl: string | URL): URL => {
  const normalized = new URL(baseUrl.toString());
  if (!normalized.pathname.endsWith("/")) {
    normalized.pathname = `${normalized.pathname}/`;
  }
  return normalized;
};

const resolveHeaders = async (
  headers: X278HttpTransportOptions["headers"],
  hasBody: boolean
): Promise<Headers> => {
  const resolved =
    typeof headers === "function" ? await headers() : (headers ?? {});
  const output = new Headers(resolved);

  if (hasBody && !output.has("content-type")) {
    output.set("content-type", "application/json");
  }

  if (!output.has("accept")) {
    output.set("accept", "application/json");
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

const describeHttpError = (
  status: number,
  statusText: string,
  body: unknown
): string => {
  const detail =
    typeof body === "object" && body !== null && "error" in body
      ? JSON.stringify((body as { readonly error: unknown }).error)
      : JSON.stringify(body);

  return `x278 HTTP ${status} ${statusText}: ${detail}`;
};

export const createX278HttpTransport = (
  options: X278HttpTransportOptions
): X278Transport => {
  const baseUrl = normalizeBaseUrl(options.baseUrl);
  const fetcher: X278Fetch =
    options.fetch ?? ((input, init) => fetch(input, init));

  const requestJson = async <A>(
    path: string,
    init: {
      readonly method: "GET" | "POST";
      readonly body?: unknown;
    }
  ): Promise<A> => {
    const url = new URL(path, baseUrl);
    const hasBody = init.body !== undefined;
    const requestInit: RequestInit = {
      method: init.method,
      headers: await resolveHeaders(options.headers, hasBody)
    };

    if (hasBody) {
      requestInit.body = JSON.stringify(init.body);
    }

    const response = await fetcher(url, requestInit);
    const body = await readJson(response);

    if (!response.ok) {
      throw new Error(describeHttpError(response.status, response.statusText, body));
    }

    return body as A;
  };

  return {
    authorize: (request: AuthorizationRequest) =>
      requestJson<Determination>("authorize", {
        method: "POST",
        body: request
      }),
    resume: (
      authId: string,
      resumeToken: string,
      evidence: ReadonlyArray<SupportingInfo>
    ) =>
      requestJson<Determination>(
        `authorizations/${encodeURIComponent(authId)}/resume`,
        {
          method: "POST",
          body: { resumeToken, evidence }
        }
      ),
    awaitDetermination: (subscription: string) =>
      requestJson<TerminalDetermination>("determinations/await", {
        method: "POST",
        body: { subscription }
      }),
    auditLog: () =>
      requestJson<ReadonlyArray<AuditRecord>>("audit-log", { method: "GET" }),
    verify: (
      request: AuthorizationRequest,
      determination: TerminalDetermination
    ) =>
      requestJson<{ readonly valid: boolean }>("verify", {
        method: "POST",
        body: { request, determination }
      }).then((result) => result.valid)
  };
};
