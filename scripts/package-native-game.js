#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

const root = path.resolve(process.argv[2] || "native-game");
const config = JSON.parse(fs.readFileSync(path.join(root, "config/native-game-config.json"), "utf8"));
const outputDir = path.resolve(process.argv[3] || "artifacts/native");
fs.mkdirSync(outputDir, { recursive: true });
const temp = path.join(outputDir, `${config.game_id}-${config.package_version}`);
const zipWithoutManifest = path.join(outputDir, `${config.game_id}-${config.package_version}.zip`);
fs.rmSync(temp, { recursive: true, force: true });
fs.rmSync(zipWithoutManifest, { force: true });

try {
  fs.cpSync(root, temp, { recursive: true });
  execFileSync("zip", ["-qr", zipWithoutManifest, "."], { cwd: temp });
  const digest = crypto.createHash("sha256").update(fs.readFileSync(zipWithoutManifest)).digest("hex");
  const finalZip = path.join(outputDir, `${config.game_id}-${config.package_version}-${digest.slice(0, 12)}.zip`);
  fs.renameSync(zipWithoutManifest, finalZip);
  const provenance = {
    schema_version: "1.0",
    source_commit: process.env.GITHUB_SHA || "local",
    workflow: process.env.GITHUB_WORKFLOW || "local",
    builder_identity: process.env.GITHUB_ACTOR || "local",
    toolchain: { node: process.version },
    input_hash: digest,
    output_hash: digest,
    artifact_reference: path.basename(finalZip),
    generated_at: new Date().toISOString()
  };
  fs.writeFileSync(path.join(outputDir, `${config.game_id}-${config.package_version}-provenance.json`), JSON.stringify(provenance, null, 2) + "\n");
  console.log(JSON.stringify({ artifact: finalZip, provenance: path.join(outputDir, `${config.game_id}-${config.package_version}-provenance.json`), sha256: digest, size: fs.statSync(finalZip).size }, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
  fs.rmSync(zipWithoutManifest, { force: true });
}
