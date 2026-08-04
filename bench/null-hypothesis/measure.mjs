// M0 measurement: bundle size (browser, min+gzip) and flush latency for the
// real tailwindcss@4 compiler. Run: node bench/null-hypothesis/measure.mjs
import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

// --- Size: bundle entry.mjs for the browser ---
const result = await build({
  entryPoints: [path.join(here, "entry.mjs")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  write: false,
  loader: { ".css": "text" },
  logLevel: "silent",
});
const bytes = result.outputFiles[0].contents;
const gz = gzipSync(bytes, { level: 9 });
console.log(`bundle (tailwindcss@4 compiler + default theme, browser, esm):`);
console.log(`  minified: ${(bytes.length / 1024).toFixed(1)} KB`);
console.log(`  min+gzip: ${(gz.length / 1024).toFixed(1)} KB`);

// --- Latency: same code path in Node (V8, comparable to browser JIT) ---
// entry.mjs's css import only resolves under esbuild, so re-create the engine here.
const { compile } = await import("tailwindcss");
const { readFileSync } = await import("node:fs");
const theme = readFileSync(
  path.join(here, "../../node_modules/tailwindcss/theme.css"),
  "utf8",
);
const createOracleEngine = async () => {
  const compiled = await compile(theme + "\n@tailwind utilities;", {
    base: "/",
    async loadStylesheet() {
      throw new Error("no imports");
    },
    async loadModule() {
      throw new Error("no modules");
    },
  });
  return { build: (classes) => compiled.build(classes) };
};

// 500 distinct plausible tokens
const roots = ["p", "px", "py", "m", "mx", "gap", "w", "h", "text", "bg"];
const colors = ["red", "blue", "green", "slate", "amber"];
const tokens = [];
for (let i = 0; tokens.length < 500; i++) {
  const r = roots[i % roots.length];
  if (r === "text" || r === "bg") {
    tokens.push(`${r}-${colors[i % colors.length]}-${((i % 9) + 1) * 100}`);
    tokens.push(
      `hover:${r}-${colors[(i + 1) % colors.length]}-500/${(i % 10) * 10}`,
    );
  } else {
    tokens.push(`${r}-${(i % 96) + 1}`);
    tokens.push(`md:${r}-${(i % 96) + 2}`);
  }
}
tokens.length = 500;

const t0 = performance.now();
const engine = await createOracleEngine();
const t1 = performance.now();
engine.build(tokens);
const t2 = performance.now();
// warm incremental: one new token
engine.build(["backdrop-blur-sm"]);
const t3 = performance.now();

console.log(`latency (node ${process.version}):`);
console.log(`  compile() [cold init]:        ${(t1 - t0).toFixed(1)} ms`);
console.log(`  build(500 tokens) [cold]:     ${(t2 - t1).toFixed(1)} ms`);
console.log(`  build(1 new token) [warm]:    ${(t3 - t2).toFixed(2)} ms`);
