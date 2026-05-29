import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dist = resolve(import.meta.dir, "..", "dist");

const rewriteSpecifiers = (source: string, extension: ".mjs" | ".cjs") =>
  source.replace(
    /((?:from|export)\s+["'][^"']+)\.js(["'])/g,
    `$1${extension}$2`
  );

const rewriteMap = (
  source: string,
  fromExtension: ".d.ts",
  toExtension: ".d.mts" | ".d.cts"
) => {
  const parsed = JSON.parse(source) as { file?: string };
  if (parsed.file?.endsWith(fromExtension)) {
    parsed.file = parsed.file.replace(fromExtension, toExtension);
  }

  return `${JSON.stringify(parsed)}\n`;
};

const main = async () => {
  const files = await readdir(dist);
  const declarations = files.filter(
    (file) => file.endsWith(".d.ts") && !file.endsWith(".d.cts")
  );

  await Promise.all(
    declarations.flatMap((file) => {
      const base = file.slice(0, -".d.ts".length);
      const declarationPath = resolve(dist, file);
      const mapPath = resolve(dist, `${file}.map`);

      return [
        readFile(declarationPath, "utf8").then(async (source) => {
          await writeFile(
            resolve(dist, `${base}.d.mts`),
            rewriteSpecifiers(
              source.replace(`${file}.map`, `${base}.d.mts.map`),
              ".mjs"
            )
          );
          await writeFile(
            resolve(dist, `${base}.d.cts`),
            rewriteSpecifiers(
              source.replace(`${file}.map`, `${base}.d.cts.map`),
              ".cjs"
            )
          );
        }),
        readFile(mapPath, "utf8").then(async (source) => {
          await writeFile(
            resolve(dist, `${base}.d.mts.map`),
            rewriteMap(source, ".d.ts", ".d.mts")
          );
          await writeFile(
            resolve(dist, `${base}.d.cts.map`),
            rewriteMap(source, ".d.ts", ".d.cts")
          );
        })
      ];
    })
  );
};

await main();
