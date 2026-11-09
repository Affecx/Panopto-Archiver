import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/compare.ts"],
  outfile: "dist/compare.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const result = spawnSync(process.execPath, ["dist/compare.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
