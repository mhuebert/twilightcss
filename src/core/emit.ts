// Rule tree → CSS text, formatted like the oracle's output (2-space indent)
// so conformance diffs read side-by-side even before normalization.

export interface Decl {
  prop: string;
  value: string;
}
export type Node = Decl | StyleRule | AtRule;
export interface StyleRule {
  selector: string;
  nodes: Node[];
}
export interface AtRule {
  at: string; // e.g. "@media (hover: hover)"
  nodes: Node[];
}

export function isDecl(n: Node): n is Decl {
  return (n as Decl).prop !== undefined;
}

function emitNode(n: Node, indent: string, important: boolean): string {
  if (isDecl(n)) {
    return `${indent}${n.prop}: ${n.value}${important ? " !important" : ""};\n`;
  }
  const head = "at" in n ? n.at : n.selector;
  let out = `${indent}${head} {\n`;
  for (const child of n.nodes) out += emitNode(child, indent + "  ", important);
  out += `${indent}}\n`;
  return out;
}

export function emit(nodes: Node[], { important = false } = {}): string {
  let out = "";
  for (const n of nodes) out += emitNode(n, "", important);
  return out;
}

/** Escape a candidate token into its CSS class-selector form (v4 style). */
export function escapeClassName(name: string): string {
  let out = "";
  for (let i = 0; i < name.length; i++) {
    const ch = name[i]!;
    const code = ch.charCodeAt(0);
    if (i === 0 && ch >= "0" && ch <= "9") {
      out += `\\3${ch} `;
    } else if (i === 1 && name[0] === "-" && ch >= "0" && ch <= "9") {
      out += `\\3${ch} `;
    } else if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9") ||
      ch === "-" ||
      ch === "_" ||
      code > 0x7f
    ) {
      out += ch;
    } else {
      out += "\\" + ch;
    }
  }
  return out;
}
