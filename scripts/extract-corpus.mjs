// Tier-1 corpus extraction — MONOREPO TOOL: scans the colight sources this
// package was extracted from (github.com/colight-dev/colight); in this
// standalone repo the checked-in corpus (conformance/corpus/colight.txt) is
// the artifact and this script documents its provenance.
// Original header:
// Tier-1 corpus extraction: every class token colight actually passes to tw().
// Scans string/template literals inside tw(...) call parens (handles ternaries,
// multi-line calls, nested parens). Tokens touching a `${}` boundary without
// whitespace are partial and dropped. Run: node scripts/extract-corpus.mjs
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const SCAN_ROOTS = [
  path.join(repoRoot, "packages/colight/src/js"),
  path.join(repoRoot, "docs"),
];
const EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".py", ".md"]);

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else if (EXTS.has(path.extname(name))) yield p;
  }
}

// Collect the contents of every string/template literal inside tw( ... ).
// Template literal chunks are split on ${...}; chunk-edge tokens that abut an
// interpolation are marked partial via a sentinel and dropped at tokenization.
const PARTIAL = "\x7f";

function extractFromSource(src, out) {
  for (let i = 0; (i = src.indexOf("tw(", i)) !== -1; i += 3) {
    // require a non-identifier char before `tw(` so e.g. `btw(` doesn't match
    if (i > 0 && /[\w$.]/.test(src[i - 1])) continue;
    let depth = 0;
    let j = i + 2;
    scan: for (; j < src.length; j++) {
      const ch = src[j];
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) break scan;
      } else if (ch === '"' || ch === "'") {
        const start = ++j;
        while (j < src.length && src[j] !== ch) {
          if (src[j] === "\\") j++;
          j++;
        }
        out.push(src.slice(start, j));
      } else if (ch === "`") {
        let chunk = "";
        j++;
        while (j < src.length && src[j] !== "`") {
          if (src[j] === "\\") {
            chunk += src[j + 1];
            j += 2;
          } else if (src[j] === "$" && src[j + 1] === "{") {
            let d = 1;
            j += 2;
            while (j < src.length && d > 0) {
              if (src[j] === "{") d++;
              else if (src[j] === "}") d--;
              j++;
            }
            chunk += ` ${PARTIAL}${PARTIAL} `; // placeholder poisons adjacent tokens
          } else {
            chunk += src[j];
            j++;
          }
        }
        out.push(chunk);
      } else if (ch === "/" && src[j + 1] === "/") {
        j = src.indexOf("\n", j);
        if (j === -1) break scan;
      } else if (ch === "/" && src[j + 1] === "*") {
        j = src.indexOf("*/", j + 2) + 1;
        if (j === 0) break scan;
      }
    }
  }
}

const literals = [];
let fileCount = 0;
for (const root of SCAN_ROOTS) {
  for (const file of walk(root)) {
    const src = readFileSync(file, "utf8");
    if (!src.includes("tw(")) continue;
    fileCount++;
    extractFromSource(src, literals);
  }
}

const tokens = new Set();
for (const lit of literals) {
  for (const raw of lit.split(/\s+/)) {
    if (!raw || raw.includes(PARTIAL) || raw.includes("${")) continue;
    tokens.add(raw);
  }
}

const sorted = [...tokens].sort();
const dest = path.join(here, "../conformance/corpus/colight.txt");
writeFileSync(
  dest,
  `# Tier-1 corpus: tokens extracted from tw() call sites in colight.\n` +
    `# Regenerate: node scripts/extract-corpus.mjs\n` +
    sorted.join("\n") +
    "\n",
);
console.log(
  `extracted ${sorted.length} unique tokens from ${fileCount} files → ${path.relative(process.cwd(), dest)}`,
);
