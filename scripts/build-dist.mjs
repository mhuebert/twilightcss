// Build the publishable dist/: unminified ESM bundles per entry point, with
// the CSS asset modules left external (rewritten to ../assets/*) so the
// package ships one copy shared by dist/ and the ./assets/* export.
// Type declarations are hand-written in types/ and copied in — the public
// surface is ~10 symbols and tsc cannot emit through our .ts-extension
// imports without leaking them into the declarations.
// Run: pnpm -C packages/twilight build
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkg = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const assetExternals = {
  name: "asset-externals",
  setup(b) {
    b.onResolve({ filter: /assets\/(theme|preflight)\.mjs$/ }, (args) => ({
      path: `../assets/${path.basename(args.path)}`,
      external: true,
    }));
  },
};

for (const [entry, outfile] of [
  ["src/index.ts", "dist/index.js"],
  ["src/core/index.ts", "dist/core.js"],
]) {
  await build({
    entryPoints: [path.join(pkg, entry)],
    outfile: path.join(pkg, outfile),
    bundle: true,
    format: "esm",
    platform: "browser",
    plugins: [assetExternals],
    logLevel: "info",
  });
}

// The drop-in script-tag build: classic script (no module required), minified,
// assets inlined — a single self-contained file for CDN URLs.
await build({
  entryPoints: [path.join(pkg, "src/browser.ts")],
  outfile: path.join(pkg, "dist/browser.js"),
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  logLevel: "info",
});

mkdirSync(path.join(pkg, "dist"), { recursive: true });
for (const f of ["index.d.ts", "core.d.ts", "browser.d.ts"]) {
  copyFileSync(path.join(pkg, "types", f), path.join(pkg, "dist", f));
}
console.log("dist/ ready");
