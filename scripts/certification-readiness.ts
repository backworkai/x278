import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type Status = "pass" | "fail" | "external";

interface Check {
  readonly id: string;
  readonly status: Status;
  readonly evidence: string;
}

const root = resolve(import.meta.dir, "..");

const file = (path: string) => readFile(resolve(root, path), "utf8");

const includes = (value: string, needle: string) => value.includes(needle);

const check = (id: string, condition: boolean, evidence: string): Check => ({
  id,
  status: condition ? "pass" : "fail",
  evidence
});

const external = (id: string, evidence: string): Check => ({
  id,
  status: "external",
  evidence
});

const main = async () => {
  const [
    packageJson,
    workflow,
    fullProofWorkflow,
    dockerfile,
    compose,
    envExample,
    releaseSmoke,
    liveAgents,
    fhirScenario,
    security
  ] = await Promise.all([
    file("package.json").then((value) => JSON.parse(value) as {
      readonly private?: boolean;
      readonly scripts?: Record<string, string>;
      readonly exports?: Record<string, unknown>;
      readonly files?: ReadonlyArray<string>;
    }),
    file(".github/workflows/ci.yml"),
    file(".github/workflows/full-proof.yml").catch(() => ""),
    file("Dockerfile"),
    file("compose.yaml"),
    file(".env.example"),
    file("scripts/release-smoke.ts"),
    file("test/live-agents.test.ts"),
    file("e2e/realistic/provider-fhir-scenario.ts"),
    file("SECURITY.md")
  ]);

  const scripts = packageJson.scripts ?? {};
  const exports = packageJson.exports ?? {};
  const packageFiles = packageJson.files ?? [];

  const checks: ReadonlyArray<Check> = [
    check(
      "release.proof.full-command",
      scripts["prove:full"]?.includes("test:live") === true &&
        scripts["prove:full"]?.includes("security:audit") === true &&
        scripts["prove:full"]?.includes("release:attw") === true &&
        scripts["prove:full"]?.includes("docker:fhir") === true,
      "prove:full runs security audit, live agents, package export validation, Docker transport, and HAPI FHIR validation"
    ),
    check(
      "release.ci.full-local-proof",
      includes(workflow, "bun run docker:realistic") &&
        includes(workflow, "bun run docker:fhir") &&
        includes(workflow, "bun run release:smoke") &&
        includes(workflow, "bun run release:attw"),
      "CI runs package smoke/export validation plus both Docker scenarios on push and pull request"
    ),
    check(
      "release.ci.manual-live-proof",
      includes(fullProofWorkflow, "workflow_dispatch") &&
        includes(fullProofWorkflow, "bun run prove:full") &&
        includes(fullProofWorkflow, "OPENAI_API_KEY") &&
        includes(fullProofWorkflow, "ANTHROPIC_API_KEY"),
      "manual CI workflow can run paid live-agent proof with repository secrets"
    ),
    check(
      "supply-chain.images-pinned",
      includes(dockerfile, "@sha256:") &&
        includes(compose, "oven/bun:1-alpine@sha256:") &&
        includes(compose, "hapiproject/hapi@sha256:") &&
        !includes(compose, ":latest"),
      "Docker proof images are pinned by digest and avoid floating latest tags"
    ),
    check(
      "supply-chain.package-payload",
      includes(releaseSmoke, "forbiddenPrefixes") &&
        includes(releaseSmoke, "e2e/") &&
        includes(releaseSmoke, "test/") &&
        includes(releaseSmoke, "dist/http-transport.cjs"),
      "release smoke rejects dev/test harness files from the packed package"
    ),
    check(
      "sdk.public-surface",
      Object.hasOwn(exports, "./http") &&
        JSON.stringify(exports).includes("\"require\"") &&
        scripts["release:attw"] === "bun run scripts/attw.ts" &&
        packageJson.private !== true &&
        packageFiles.includes("dist") &&
        packageFiles.includes("README.md") &&
        packageFiles.includes("LICENSE"),
      "public exports are dual ESM/CJS, production HTTP transport is exported, package publishing is enabled, and package files are allow-listed"
    ),
    check(
      "agents.real-model-proof",
      includes(liveAgents, "@openai/agents") &&
        includes(liveAgents, "@anthropic-ai/sdk") &&
        includes(liveAgents, "knee_missing_docs") &&
        includes(liveAgents, "spinal_stimulator_review") &&
        includes(liveAgents, "non_covered_service"),
      "live tests cover OpenAI Agents SDK and Anthropic SDK over retry, pended, and denial paths"
    ),
    check(
      "fhir.runtime-validation",
      includes(fhirScenario, "/$validate") &&
        includes(fhirScenario, "severity === \"fatal\"") &&
        includes(fhirScenario, "severity === \"error\"") &&
        includes(fhirScenario, "fatalCount") &&
        includes(fhirScenario, "errorCount"),
      "HAPI FHIR scenario validates every generated resource and fails on fatal/error issues"
    ),
    check(
      "secrets.synthetic-fixtures",
      includes(envExample, "OPENAI_API_KEY=") &&
        includes(envExample, "ANTHROPIC_API_KEY=") &&
        includes(security, "Fixtures must stay synthetic") &&
        includes(security, "Do not commit real PHI"),
      "repo fixtures and example environment are explicitly synthetic and do not include secrets"
    ),
    check(
      "security.dependency-audit",
      scripts["security:audit"] === "bun audit --audit-level=moderate",
      "moderate-or-higher dependency vulnerability audit is wired into proof and CI"
    ),
    external(
      "external.onc-acb-certification",
      "True ONC certification for provider prior authorization support requires testing/attestation through an ONC-Authorized Certification Body for 45 CFR 170.315(g)(33)"
    ),
    external(
      "external.pas-profile-conformance",
      "Da Vinci PAS certification requires conformance to the adopted PAS IG version, including EHR PAS Capabilities, ClaimResponse handling, and Subscriptions client behavior"
    ),
    external(
      "external.smart-backend-services",
      "Production use requires registration plus SMART Backend Services/OAuth client authentication against real payer or certification endpoints"
    ),
    external(
      "external.x12-path",
      "If using an X12 path rather than FHIR-only enforcement discretion, X12 278/275 mapping and licensing/testing must be handled outside this SDK"
    ),
    external(
      "external.security-privacy-review",
      "Production healthcare use still needs organization-level HIPAA security risk analysis, privacy review, incident process, and deployment controls"
    )
  ];

  const failed = checks.filter((item) => item.status === "fail");
  const result = {
    result: failed.length === 0 ? "pass" : "fail",
    checkedAt: new Date().toISOString(),
    summary: {
      pass: checks.filter((item) => item.status === "pass").length,
      fail: failed.length,
      external: checks.filter((item) => item.status === "external").length
    },
    checks
  };

  console.log(JSON.stringify(result, null, 2));

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

await main();
