import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Package, checkPackage } from "@arethetypeswrong/core";

interface PackResult {
  readonly filename: string;
}

interface PackedPackageJson {
  readonly name: string;
  readonly version: string;
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

const runBytes = async (
  command: string,
  args: ReadonlyArray<string>
): Promise<Uint8Array> => {
  const proc = Bun.spawn([command, ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe"
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited
  ]);

  if (exitCode !== 0) {
    throw new Error(
      [`Command failed: ${command} ${args.join(" ")}`, stderr.trim()]
        .filter(Boolean)
        .join("\n")
    );
  }

  return new Uint8Array(stdout);
};

const parsePackResult = (stdout: string): PackResult => {
  const clean = stdout.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");

  if (start === -1 || end === -1 || end < start) {
    throw new Error("npm pack did not return JSON output");
  }

  const parsed = JSON.parse(clean.slice(start, end + 1)) as unknown;
  if (!Array.isArray(parsed) || !parsed[0]?.filename) {
    throw new Error("npm pack did not return a filename");
  }

  return parsed[0] as PackResult;
};

const parsePackageJson = (bytes: Uint8Array): PackedPackageJson => {
  const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("name" in parsed) ||
    !("version" in parsed) ||
    typeof parsed.name !== "string" ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("packed package.json is missing name or version");
  }

  return {
    name: parsed.name,
    version: parsed.version
  };
};

const makePackage = async (tarball: string): Promise<Package> => {
  const listing = await run("tar", ["-tzf", tarball]);
  const files = listing
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.endsWith("/"));
  const prefix = files[0]?.slice(0, files[0].indexOf("/") + 1);

  if (!prefix) {
    throw new Error("packed tarball did not contain a package prefix");
  }

  const packageJsonPath = `${prefix}package.json`;
  const packageJsonBytes = await runBytes("tar", [
    "-xOzf",
    tarball,
    packageJsonPath
  ]);
  const packageJson = parsePackageJson(packageJsonBytes);
  const packageFiles: Record<string, Uint8Array> = {};

  for (const file of files) {
    const bytes = await runBytes("tar", ["-xOzf", tarball, file]);
    packageFiles[
      `/node_modules/${packageJson.name}/${file.slice(prefix.length)}`
    ] = bytes;
  }

  return new Package(packageFiles, packageJson.name, packageJson.version);
};

const main = async () => {
  const packDir = await mkdtemp(join(tmpdir(), "x278-attw-"));

  try {
    const pack = parsePackResult(
      await run("npm", [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        packDir
      ])
    );

    const tarball = join(packDir, pack.filename);
    const packed = await makePackage(tarball);
    const analysis = await checkPackage(packed);

    if (!analysis.types) {
      throw new Error("Are The Types Wrong found no bundled types");
    }

    const problems = analysis.problems.map((problem) => problem);

    console.log(
      JSON.stringify(
        {
          result: problems.length === 0 ? "pass" : "fail",
          packageName: analysis.packageName,
          packageVersion: analysis.packageVersion,
          entrypoints: Object.keys(analysis.entrypoints),
          problems
        },
        null,
        2
      )
    );

    if (problems.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await rm(packDir, { recursive: true, force: true });
  }
};

await main();
