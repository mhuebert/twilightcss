// A realistic class vocabulary — the kind of Tailwind an LLM (or a human)
// actually writes: layout, spacing, type, color, borders, a few variants.
// Both engines compile the identical workload built from this list.
export const VOCAB = [
  "flex", "inline-flex", "grid", "block", "inline-block", "hidden",
  "flex-col", "flex-row", "flex-wrap", "flex-1", "shrink-0", "grow",
  "items-center", "items-start", "items-baseline", "justify-between",
  "justify-center", "justify-end", "self-start", "self-stretch",
  "grid-cols-2", "grid-cols-3", "grid-cols-12", "col-span-2", "gap-1",
  "gap-2", "gap-3", "gap-4", "gap-6", "gap-8", "gap-x-2", "gap-y-1",
  "p-1", "p-2", "p-3", "p-4", "p-6", "p-8", "px-2", "px-3", "px-4",
  "px-6", "py-1", "py-2", "py-3", "pt-2", "pb-4", "pl-3", "pr-3",
  "m-0", "m-1", "m-2", "m-4", "mx-auto", "my-2", "mt-1", "mt-2",
  "mt-4", "mt-8", "mb-2", "mb-4", "ml-2", "mr-2", "-mt-1", "-mx-2",
  "w-full", "w-1/2", "w-4", "w-6", "w-8", "w-64", "max-w-md",
  "max-w-2xl", "min-w-0", "h-full", "h-4", "h-8", "h-screen",
  "min-h-screen", "size-4", "size-6",
  "text-xs", "text-sm", "text-base", "text-lg", "text-xl", "text-2xl",
  "font-medium", "font-semibold", "font-bold", "font-mono", "italic",
  "leading-tight", "leading-relaxed", "tracking-tight", "tracking-wide",
  "text-left", "text-center", "text-right", "truncate", "uppercase",
  "whitespace-nowrap", "break-words", "underline", "line-through",
  "text-white", "text-black", "text-gray-400", "text-gray-500",
  "text-gray-600", "text-gray-700", "text-gray-900", "text-red-500",
  "text-red-600", "text-blue-500", "text-blue-600", "text-green-600",
  "text-amber-600", "text-indigo-600", "text-gray-500/80",
  "bg-white", "bg-black", "bg-transparent", "bg-gray-50", "bg-gray-100",
  "bg-gray-200", "bg-gray-800", "bg-gray-900", "bg-red-50", "bg-red-500",
  "bg-blue-50", "bg-blue-500", "bg-blue-600", "bg-green-100",
  "bg-amber-100", "bg-indigo-500", "bg-black/50", "bg-white/90",
  "border", "border-0", "border-2", "border-t", "border-b",
  "border-gray-200", "border-gray-300", "border-red-300",
  "border-blue-500", "border-transparent", "divide-y",
  "rounded-sm", "rounded-md", "rounded-lg", "rounded-xl", "rounded-full",
  "rounded-t-md", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg",
  "ring-1", "ring-2", "ring-blue-500", "ring-gray-200",
  "opacity-50", "opacity-75", "overflow-hidden", "overflow-auto",
  "overflow-y-auto", "relative", "absolute", "fixed", "sticky",
  "inset-0", "top-0", "left-0", "right-2", "z-10", "z-50",
  "cursor-pointer", "select-none", "pointer-events-none",
  "transition", "transition-colors", "duration-150", "duration-300",
  "hover:bg-gray-100", "hover:bg-gray-50", "hover:bg-blue-700",
  "hover:text-gray-900", "hover:underline", "hover:shadow-md",
  "focus:outline-hidden", "focus-visible:ring-2", "active:bg-gray-200",
  "disabled:opacity-50", "group", "group-hover:visible",
  "sm:px-6", "sm:grid-cols-2", "md:flex", "md:w-1/2", "md:text-lg",
  "md:grid-cols-3", "lg:px-8", "lg:grid-cols-4", "dark:bg-gray-900",
  "dark:text-gray-100",
];

// Deterministic PRNG so both engines see the byte-identical workload.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** div with 3–6 vocab classes, deterministic per (rand). */
export function makeEl(doc, rand) {
  const el = doc.createElement("div");
  const n = 3 + Math.floor(rand() * 4);
  const cls = [];
  for (let i = 0; i < n; i++) cls.push(VOCAB[Math.floor(rand() * VOCAB.length)]);
  el.className = cls.join(" ");
  el.textContent = "x";
  return el;
}
