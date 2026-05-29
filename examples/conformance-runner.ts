import {
  createMockPayer,
  runX278Conformance
} from "@backwork/x278";

const report = await runX278Conformance(createMockPayer());

console.log(JSON.stringify(report, null, 2));

if (!report.passed) {
  process.exitCode = 1;
}
