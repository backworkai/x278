import { createSign } from "node:crypto";
import { ProtocolError } from "./domain.js";
import type { X278Fetch } from "./http.js";

export interface SmartBackendToken {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly expiresAt: number;
  readonly scope?: string;
}

export interface SmartConfiguration {
  readonly token_endpoint: string;
  readonly token_endpoint_auth_methods_supported?: ReadonlyArray<string>;
  readonly token_endpoint_auth_signing_alg_values_supported?: ReadonlyArray<string>;
  readonly scopes_supported?: ReadonlyArray<string>;
  readonly [key: string]: unknown;
}

export type SmartBackendAuthentication =
  | {
      readonly method: "client-secret-basic";
      readonly clientSecret: string;
    }
  | {
      readonly method: "client-secret-post";
      readonly clientSecret: string;
    }
  | {
      readonly method: "private-key-jwt";
      readonly privateKeyPem?: string;
      readonly keyId?: string;
      readonly alg?: "RS384" | string;
      readonly signJwt?: (
        header: SmartJwtHeader,
        claims: SmartClientAssertionClaims
      ) => string | Promise<string>;
      readonly assertionTtlSeconds?: number;
    };

export interface SmartBackendTokenProviderOptions {
  readonly tokenEndpoint: string | URL;
  readonly clientId: string;
  readonly scopes: string | ReadonlyArray<string>;
  readonly authentication: SmartBackendAuthentication;
  readonly fetch?: X278Fetch;
  readonly now?: () => number;
  readonly randomUUID?: () => string;
  readonly cacheSkewSeconds?: number;
}

export interface SmartJwtHeader {
  readonly alg: string;
  readonly typ: "JWT";
  readonly kid?: string;
}

export interface SmartClientAssertionClaims {
  readonly iss: string;
  readonly sub: string;
  readonly aud: string;
  readonly exp: number;
  readonly iat: number;
  readonly jti: string;
}

interface TokenResponse {
  readonly access_token?: unknown;
  readonly token_type?: unknown;
  readonly expires_in?: unknown;
  readonly scope?: unknown;
}

const clientAssertionType =
  "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

const base64Url = (input: string | Buffer): string =>
  Buffer.from(input)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");

const base64 = (input: string): string => Buffer.from(input).toString("base64");

const formComponent = (input: string): string =>
  new URLSearchParams({ value: input }).toString().slice("value=".length);

const jsonPart = (value: unknown): string => base64Url(JSON.stringify(value));

const signRs384 = (signingInput: string, privateKeyPem: string): string => {
  const signer = createSign("RSA-SHA384");
  signer.update(signingInput);
  signer.end();
  return base64Url(signer.sign(privateKeyPem));
};

const createPrivateKeyJwt = async (
  options: SmartBackendTokenProviderOptions,
  auth: Extract<SmartBackendAuthentication, { readonly method: "private-key-jwt" }>
): Promise<string> => {
  const nowSeconds = Math.floor((options.now?.() ?? Date.now()) / 1000);
  const alg = auth.alg ?? "RS384";
  const header: SmartJwtHeader = {
    alg,
    typ: "JWT",
    ...(auth.keyId ? { kid: auth.keyId } : {})
  };
  const claims: SmartClientAssertionClaims = {
    iss: options.clientId,
    sub: options.clientId,
    aud: options.tokenEndpoint.toString(),
    iat: nowSeconds,
    exp: nowSeconds + (auth.assertionTtlSeconds ?? 300),
    jti: options.randomUUID?.() ?? crypto.randomUUID()
  };

  if (auth.signJwt) {
    return auth.signJwt(header, claims);
  }

  if (!auth.privateKeyPem || alg !== "RS384") {
    throw new ProtocolError({
      kind: "validation",
      reason: "smart-auth-configuration-invalid",
      detail:
        "Built-in SMART private_key_jwt signing supports RS384 privateKeyPem. Provide signJwt for other algorithms."
    });
  }

  const signingInput = `${jsonPart(header)}.${jsonPart(claims)}`;
  return `${signingInput}.${signRs384(signingInput, auth.privateKeyPem)}`;
};

