import { build } from "esbuild";
import { execFileSync } from "node:child_process";
await build({
  entryPoints: ["ui/dashboard.jsx"],
  bundle: true,
  minify: true,
  format: "esm",
  outfile: "public/dashboard.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
});
execFileSync(
  process.execPath,
  [
    "node_modules/@tailwindcss/cli/dist/index.mjs",
    "-i",
    "ui/styles.css",
    "-o",
    "public/dashboard.css",
    "--minify",
  ],
  { stdio: "inherit" },
);
