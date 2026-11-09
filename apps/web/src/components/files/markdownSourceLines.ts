import type { Element, ElementContent, Root, RootContent } from "hast";

/** Source lines a rendered block came from, as `start-end` (1-based, inclusive). */
export const SOURCE_LINES_ATTRIBUTE = "data-source-lines";

export interface SourceLineRange {
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Wraps each top-level block in a `div` naming its source lines, and stamps list items, so a
 * note on the rendered file can name lines. Runs after sanitizing, which strips the attribute;
 * a wrapper because code blocks and tables drop unknown attributes. No position, no stamp.
 */
export function rehypeSourceLineBlocks() {
  return (tree: Root) => {
    tree.children = tree.children.map((child): RootContent => {
      if (child.type !== "element") return child;
      stampListItems(child);
      const range = positionRange(child);
      if (!range) return child;
      return {
        type: "element",
        tagName: "div",
        properties: { dataSourceLines: formatSourceLines(range) },
        children: [child],
        ...(child.position ? { position: child.position } : {}),
      };
    });
  };
}

function stampListItems(node: Element): void {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    if (child.tagName === "li") {
      const range = positionRange(child);
      if (range)
        child.properties = { ...child.properties, dataSourceLines: formatSourceLines(range) };
    }
    stampListItems(child);
  }
}

function positionRange(node: Element | ElementContent): SourceLineRange | null {
  const start = node.position?.start.line;
  const end = node.position?.end.line;
  if (typeof start !== "number" || typeof end !== "number" || start < 1) return null;
  return { startLine: start, endLine: Math.max(start, end) };
}

function formatSourceLines(range: SourceLineRange): string {
  return `${range.startLine}-${range.endLine}`;
}

export function parseSourceLines(value: string | null | undefined): SourceLineRange | null {
  const match = /^(\d+)-(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  if (startLine < 1 || endLine < startLine) return null;
  return { startLine, endLine };
}

export function sourceRangesOverlap(a: SourceLineRange, b: SourceLineRange): boolean {
  return a.startLine <= b.endLine && b.startLine <= a.endLine;
}

/** The text of the nearest heading at or above `line`, for labelling a note. */
export function headingAbove(markdown: string, line: number): string | null {
  const lines = markdown.split("\n");
  let fence: string | null = null;
  let heading: string | null = null;
  for (let index = 0; index < Math.min(line, lines.length); index++) {
    const text = lines[index] ?? "";
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(text);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const headingMatch = /^ {0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(text);
    if (headingMatch?.[1]) heading = headingMatch[1];
  }
  return heading;
}