const decodeTokenResponse = (
  body: TokenResponse,
  nowMs: number,
  cacheSkewSeconds: number
): SmartBackendToken => {
  if (typeof body.access_token !== "string") {
    throw new ProtocolError({
      kind: "transport",
      reason: "smart-token-response-invalid",
      detail: body
    });
  }

  const expiresIn =
    typeof body.expires_in === "number" && Number.isFinite(body.expires_in)
      ? body.expires_in
      : 300;
  const tokenType =
    typeof body.token_type === "string" ? body.token_type : "Bearer";
  const expiresAt = nowMs + Math.max(0, expiresIn - cacheSkewSeconds) * 1000;

  return {
    accessToken: body.access_token,
    tokenType,
    expiresAt,
    ...(typeof body.scope === "string" ? { scope: body.scope } : {})
  };
};

const parseJsonResponse = <A>(
  responseText: string,
  reason:
    | "smart-configuration-failed"
    | "smart-token-request-failed"
    | "smart-token-response-invalid"
): A => {
  if (!responseText) {
    return {} as A;
  }

  try {
    return JSON.parse(responseText) as A;
  } catch (detail) {
    throw new ProtocolError({
      kind: "transport",
      reason,
      detail: { body: responseText, cause: detail }
    });
  }
};

export const createSmartBackendTokenProvider = (
  options: SmartBackendTokenProviderOptions
): (() => Promise<string>) => {
  const fetcher = options.fetch ?? ((input, init) => fetch(input, init));
  const tokenEndpoint = options.tokenEndpoint.toString();
  const scope =
    typeof options.scopes === "string"
      ? options.scopes
      : options.scopes.join(" ");
  const cacheSkewSeconds = options.cacheSkewSeconds ?? 30;
  let cached: SmartBackendToken | undefined;

  return async () => {
    const nowMs = options.now?.() ?? Date.now();
    if (cached && cached.expiresAt > nowMs) {
      return cached.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope
    });
    const headers = new Headers({
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded"
    });

    if (options.authentication.method === "client-secret-basic") {
      headers.set(
        "authorization",
        `Basic ${base64(
          `${formComponent(options.clientId)}:${formComponent(
            options.authentication.clientSecret
          )}`
        )}`
      );
    } else if (options.authentication.method === "client-secret-post") {
      body.set("client_id", options.clientId);
      body.set("client_secret", options.authentication.clientSecret);
    } else {
      body.set("client_id", options.clientId);
      body.set("client_assertion_type", clientAssertionType);
      body.set(
        "client_assertion",
        await createPrivateKeyJwt(options, options.authentication)
      );
    }

    const response = await fetcher(tokenEndpoint, {
      method: "POST",
      headers,
      body
    });
    const responseText = await response.text();
    const responseBody = parseJsonResponse<TokenResponse>(
      responseText,
      response.ok ? "smart-token-response-invalid" : "smart-token-request-failed"
    );

    if (!response.ok) {
      const requestId = response.headers.get("x-request-id") ?? undefined;
      throw new ProtocolError({
        kind: "transport",
        reason: "smart-token-request-failed",
        ...(requestId ? { requestId } : {}),
        detail: {
          status: response.status,
          statusText: response.statusText,
          body: responseBody
        }
      });
    }

    cached = decodeTokenResponse(responseBody, nowMs, cacheSkewSeconds);
    return cached.accessToken;
  };
};

export const discoverSmartConfiguration = async (
  fhirBaseUrl: string | URL,
  fetcher: X278Fetch = (input, init) => fetch(input, init)
): Promise<SmartConfiguration> => {
  const base = new URL(fhirBaseUrl.toString());
  if (!base.pathname.endsWith("/")) {
    base.pathname = `${base.pathname}/`;
  }
  const url = new URL(".well-known/smart-configuration", base);
  const response = await fetcher(url, { method: "GET" });
  const body = parseJsonResponse<SmartConfiguration>(
    await response.text(),
    "smart-configuration-failed"
  );

  if (!response.ok || typeof body.token_endpoint !== "string") {
    throw new ProtocolError({
      kind: "transport",
      reason: "smart-configuration-failed",
      detail: { status: response.status, body }
    });
  }

  return body;
};
