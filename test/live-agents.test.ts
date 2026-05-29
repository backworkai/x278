import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
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

const LiveCaseVerdict = z.object({
  caseId: z.string(),
  pass: z.boolean(),
  observedStatuses: z.array(z.string()),
  sameAuthId: z.boolean(),
  signedFinal: z.boolean(),
  auditCount: z.number(),
  notes: z.string()
});

const LiveSuiteVerdict = z.object({
  provider: z.string(),
  pass: z.boolean(),
  cases: z.array(LiveCaseVerdict)
});

type LiveSuiteVerdict = z.infer<typeof LiveSuiteVerdict>;

const expectedStatuses = new Map<ScenarioId, ReadonlyArray<string>>([
  ["knee_missing_docs", ["info-needed", "approved"]],
  ["spinal_stimulator_review", ["pended", "approved"]],
  ["non_covered_service", ["denied", "denied"]]
]);

const assertLiveSuite = (verdict: LiveSuiteVerdict) => {
  assert.strictEqual(verdict.pass, true);
  assert.strictEqual(verdict.cases.length, expectedStatuses.size);

  for (const [caseId, statuses] of expectedStatuses) {
    const item = verdict.cases.find((candidate) => candidate.caseId === caseId);
    assert.ok(item, `missing live verdict for ${caseId}`);
    assert.strictEqual(item.pass, true, item.notes);
    assert.deepStrictEqual(item.observedStatuses, statuses);
    assert.strictEqual(item.sameAuthId, true);
    assert.strictEqual(item.signedFinal, true);
    assert.strictEqual(item.auditCount, 1);
  }
};

describe("live SDK-backed x278 protocol tests", () => {
  it.effect.skipIf(!shouldRunLive || !hasOpenAIKey)(
    "uses the OpenAI Agents SDK with a real model and local x278 tool over every core path",
    () =>
      Effect.promise(async () => {
        const runX278Suite = tool({
          name: "run_x278_suite",
          description:
            "Runs the local Backwork x278 reference scenarios and returns protocol transcripts as JSON.",
          parameters: z.object({}),
          strict: true,
          async execute() {
            const transcripts = await Promise.all(
              [...expectedStatuses.keys()].map(runScenario)
            );
            return JSON.stringify(transcripts);
          }
        });

        const agent = new Agent({
          name: "x278 OpenAI live auditor",
          model: process.env.OPENAI_AGENT_MODEL ?? "gpt-5.4-mini",
          instructions:
            "You are a protocol test auditor. Call the tool, inspect every transcript, and return a structured suite verdict. For observedStatuses, always return [first.status, final.status]. Pass the suite only if knee_missing_docs is info-needed then approved, spinal_stimulator_review is pended then approved, non_covered_service is denied then denied, every authId is preserved, every terminal determination is signed, and each scenario has exactly one audit record.",
          tools: [runX278Suite],
          outputType: LiveSuiteVerdict,
          modelSettings: {
            toolChoice: "run_x278_suite",
            maxTokens: 1000,
            reasoning: { effort: "low" },
            text: { verbosity: "low" }
          }
        });

        const result = await run(
          agent,
          "Run the x278 suite and return the verdict.",
          { maxTurns: 4 }
        );
        const verdict = result.finalOutput;

        assert.ok(verdict);
        assertLiveSuite(verdict);
      }),
    180_000
  );

  it.effect.skipIf(!shouldRunLive || !hasAnthropicKey)(
    "uses the Anthropic TypeScript SDK with a real model as an independent suite reviewer",
    () =>
      Effect.promise(async () => {
        const transcripts = await Promise.all(
          [...expectedStatuses.keys()].map(runScenario)
        );
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        });

        const response = await client.messages.parse({
          model:
            process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5-20250929",
          max_tokens: 1000,
          system:
            "You are a protocol test reviewer. Return a structured suite verdict. For observedStatuses, always return [first.status, final.status]. Pass the suite only if knee_missing_docs is info-needed then approved, spinal_stimulator_review is pended then approved, non_covered_service is denied then denied, every authId is preserved, every terminal determination is signed, and each scenario has exactly one audit record.",
          messages: [
            {
              role: "user",
              content: JSON.stringify(transcripts)
            }
          ],
          output_config: {
            format: zodOutputFormat(LiveSuiteVerdict)
          }
        });

        assert.ok(response.parsed_output);
        assertLiveSuite(response.parsed_output);
      }),
    180_000
  );
});
