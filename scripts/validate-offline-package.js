import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { validateZipPackage } from "../src/offline/package-readiness.js";

const input = process.argv[2];
const output = process.argv[3] || `${input ? resolve(input) : "offline-package"}.readiness.json`;
if (!input) {
  console.error("Usage: node scripts/validate-offline-package.js <package.zip> [report.json]");
  process.exit(2);
}
const report = validateZipPackage(await readFile(input));
report.package = basename(input);
await writeFile(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ package: report.package, status: report.status, blockers: report.blockers, report: output }, null, 2));
process.exit(report.status === "FULL_OFFLINE_READY" ? 0 : 1);
