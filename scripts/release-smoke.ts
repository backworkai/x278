import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface PackFile {
  readonly path: string;
}

interface PackResult {
  readonly filename: string;
  readonly files: ReadonlyArray<PackFile>;
}

const root = resolve(import.meta.dir, "..");

const run = async (
  command: string,
  args: ReadonlyArray<string>,
  cwd = root
): Promise<string> => {
  const proc = Bun.spawn([command, ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(" ")}`,
        stdout.trim(),
        stderr.trim()
      ]
        .filter(Boolean)
        .join("\n")
    );
  }

  return stdout;
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

const parsePackResult = (stdout: string): PackResult => {
  const clean = stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("npm pack did not return JSON output");
  }

  const parsed = JSON.parse(clean.slice(start, end + 1)) as unknown;
  assert(Array.isArray(parsed), "npm pack did not return a JSON array");
  const first = parsed[0] as Partial<PackResult> | undefined;
  assert(first?.filename, "npm pack did not return a filename");
  assert(Array.isArray(first.files), "npm pack did not return a file list");
  return first as PackResult;
};

const assertPackagePayload = (files: ReadonlyArray<PackFile>) => {
  const paths = files.map((file) => file.path).sort();
  const required = [
    "README.md",
    "LICENSE",
    "package.json",
    "dist/index.mjs",
    "dist/index.cjs",
    "dist/index.d.ts",
    "dist/index.d.ts.map",
    "dist/index.d.mts",
    "dist/index.d.cts",
    "dist/sdk.mjs",
    "dist/sdk.cjs",
    "dist/sdk.d.ts",
    "dist/sdk.d.ts.map",
    "dist/sdk.d.mts",
    "dist/sdk.d.cts"
  ];
  const forbiddenPrefixes = [
    ".github/",
    "docs/",
    "e2e/",
    "scripts/",
    "src/",
    "test/"
  ];
  const forbiddenFiles = [
    ".dockerignore",
    "compose.yaml",
    "Dockerfile",
    "dist/http-transport.mjs",
    "dist/http-transport.cjs",
    "dist/http-transport.js",
    "dist/http-transport.d.ts"
  ];

  for (const path of required) {
    assert(paths.includes(path), `package is missing required file ${path}`);
  }

  for (const path of paths) {
    assert(
      !forbiddenPrefixes.some((prefix) => path.startsWith(prefix)),
      `package includes test/dev path ${path}`
    );
    assert(
      !forbiddenFiles.includes(path),
      `package includes forbidden file ${path}`
    );
  }
};

const esmConsumerSource = `
import {
  createMockPayer,
  createMockX278Client,
  kneeReplacementMissingDocs,
  runX278Conformance
} from "@backwork/x278";
import { createX278Client } from "@backwork/x278/sdk";
import { runX278Conformance as runConformance } from "@backwork/x278/conformance";
import {
  AuthorizationRequestSchema,
  type AuthorizationRequest
} from "@backwork/x278/types";
import { DeterminationSchema } from "@backwork/x278/schemas";
import { toPasClaimBundle } from "@backwork/x278/fhir-pas";
import { makeReferencePayerAgent } from "@backwork/x278/payer-agent";
import { ProviderClient } from "@backwork/x278/provider-client";
import { requestHash } from "@backwork/x278/signing";

const request: AuthorizationRequest = kneeReplacementMissingDocs;
const payer = createMockPayer();
const client = createMockX278Client({
  collectEvidence: (_request, requirements) =>
    requirements.map((requirement) => ({
      id: requirement.id,
      value: "release smoke fixture evidence",
      source: "chart" as const
    }))
});

const directClient = createX278Client(payer);
const final = await client.request(request);
const report = await runX278Conformance(payer);
const secondReport = await runConformance(createMockPayer());
const bundle = toPasClaimBundle(request, final.authId);

if (final.status !== "approved") {
  throw new Error(\`expected approved final determination, got \${final.status}\`);
}
if (!report.passed || !secondReport.passed) {
  throw new Error("conformance report failed");
}
if (bundle.entry.length !== 4) {
  throw new Error("PAS bundle did not include expected resources");
}

void directClient;
void AuthorizationRequestSchema;
void DeterminationSchema;
void makeReferencePayerAgent;
void ProviderClient;
void requestHash;
`;

const cjsConsumerSource = `
const {
  createMockPayer,
  createMockX278Client,
  kneeReplacementMissingDocs,
  runX278Conformance
} = require("@backwork/x278");
const { createX278Client } = require("@backwork/x278/sdk");
const { AuthorizationRequestSchema } = require("@backwork/x278/types");
const { DeterminationSchema } = require("@backwork/x278/schemas");
const { toPasClaimBundle } = require("@backwork/x278/fhir-pas");
const { makeReferencePayerAgent } = require("@backwork/x278/payer-agent");
const { ProviderClient } = require("@backwork/x278/provider-client");
const { requestHash } = require("@backwork/x278/signing");

(async () => {
  const request = kneeReplacementMissingDocs;
  const payer = createMockPayer();
  const client = createMockX278Client({
    collectEvidence: (_request, requirements) =>
      requirements.map((requirement) => ({
        id: requirement.id,
        value: "release smoke fixture evidence",
        source: "chart"
      }))
  });

  const directClient = createX278Client(payer);
  const final = await client.request(request);
  const report = await runX278Conformance(payer);
  const bundle = toPasClaimBundle(request, final.authId);

  if (final.status !== "approved") {
    throw new Error(\`expected approved final determination, got \${final.status}\`);
  }
  if (!report.passed) {
    throw new Error("conformance report failed");
  }
  if (bundle.entry.length !== 4) {
    throw new Error("PAS bundle did not include expected resources");
  }

  void directClient;
  void AuthorizationRequestSchema;
  void DeterminationSchema;
  void makeReferencePayerAgent;
  void ProviderClient;
  void requestHash;
})();
`;

const tsconfig = {
  compilerOptions: {
    target: "ES2022",
    module: "NodeNext",
    moduleResolution: "NodeNext",
    strict: true,
    skipLibCheck: false,
    noEmit: true
  },
  include: ["smoke.ts"]
};

const main = async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), "x278-release-smoke-"));
  const packDir = join(tempRoot, "pack");
  const consumerDir = join(tempRoot, "consumer");

  try {
    await mkdir(packDir, { recursive: true });
    await mkdir(consumerDir, { recursive: true });
    const pack = parsePackResult(
      await run("npm", [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        packDir
      ])
    );
    assertPackagePayload(pack.files);

    const tarball = join(packDir, pack.filename);
    await writeFile(
      join(consumerDir, "package.json"),
      JSON.stringify({ private: true, type: "module" }, null, 2)
    );
    await writeFile(
      join(consumerDir, "tsconfig.json"),
      JSON.stringify(tsconfig, null, 2)
    );
    await writeFile(join(consumerDir, "smoke.ts"), esmConsumerSource.trimStart());
    await writeFile(join(consumerDir, "smoke.cjs"), cjsConsumerSource.trimStart());

    await run("bun", ["add", tarball], consumerDir);
    await run(
      "bun",
      [join(root, "node_modules/typescript/bin/tsc"), "-p", "."],
      consumerDir
    );
    await run("bun", ["run", "smoke.ts"], consumerDir);
    await run("node", ["smoke.cjs"], consumerDir);

    console.log(`release smoke passed: ${pack.filename}`);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

await main();
