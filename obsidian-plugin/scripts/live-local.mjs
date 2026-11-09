import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/live-local.ts"],
  outfile: "dist/live-local.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const result = spawnSync(process.execPath, ["dist/live-local.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
