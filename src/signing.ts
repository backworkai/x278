import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify
} from "node:crypto";
import { Effect } from "effect";
import { canonicalize } from "./canonical-json.js";
import type {
  AuthorizationRequest,
  SignatureReceipt,
  TerminalDetermination,
  UnsignedTerminalDetermination
} from "./domain.js";

export interface PayerKeyPair {
  readonly keyId: string;
  readonly privateKey: unknown;
  readonly publicKeyPem: string;
}

export const sha256 = (value: string): string =>
  createHash("sha256").update(value).digest("hex");

export const requestHash = (request: AuthorizationRequest): string =>
  sha256(canonicalize(request));

const withoutSignature = (
  determination: TerminalDetermination
): UnsignedTerminalDetermination => {
  if (determination.status === "approved") {
    const { signature: _signature, ...unsigned } = determination;
    return unsigned;
  }

  const { signature: _signature, ...unsigned } = determination;
  return unsigned;
};

const signedPayload = (
  request: AuthorizationRequest,
  determination: UnsignedTerminalDetermination,
  receipt: Pick<SignatureReceipt, "issuedAt" | "keyId" | "nonce">
) =>
  canonicalize({
    determination,
    issuedAt: receipt.issuedAt,
    keyId: receipt.keyId,
    nonce: receipt.nonce,
    requestHash: requestHash(request)
  });

export const generatePayerKeyPair = (keyId: string): PayerKeyPair => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    privateKey,
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }) as string
  };
};

export const signDetermination = (
  request: AuthorizationRequest,
  determination: UnsignedTerminalDetermination,
  keyPair: PayerKeyPair
): Effect.Effect<SignatureReceipt> =>
  Effect.sync(() => {
    const receiptBase = {
      issuedAt: new Date().toISOString(),
      keyId: keyPair.keyId,
      nonce: crypto.randomUUID()
    };
    const payload = signedPayload(request, determination, receiptBase);
    const signature = nodeSign(
      null,
      Buffer.from(payload),
      keyPair.privateKey as Parameters<typeof nodeSign>[2]
    );

    return {
      alg: "EdDSA",
      format: "detached-json",
      ...receiptBase,
      requestHash: requestHash(request),
      payloadHash: sha256(payload),
      signature: signature.toString("base64url")
    };
  });

export const verifyDetermination = (
  request: AuthorizationRequest,
  determination: TerminalDetermination,
  publicKeyPem: string
): boolean => {
  const unsigned = withoutSignature(determination);
  const payload = signedPayload(request, unsigned, determination.signature);

  if (requestHash(request) !== determination.signature.requestHash) {
    return false;
  }

  if (sha256(payload) !== determination.signature.payloadHash) {
    return false;
  }

  return nodeVerify(
    null,
    Buffer.from(payload),
    publicKeyPem,
    Buffer.from(determination.signature.signature, "base64url")
  );
};

export const determinationHash = (
  determination: TerminalDetermination
): string => sha256(canonicalize(determination));
