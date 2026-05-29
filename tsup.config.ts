import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    sdk: "src/sdk.ts",
    conformance: "src/conformance.ts",
    domain: "src/domain.ts",
    "fhir-pas": "src/fhir-pas.ts",
    http: "src/http.ts",
    "payer-agent": "src/payer-agent.ts",
    "provider-client": "src/provider-client.ts",
    signing: "src/signing.ts"
  },
  format: ["esm", "cjs"],
  target: "es2022",
  platform: "node",
  clean: true,
  dts: false,
  sourcemap: true,
  splitting: false,
  treeshake: true,
  external: ["effect", "zod"],
  outExtension: ({ format }) => ({
    js: format === "esm" ? ".mjs" : ".cjs"
  })
});
