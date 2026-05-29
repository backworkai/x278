import { Data, Effect, Schema } from "effect";

const NonEmptyStringSchema = Schema.String.pipe(Schema.nonEmptyString());

const isIsoDateString = (value: string): boolean => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }

  const [, year, month, day] = match;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    parsed.getUTCFullYear() === Number(year) &&
    parsed.getUTCMonth() + 1 === Number(month) &&
    parsed.getUTCDate() === Number(day)
  );
};

const IsoDateStringSchema = Schema.String.pipe(
  Schema.filter(
    (value) => isIsoDateString(value) || "must be a valid ISO date string"
  )
);

const UnitsSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const NpiSchema = Schema.String.pipe(Schema.pattern(/^\d{10}$/));
const TinSchema = Schema.String.pipe(Schema.pattern(/^\d{2}-\d{7}$/));

export const SupportingInfoSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  value: NonEmptyStringSchema,
  source: Schema.Literal("chart", "patient", "payer", "external")
});

export type SupportingInfo = typeof SupportingInfoSchema.Type;

export const SupportingInfoListSchema = Schema.Array(SupportingInfoSchema);

export const decodeSupportingInfoList = (
  input: unknown
): Effect.Effect<ReadonlyArray<SupportingInfo>, ProtocolError> =>
  Effect.suspend(() =>
    Schema.decodeUnknown(SupportingInfoListSchema)(input).pipe(
      Effect.mapError(
        (detail) =>
          new ProtocolError({
            kind: "validation",
            reason: "invalid-evidence",
            detail
          })
      )
    )
  ).pipe(
    Effect.catchAllDefect((detail) =>
      Effect.fail(
        new ProtocolError({
          kind: "validation",
          reason: "invalid-evidence",
          detail
        })
      )
    )
  );

export const DocumentationRequirementSchema = Schema.Struct({
  id: NonEmptyStringSchema,
  description: NonEmptyStringSchema,
  questionnaire: NonEmptyStringSchema
});

export type DocumentationRequirement =
  typeof DocumentationRequirementSchema.Type;

export const AuthorizationRequestSchema = Schema.Struct({
  patient: Schema.Struct({
    memberId: NonEmptyStringSchema,
    dob: IsoDateStringSchema
  }),
  provider: Schema.Struct({
    npi: NpiSchema,
    tin: TinSchema
  }),
  service: Schema.Struct({
    code: NonEmptyStringSchema,
    codeSystem: NonEmptyStringSchema,
    diagnosis: Schema.Array(NonEmptyStringSchema),
    placeOfService: NonEmptyStringSchema,
    requestedStart: IsoDateStringSchema,
    units: UnitsSchema,
    urgency: Schema.Literal("standard", "expedited")
  }),
  supportingInfo: Schema.Array(SupportingInfoSchema)
});

export type AuthorizationRequest = typeof AuthorizationRequestSchema.Type;

export type ProtocolErrorKind =
  | "validation"
  | "transport"
  | "workflow"
  | "payer";

export type ProtocolErrorReason =
  | "invalid-request"
  | "invalid-evidence"
  | "invalid-determination"
  | "invalid-terminal-determination"
  | "invalid-resume-token"
  | "unknown-subscription"
  | "evidence-required"
  | "evidence-collection-failed"
  | "max-steps-exceeded"
  | "http-error"
  | "http-timeout"
  | "http-request-failed"
  | "missing-base-url"
  | "transport-authorize-failed"
  | "transport-resume-failed"
  | "transport-await-failed"
  | "transport-audit-failed"
  | "transport-verify-failed"
  | "transport-capabilities-failed"
  | (string & {});

/**
 * Structured protocol failure raised by the SDK and Effect services.
 *
 * @example
 * try {
 *   await client.request(request);
 * } catch (error) {
 *   if (error instanceof ProtocolError && error.kind === "validation") {
 *     console.error(error.reason, error.detail);
 *   }
 * }
 */
export class ProtocolError extends Data.TaggedError("ProtocolError")<{
  readonly reason: ProtocolErrorReason;
  readonly kind?: ProtocolErrorKind;
  readonly detail?: unknown;
  readonly requestId?: string;
}> {
  override get message(): string {
    const kind = this.kind ? `${this.kind}: ` : "";
    return `${kind}${this.reason}`;
  }
}

