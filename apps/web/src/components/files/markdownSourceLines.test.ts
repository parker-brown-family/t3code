import {
  CHAT_MARKDOWN_REHYPE_PLUGINS,
  CHAT_MARKDOWN_REMARK_PLUGINS,
} from "@t3tools/shared/markdownPipeline";
import type { Element, Root } from "hast";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, it } from "vite-plus/test";

import {
  headingAbove,
  parseSourceLines,
  rehypeSourceLineBlocks,
  sourceRangesOverlap,
} from "./markdownSourceLines";

async function render(markdown: string): Promise<Root> {
  const processor = unified()
    .use(remarkParse)
    .use(CHAT_MARKDOWN_REMARK_PLUGINS)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(CHAT_MARKDOWN_REHYPE_PLUGINS)
    .use(rehypeSourceLineBlocks);
  return (await processor.run(processor.parse(markdown))) as Root;
}

function stamped(node: Root | Element, found: Array<[string, string]> = []) {
  for (const child of node.children) {
    if (child.type !== "element") continue;
    const lines = child.properties?.dataSourceLines;
    if (typeof lines === "string") {
      const inner = child.tagName === "div" ? child.children[0] : child;
      found.push([inner?.type === "element" ? inner.tagName : child.tagName, lines]);
    }
    stamped(child, found);
  }
  return found;
}

describe("rehypeSourceLineBlocks", () => {
  it("names the source lines of each block and list item, after sanitizing", async () => {
    const tree = await render(
      "# Title\n\nPara one\nline two\n\n- a\n- b\n\n```js\nx\n```\n\n<div>raw</div>\n",
    );
    expect(stamped(tree)).toEqual([
      ["h1", "1-1"],
      ["p", "3-4"],
      ["ul", "6-7"],
      ["li", "6-6"],
      ["li", "7-7"],
      ["pre", "9-11"],
      ["div", "13-13"],
    ]);
  });

  it("keeps line numbers when front matter is masked to blank space", async () => {
    const tree = await render("   \n       \n   \n\n## After\n");
    expect(stamped(tree)).toEqual([["h2", "5-5"]]);
  });
});

describe("source line helpers", () => {
  it("parses only well-formed ranges", () => {
    expect(parseSourceLines("3-4")).toEqual({ startLine: 3, endLine: 4 });
    expect(parseSourceLines("4-3")).toBeNull();
    expect(parseSourceLines("0-1")).toBeNull();
    expect(parseSourceLines(null)).toBeNull();
  });

  it("finds overlaps", () => {
    expect(sourceRangesOverlap({ startLine: 1, endLine: 3 }, { startLine: 3, endLine: 5 })).toBe(
      true,
    );
    expect(sourceRangesOverlap({ startLine: 1, endLine: 2 }, { startLine: 3, endLine: 5 })).toBe(
      false,
    );
  });

  it("labels a note with the heading above it, ignoring code fences", () => {
    const markdown = "# Plan\n\n```sh\n# not a heading\n```\n\ntext\n\n## Risks ##\n\nmore\n";
    expect(headingAbove(markdown, 7)).toBe("Plan");
    expect(headingAbove(markdown, 11)).toBe("Risks");
    expect(headingAbove("no heading\n", 1)).toBeNull();
  });
});
