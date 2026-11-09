import { build } from "esbuild";
await build({
  entryPoints: ["src/main.ts"],
  outfile: "dist/main.js",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  external: ["obsidian", "electron"],
  logLevel: "info",
});
import { copyFile } from "node:fs/promises";
for (const file of ["manifest.json", "styles.css"])
  await copyFile(file, `dist/${file}`);