export const decodeAuthorizationRequest = (
  input: unknown
): Effect.Effect<AuthorizationRequest, ProtocolError> =>
  Effect.suspend(() =>
    Schema.decodeUnknown(AuthorizationRequestSchema)(input).pipe(
      Effect.mapError(
        (detail) =>
          new ProtocolError({
            kind: "validation",
            reason: "invalid-request",
            detail
          })
      )
    )
  ).pipe(
    Effect.catchAllDefect((detail) =>
      Effect.fail(
        new ProtocolError({
          kind: "validation",
          reason: "invalid-request",
          detail
        })
      )
    )
  );

export type DeterminationStatus =
  | "approved"
  | "denied"
  | "info-needed"
  | "pended"
  | "error";

export type NextAction =
  | "none"
  | "attach-evidence"
  | "await-payer"
  | "appeal"
  | "contact-payer";

export type PendingReason =
  | "human-review"
  | "payer-processing"
  | "external-records";

export type DeterminationBy = "rules" | "clinical-reviewer" | null;

export interface SignatureReceipt {
  readonly alg: "EdDSA";
  readonly format: "detached-json";
  readonly keyId: string;
  readonly issuedAt: string;
  readonly requestHash: string;
  readonly payloadHash: string;
  readonly nonce: string;
  readonly signature: string;
}

export interface X278Capabilities {
  readonly protocol: "x278";
  readonly implementation: string;
  readonly endpoints: {
    readonly authorize: string;
    readonly resume: string;
    readonly awaitDetermination: string;
    readonly auditLog?: string;
    readonly verify?: string;
  };
  readonly signing?: {
    readonly alg: SignatureReceipt["alg"];
    readonly publicKeyPem?: string;
  };
}

export const SignatureReceiptSchema = Schema.Struct({
  alg: Schema.Literal("EdDSA"),
  format: Schema.Literal("detached-json"),
  keyId: Schema.String,
  issuedAt: Schema.String,
  requestHash: Schema.String,
  payloadHash: Schema.String,
  nonce: Schema.String,
  signature: Schema.String
});

export interface DeterminationBase {
  readonly authId: string;
  readonly status: DeterminationStatus;
  readonly nextAction: NextAction;
  readonly ruleSetVersion: string;
  readonly expiresAt: string | null;
  readonly determinationBy: DeterminationBy;
}

export interface ApprovedDetermination extends DeterminationBase {
  readonly status: "approved";
  readonly nextAction: "none";
  readonly authNumber: string;
  readonly approvedUnits: number;
  readonly validFrom: string;
  readonly validThrough: string;
  readonly determinationBy: "rules" | "clinical-reviewer";
  readonly signature: SignatureReceipt;
}

export const ApprovedDeterminationSchema = Schema.Struct({
  authId: Schema.String,
  status: Schema.Literal("approved"),
  nextAction: Schema.Literal("none"),
  ruleSetVersion: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  determinationBy: Schema.Literal("rules", "clinical-reviewer"),
  authNumber: Schema.String,
  approvedUnits: UnitsSchema,
  validFrom: IsoDateStringSchema,
  validThrough: IsoDateStringSchema,
  signature: SignatureReceiptSchema
});

export type UnsignedApprovedDetermination = Omit<
  ApprovedDetermination,
  "signature"
>;

export interface DeniedDetermination extends DeterminationBase {
  readonly status: "denied";
  readonly nextAction: "appeal";
  readonly reasonCode: string;
  readonly reasonText: string;
  readonly appealPath: string;
  readonly determinationBy: "rules" | "clinical-reviewer";
  readonly signature: SignatureReceipt;
}

export const DeniedDeterminationSchema = Schema.Struct({
  authId: Schema.String,
  status: Schema.Literal("denied"),
  nextAction: Schema.Literal("appeal"),
  ruleSetVersion: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  determinationBy: Schema.Literal("rules", "clinical-reviewer"),
  reasonCode: Schema.String,
  reasonText: Schema.String,
  appealPath: Schema.String,
  signature: SignatureReceiptSchema
});

export type UnsignedDeniedDetermination = Omit<DeniedDetermination, "signature">;

