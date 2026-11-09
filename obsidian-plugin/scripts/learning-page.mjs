import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: ["scripts/learning-page.ts"],
  outfile: "dist/learning-page.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
});
const result = spawnSync(process.execPath, ["dist/learning-page.mjs"], {
  stdio: "inherit",
  env: process.env,
});
process.exitCode = result.status ?? 1;
