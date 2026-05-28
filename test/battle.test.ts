import { assert, describe, it } from "@effect/vitest";
import type {
  AuthorizationRequest,
  Determination,
  SupportingInfo
} from "../src/index.js";
import {
  ProtocolError,
  createMockPayer,
  createMockX278Client,
  kneeReplacementComplete,
  kneeReplacementMissingDocs,
  runX278Conformance,
  spinalStimulatorReview
} from "../src/index.js";

const cloneRequest = (request: AuthorizationRequest): AuthorizationRequest =>
  structuredClone(request);

const withRequest = (
  mutate: (request: {
    patient: { memberId: string; dob: string };
    provider: { npi: string; tin: string };
    service: {
      code: string;
      codeSystem: string;
      diagnosis: Array<string>;
      placeOfService: string;
      requestedStart: string;
      units: number;
      urgency: "standard" | "expedited";
    };
    supportingInfo: Array<SupportingInfo>;
  }) => void
): AuthorizationRequest => {
  const request = cloneRequest(kneeReplacementComplete) as {
    patient: { memberId: string; dob: string };
    provider: { npi: string; tin: string };
    service: {
      code: string;
      codeSystem: string;
      diagnosis: Array<string>;
      placeOfService: string;
      requestedStart: string;
      units: number;
      urgency: "standard" | "expedited";
    };
    supportingInfo: Array<SupportingInfo>;
  };
  mutate(request);
  return request as AuthorizationRequest;
};

const completeEvidence: ReadonlyArray<SupportingInfo> = [
  {
    id: "conservative-tx-6wk",
    value: "Eight weeks of PT documented.",
    source: "chart"
  },
  {
    id: "weight-bearing-xray",
    value: "Recent weight-bearing x-ray attached.",
    source: "chart"
  }
];

const expectProtocolError = async (
  run: () => Promise<unknown>,
  reason: string,
  label: string
) => {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }

  assert.ok(
    caught instanceof ProtocolError,
    `${label}: expected ProtocolError, got ${
      caught instanceof Error ? caught.constructor.name : typeof caught
    }`
  );
  assert.strictEqual(caught.reason, reason, label);
};

const throwingRequestLike = () => {
  const value: Record<string, unknown> = {};
  Object.defineProperty(value, "patient", {
    enumerable: true,
    get() {
      throw new Error("hostile getter");
    }
  });
  return value;
};

const adversarialInputs: ReadonlyArray<unknown> = [
  null,
  undefined,
  true,
  42,
  "",
  [],
  {},
  { patient: null },
  { ...kneeReplacementComplete, supportingInfo: null },
  withRequest((request) => {
    request.service.code = "";
  }),
  withRequest((request) => {
    request.service.units = 0;
  }),
  withRequest((request) => {
    request.service.units = -1;
  }),
  withRequest((request) => {
    request.service.units = 1.5;
  }),
  withRequest((request) => {
    request.service.units = Number.NaN;
  }),
  withRequest((request) => {
    request.service.units = Number.POSITIVE_INFINITY;
  }),
  withRequest((request) => {
    request.service.requestedStart = "not-a-date";
  }),
  withRequest((request) => {
    request.service.requestedStart = "2026-02-31";
  }),
  withRequest((request) => {
    request.patient.dob = "1971-13-02";
  }),
  withRequest((request) => {
    request.provider.npi = "197264839";
  }),
  withRequest((request) => {
    request.provider.tin = "not-a-tin";
  }),
  throwingRequestLike()
];

const terminalStatuses = new Set([
  "approved",
  "denied",
  "info-needed",
  "pended",
  "error"
]);

