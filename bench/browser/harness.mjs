// Engine-agnostic measurement harness. A page provides an `engine` adapter:
//   { name: string,
//     ready(): Promise<void>,   // resolves when the engine has styled the initial document
//     }
// and calls run(engine). Scenario + params come from the query string.
// Results are written as JSON into #results and document.title becomes
// "BENCH DONE" so an automated runner can poll for completion.
import { VOCAB, mulberry32, makeEl } from "./vocab.mjs";

const params = new URLSearchParams(location.search);
const scenario = params.get("scenario") ?? "cold";
const docsize = Number(params.get("docsize") ?? 1000);
const seed = Number(params.get("seed") ?? 0xc0ffee);

const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

/** Frames painted before pred() holds, sampled at rAF (rAF runs pre-paint,
 *  so pred() true at frame 0 means the very first paint is styled). */
function framesUntil(pred, maxFrames = 600) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    let n = 0;
    const tick = () => {
      if (pred()) return resolve({ unstyledFrames: n, ms: performance.now() - t0 });
      if (++n > maxFrames) return resolve({ unstyledFrames: Infinity, ms: performance.now() - t0 });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

/** Probe element: an already-known utility class with an unmistakable
 *  computed value. text-center is theme-independent. */
function makeProbe(cls, prop, expected) {
  const el = document.createElement("div");
  el.className = cls;
  el.textContent = "p";
  return { el, styled: () => getComputedStyle(el)[prop] === expected };
}

function fillDocument(n, rand) {
  const frag = document.createDocumentFragment();
  for (let i = 0; i < n; i++) frag.append(makeEl(document, rand));
  document.body.append(frag);
}

/** Sum the Play CDN's own performance.measure entries, if present. */
function engineSelfTimings() {
  const out = {};
  for (const m of performance.getEntriesByType("measure")) {
    const key = m.name.replace(/#\d+ /, "#n ");
    out[key] = +((out[key] ?? 0) + m.duration).toFixed(1);
  }
  return out;
}

// --- scenarios ---------------------------------------------------------

/** Cold start: docsize elements already in the DOM when the engine loads.
 *  Time from harness start (≈ engine script eval) to fully styled paint. */
async function cold(engine) {
  const rand = mulberry32(seed);
  fillDocument(docsize, rand);
  const probe = makeProbe("text-center mt-[13.5px]", "marginTop", "13.5px");
  document.body.append(probe.el);
  const t0 = performance.now();
  await engine.ready();
  const styled = await framesUntil(probe.styled);
  return {
    readyMs: +(performance.now() - t0).toFixed(1),
    firstStyledPaint: styled,
  };
}

/** Streaming: docsize-element page, then append CHUNKS chunks of CHUNK_N
 *  elements, one per frame — a model streaming HTML. Every 5th chunk
 *  introduces a class the page has never seen (arbitrary value), the rest
 *  reuse the vocabulary. Reports per-chunk styling latency and how many
 *  chunks painted unstyled at least once. */
async function stream(engine) {
  const CHUNKS = 60, CHUNK_N = 15;
  const rand = mulberry32(seed);
  fillDocument(docsize, rand);
  await engine.ready();
  await framesUntil(makeProbe("text-center", "textAlign", "center").styled);

  const latencies = [], newClassLatencies = [];
  let unstyledChunks = 0, unstyledFramesTotal = 0;
  for (let c = 0; c < CHUNKS; c++) {
    const frag = document.createDocumentFragment();
    for (let i = 0; i < CHUNK_N; i++) frag.append(makeEl(document, rand));
    const fresh = c % 5 === 0;
    const probe = fresh
      ? makeProbe(`mt-[${c}.5px]`, "marginTop", `${c}.5px`)
      : makeProbe("text-center", "textAlign", "center");
    frag.append(probe.el);
    document.body.append(frag);
    const r = await framesUntil(probe.styled);
    (fresh ? newClassLatencies : latencies).push(r.ms);
    if (r.unstyledFrames > 0) { unstyledChunks++; unstyledFramesTotal += r.unstyledFrames; }
  }
  const med = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
  return {
    chunks: CHUNKS, perChunkEls: CHUNK_N,
    medianStyledMsSeenClasses: +med(latencies).toFixed(2),
    medianStyledMsNewClass: +med(newClassLatencies).toFixed(2),
    chunksPaintedUnstyled: unstyledChunks,
    unstyledFramesTotal,
  };
}

/** Steady-state churn: docsize-element page, vocabulary fully warmed, then
 *  300 frames each toggling 10 class attributes and appending 5 elements —
 *  all classes already seen. Measures wall time and main-thread work for
 *  the same mutation load; compare against the `none` engine baseline. */
async function churn(engine) {
  const FRAMES = 300, TOGGLES = 10, APPENDS = 5;
  const rand = mulberry32(seed);
  fillDocument(docsize, rand);
  await engine.ready();
  await framesUntil(makeProbe("text-center", "textAlign", "center").styled);

  const els = Array.from(document.body.querySelectorAll("div"));
  let longTaskMs = 0;
  const lt = "PerformanceObserver" in window ? new PerformanceObserver((l) => {
    for (const e of l.getEntries()) longTaskMs += e.duration;
  }) : null;
  try { lt?.observe({ entryTypes: ["longtask"] }); } catch {}

  const t0 = performance.now();
  for (let f = 0; f < FRAMES; f++) {
    for (let i = 0; i < TOGGLES; i++) {
      const el = els[Math.floor(rand() * els.length)];
      el.className = makeEl(document, rand).className;
    }
    for (let i = 0; i < APPENDS; i++) document.body.append(makeEl(document, rand));
    await nextFrame();
  }
  await nextFrame();
  const total = performance.now() - t0;
  lt?.disconnect();
  return {
    frames: FRAMES, mutationsPerFrame: TOGGLES + APPENDS,
    totalMs: +total.toFixed(1),
    avgFrameMs: +(total / FRAMES).toFixed(2),
    longTaskMs: +longTaskMs.toFixed(1),
  };
}

const SCENARIOS = { cold, stream, churn };

export async function run(engine) {
  const t0 = performance.now();
  const result = await SCENARIOS[scenario](engine);
  const payload = {
    engine: engine.name, scenario, docsize, seed,
    ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? navigator.userAgent,
    result,
    engineSelfTimings: engineSelfTimings(),
    wallMs: +(performance.now() - t0).toFixed(1),
  };
  const pre = document.createElement("pre");
  pre.id = "results";
  pre.textContent = JSON.stringify(payload, null, 2);
  document.body.prepend(pre);
  document.title = "BENCH DONE";
  console.log("BENCH_RESULT " + JSON.stringify(payload));
  return payload;
}
