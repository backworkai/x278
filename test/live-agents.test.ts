import Anthropic from "@anthropic-ai/sdk";
import { Agent, run, tool } from "@openai/agents";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { z } from "zod";
import {
  PayerAgent,
  PayerAgentLive,
  kneeReplacementMissingDocs,
  nonCoveredService,
  spinalStimulatorReview
} from "../src/index.js";
import type {
  Determination,
  SupportingInfo,
  TerminalDetermination
} from "../src/index.js";

const shouldRunLive = process.env.RUN_LIVE_AGENT_TESTS === "1";
const hasOpenAIKey = Boolean(process.env.OPENAI_API_KEY);
const hasAnthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);

type ScenarioId =
  | "knee_missing_docs"
  | "spinal_stimulator_review"
  | "non_covered_service";

interface ScenarioTranscript {
  readonly caseId: ScenarioId;
  readonly first: Determination;
  readonly final: TerminalDetermination;
  readonly auditCount: number;
  readonly sameAuthId: boolean;
  readonly signedFinal: boolean;
}

const evidenceFor = (first: Determination): ReadonlyArray<SupportingInfo> => {
  if (first.status !== "info-needed") {
    return [];
  }

  return first.documentationRequired.map((requirement) => ({
    id: requirement.id,
    value: `live integration fixture evidence for ${requirement.id}`,
    source: "chart" as const
  }));
};

const runScenario = (caseId: ScenarioId): Promise<ScenarioTranscript> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const payer = yield* PayerAgent;

      const first =
        caseId === "knee_missing_docs"
          ? yield* payer.authorize(kneeReplacementMissingDocs)
          : caseId === "spinal_stimulator_review"
            ? yield* payer.authorize(spinalStimulatorReview)
            : yield* payer.authorize(nonCoveredService);

      const final =
        first.status === "info-needed"
          ? yield* payer.resume(first.authId, first.resumeToken, evidenceFor(first))
          : first.status === "pended"
            ? yield* payer.awaitDetermination(first.subscription)
            : first;

      if (final.status !== "approved" && final.status !== "denied") {
        throw new Error(`Scenario ${caseId} did not reach a terminal state`);
      }

      const audit = yield* payer.auditLog;

      return {
        caseId,
        first,
        final,
        auditCount: audit.length,
        sameAuthId: first.authId === final.authId,
        signedFinal: final.signature.alg === "EdDSA"
      };
    }).pipe(Effect.provide(PayerAgentLive))
  );

const LiveVerdict = z.object({
  provider: z.string(),
  caseId: z.string(),
  pass: z.boolean(),
  observedStatuses: z.array(z.string()),
  sameAuthId: z.boolean(),
  signedFinal: z.boolean(),
  auditCount: z.number(),
  notes: z.string()
});

const parseJsonObject = (text: string): unknown => {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed);
  }

  const match = trimmed.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`Model did not return a JSON object: ${text}`);
  }

  return JSON.parse(match[0]);
};

describe("live SDK-backed x278 protocol tests", () => {
  it.effect.skipIf(!shouldRunLive || !hasOpenAIKey)(
    "uses the OpenAI Agents SDK with a real model and local x278 tool",
    () =>
      Effect.promise(async () => {
        const runX278Case = tool({
          name: "run_x278_case",
          description:
            "Runs a local Backwork x278 reference scenario and returns the protocol transcript as JSON.",
          parameters: z.object({
            caseId: z.enum(["knee_missing_docs"])
          }),
          strict: true,
          async execute({ caseId }) {
            return JSON.stringify(await runScenario(caseId));
          }
        });

        const agent = new Agent({
          name: "x278 OpenAI live auditor",
          model: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4-mini",
          instructions:
            "You are a protocol test auditor. Call the tool, inspect the returned transcript, and return a structured verdict. Pass only if the first status is info-needed, the final status is approved, the authId is preserved, the terminal determination is signed, and exactly one audit record exists.",
          tools: [runX278Case],
          outputType: LiveVerdict,
          modelSettings: {
            toolChoice: "run_x278_case",
            maxTokens: 600,
            reasoning: { effort: "low" },
            text: { verbosity: "low" }
          }
        });

        const result = await run(
          agent,
          "Run the knee_missing_docs x278 case and return the verdict."
        );
        const verdict = result.finalOutput;

        assert.ok(verdict);
        assert.strictEqual(verdict.pass, true);
        assert.deepStrictEqual(verdict.observedStatuses, [
          "info-needed",
          "approved"
        ]);
        assert.strictEqual(verdict.sameAuthId, true);
        assert.strictEqual(verdict.signedFinal, true);
        assert.strictEqual(verdict.auditCount, 1);
      }),
    180_000
  );

  it.effect.skipIf(!shouldRunLive || !hasAnthropicKey)(
    "uses the Anthropic TypeScript SDK with a real model as an independent reviewer",
    () =>
      Effect.promise(async () => {
        const transcript = await runScenario("non_covered_service");
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        });

        const response = await client.messages.create({
          model:
            process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
          max_tokens: 500,
          system:
            "You are a protocol test reviewer. Return only JSON matching this shape: {\"provider\":\"anthropic-sdk\",\"caseId\":\"string\",\"pass\":boolean,\"observedStatuses\":[\"string\"],\"sameAuthId\":boolean,\"signedFinal\":boolean,\"auditCount\":number,\"notes\":\"string\"}. Pass only if this is a denied x278 terminal response with nextAction appeal, reasonCode not-covered, a signed EdDSA final determination, and one audit record.",
          messages: [
            {
              role: "user",
              content: JSON.stringify(transcript)
            }
          ]
        });

        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("");
        const verdict = LiveVerdict.parse(parseJsonObject(text));

        assert.strictEqual(verdict.pass, true);
        assert.ok(verdict.observedStatuses.includes("denied"));
        assert.strictEqual(verdict.sameAuthId, true);
        assert.strictEqual(verdict.signedFinal, true);
        assert.strictEqual(verdict.auditCount, 1);
      }),
    180_000
  );
});