export type UnsignedTerminalDetermination =
  | UnsignedApprovedDetermination
  | UnsignedDeniedDetermination;

export interface InfoNeededDetermination extends DeterminationBase {
  readonly status: "info-needed";
  readonly nextAction: "attach-evidence";
  readonly documentationRequired: ReadonlyArray<DocumentationRequirement>;
  readonly resumeToken: string;
  readonly determinationBy: null;
}

export const InfoNeededDeterminationSchema = Schema.Struct({
  authId: Schema.String,
  status: Schema.Literal("info-needed"),
  nextAction: Schema.Literal("attach-evidence"),
  ruleSetVersion: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  determinationBy: Schema.Null,
  documentationRequired: Schema.Array(DocumentationRequirementSchema),
  resumeToken: Schema.String
});

export interface PendedDetermination extends DeterminationBase {
  readonly status: "pended";
  readonly nextAction: "await-payer";
  readonly pendingReason: PendingReason;
  readonly subscription: string;
  readonly determinationBy: "clinical-reviewer" | null;
}

export const PendedDeterminationSchema = Schema.Struct({
  authId: Schema.String,
  status: Schema.Literal("pended"),
  nextAction: Schema.Literal("await-payer"),
  ruleSetVersion: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  determinationBy: Schema.NullOr(Schema.Literal("clinical-reviewer")),
  pendingReason: Schema.Literal(
    "human-review",
    "payer-processing",
    "external-records"
  ),
  subscription: Schema.String
});

export interface ErrorDetermination extends DeterminationBase {
  readonly status: "error";
  readonly nextAction: "contact-payer";
  readonly reasonCode: string;
  readonly reasonText: string;
  readonly determinationBy: null;
}

export const ErrorDeterminationSchema = Schema.Struct({
  authId: Schema.String,
  status: Schema.Literal("error"),
  nextAction: Schema.Literal("contact-payer"),
  ruleSetVersion: Schema.String,
  expiresAt: Schema.NullOr(Schema.String),
  determinationBy: Schema.Null,
  reasonCode: Schema.String,
  reasonText: Schema.String
});

export type TerminalDetermination =
  | ApprovedDetermination
  | DeniedDetermination;

export type NonTerminalDetermination =
  | InfoNeededDetermination
  | PendedDetermination;

export type Determination =
  | TerminalDetermination
  | NonTerminalDetermination
  | ErrorDetermination;

export const TerminalDeterminationSchema = Schema.Union(
  ApprovedDeterminationSchema,
  DeniedDeterminationSchema
);

export const DeterminationSchema = Schema.Union(
  ApprovedDeterminationSchema,
  DeniedDeterminationSchema,
  InfoNeededDeterminationSchema,
  PendedDeterminationSchema,
  ErrorDeterminationSchema
);

export const decodeDetermination = (
  input: unknown
): Effect.Effect<Determination, ProtocolError> =>
  Effect.suspend(() =>
    Schema.decodeUnknown(DeterminationSchema)(input).pipe(
      Effect.mapError(
        (detail) =>
          new ProtocolError({
            kind: "validation",
            reason: "invalid-determination",
            detail
          })
      )
    )
  ).pipe(
    Effect.catchAllDefect((detail) =>
      Effect.fail(
        new ProtocolError({
          kind: "validation",
          reason: "invalid-determination",
          detail
        })
      )
    )
  );

export const decodeTerminalDetermination = (
  input: unknown
): Effect.Effect<TerminalDetermination, ProtocolError> =>
  Effect.suspend(() =>
    Schema.decodeUnknown(TerminalDeterminationSchema)(input).pipe(
      Effect.mapError(
        (detail) =>
          new ProtocolError({
            kind: "validation",
            reason: "invalid-terminal-determination",
            detail
          })
      )
    )
  ).pipe(
    Effect.catchAllDefect((detail) =>
      Effect.fail(
        new ProtocolError({
          kind: "validation",
          reason: "invalid-terminal-determination",
          detail
        })
      )
    )
  );

export interface AuditRecord {
  readonly authId: string;
  readonly status: TerminalDetermination["status"];
  readonly requestHash: string;
  readonly determinationHash: string;
  readonly signatureKeyId: string;
  readonly appendedAt: string;
}