describe("x278 battle tests", () => {
  it("rejects malformed and semantically invalid requests as typed protocol errors", async () => {
    const client = createMockX278Client();

    for (const [index, input] of adversarialInputs.entries()) {
      try {
        const determination = await client.authorize(input);
        assert.ok(
          terminalStatuses.has(determination.status),
          `case ${index}: unexpected status ${determination.status}`
        );
      } catch (error) {
        assert.ok(
          error instanceof ProtocolError,
          `case ${index}: leaked ${
            error instanceof Error ? error.constructor.name : typeof error
          }`
        );
      }
    }
  });

  it("validates resume evidence before it mutates pending authorization state", async () => {
    const payer = createMockPayer();
    const first = await payer.authorize(kneeReplacementMissingDocs);
    if (first.status !== "info-needed") {
      throw new Error(`expected info-needed, got ${first.status}`);
    }

    await expectProtocolError(
      () => payer.resume(first.authId, first.resumeToken, null as never),
      "invalid-evidence",
      "null evidence"
    );

    await expectProtocolError(
      () =>
        payer.resume(first.authId, first.resumeToken, [
          { id: "conservative-tx-6wk", value: "ok", source: "alien" }
        ] as never),
      "invalid-evidence",
      "bad evidence source"
    );

    const final = await payer.resume(
      first.authId,
      first.resumeToken,
      completeEvidence
    );
    assert.strictEqual(final.status, "approved");

    await expectProtocolError(
      () => payer.resume(first.authId, first.resumeToken, completeEvidence),
      "invalid-resume-token",
      "resume token replay"
    );
  });

  it("rejects invalid evidence returned by SDK collectors before transport resume", async () => {
    const client = createMockX278Client({
      collectEvidence: () =>
        [
          {
            id: "conservative-tx-6wk",
            value: "not enough",
            source: "not-a-source"
          }
        ] as never
    });

    await expectProtocolError(
      () => client.request(kneeReplacementMissingDocs),
      "invalid-evidence",
      "collector evidence"
    );
  });

  it("rejects replayed subscriptions and invalid resume tokens", async () => {
    const payer = createMockPayer();
    const first = await payer.authorize(kneeReplacementMissingDocs);
    assert.strictEqual(first.status, "info-needed");

    await expectProtocolError(
      () => payer.resume(first.authId, "rt_wrong", completeEvidence),
      "invalid-resume-token",
      "wrong resume token"
    );

    const pended = await payer.authorize(spinalStimulatorReview);
    if (pended.status !== "pended") {
      throw new Error(`expected pended, got ${pended.status}`);
    }

    const final = await payer.awaitDetermination(pended.subscription);
    assert.strictEqual(final.status, "approved");

    await expectProtocolError(
      () => payer.awaitDetermination(pended.subscription),
      "unknown-subscription",
      "subscription replay"
    );
  });

  it("fails signature verification when the request, determination, or receipt is tampered", async () => {
    const payer = createMockPayer();
    const approved = await payer.authorize(kneeReplacementComplete);
    if (approved.status !== "approved") {
      throw new Error(`expected approved, got ${approved.status}`);
    }
    const verify = payer.verify;
    if (!verify) {
      throw new Error("mock payer must expose verify");
    }

    const changedDetermination = {
      ...approved,
      approvedUnits: approved.approvedUnits + 1
    };
    assert.strictEqual(
      await verify(kneeReplacementComplete, changedDetermination),
      false
    );

    const changedRequest = withRequest((request) => {
      request.service.units = 2;
    });
    assert.strictEqual(await verify(changedRequest, approved), false);

    const changedReceipt = {
      ...approved,
      signature: {
        ...approved.signature,
        payloadHash: "0".repeat(64)
      }
    };
    assert.strictEqual(
      await verify(kneeReplacementComplete, changedReceipt),
      false
    );
  });

  it("catches transport regressions with the conformance harness", async () => {
    const payer = createMockPayer();
    const brokenPayer = {
      ...payer,
      resume: async (
        authId: string,
        resumeToken: string,
        evidence: ReadonlyArray<SupportingInfo>
      ): Promise<Determination> => {
        const determination = await payer.resume(authId, resumeToken, evidence);
        return determination.status === "approved"
          ? { ...determination, authId: `${determination.authId}-mutated` }
          : determination;
      }
    };

    const report = await runX278Conformance(brokenPayer);
    const continuity = report.checks.find(
      (item) => item.id === "x278.auth-continuity"
    );

    assert.strictEqual(report.passed, false);
    assert.strictEqual(continuity?.passed, false);
  });
});
