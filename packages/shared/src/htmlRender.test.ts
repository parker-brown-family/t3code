import { describe, expect, it } from "vite-plus/test";

import {
  injectHtmlRenderBootstrap,
  readHtmlRenderImageRequest,
  readHtmlRenderLinkRequest,
  readPageComposeRequest,
} from "./htmlRender.ts";
import { htmlRenderFromToolItem } from "./toolOutput.ts";

const reference = { attachmentId: "thread-abc-123.html", title: "Chart", height: 420 };

describe("injectHtmlRenderBootstrap", () => {
  it("puts the theme ahead of the page's own head content", () => {
    const html =
      "<!doctype html><html><head><style>:root{--background:red}</style></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    const themeAt = injected.indexOf('<style id="t3-theme">');
    expect(themeAt).toBeGreaterThan(injected.indexOf("<head>"));
    expect(themeAt).toBeLessThan(injected.indexOf(":root{--background:red}"));
    expect(injected).toContain('<meta charset="utf-8">');
    expect(injected).toContain('name="viewport"');
  });

  it("wraps fragments without a head and keeps existing meta tags", () => {
    const fragment =
      '<meta charset="utf-8"><meta name="viewport" content="width=device-width"><p>hi</p>';
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.match(/charset/g)).toHaveLength(1);
    expect(injected.match(/name="viewport"/g)).toHaveLength(1);
    expect(injected.endsWith("<p>hi</p>")).toBe(true);
  });

  it.each(["textarea", "iframe", "plaintext"])("keeps the bootstrap outside %s content", (tag) => {
    const fragment = `<${tag}><head><meta name="viewport"></head></${tag}>`;
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf(`<${tag}>`));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it.each([
    '<template><head><meta name="viewport"></head></template>',
    '<template><template>inner</template><head><meta name="viewport"></head></template>',
  ])("keeps the bootstrap outside inert template content: %s", (fragment) => {
    const injected = injectHtmlRenderBootstrap(fragment);
    expect(injected.startsWith("<!doctype html><head>")).toBe(true);
    expect(injected.indexOf('<style id="t3-theme">')).toBeLessThan(injected.indexOf("<template>"));
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
    expect(injected.endsWith(fragment)).toBe(true);
  });

  it("ignores tags written inside comments and scripts", () => {
    const html =
      '<!-- copy <head> and <meta name="viewport"> here --><html><head>' +
      "<script>const tag = '<meta name=\"viewport\">';</script></head><body>x</body></html>";
    const injected = injectHtmlRenderBootstrap(html);
    expect(injected.indexOf('<style id="t3-theme">')).toBeGreaterThan(
      injected.indexOf("<html><head>"),
    );
    expect(injected).toContain('<meta name="viewport" content="width=device-width');
  });
});

describe("readPageComposeRequest", () => {
  it("reads bounded reader notes and refuses anything malformed", () => {
    const compose = (comments: unknown, extra = {}) => ({
      jsonrpc: "2.0",
      id: "n1",
      method: "t3/compose",
      params: { comments, ...extra },
    });
    const note = { anchor: " fig-lift ", title: "04 · The lift", quote: "", text: " So cool " };
    expect(readPageComposeRequest(compose([note], { close: true }))).toEqual({
      id: "n1",
      comments: [{ anchor: "fig-lift", title: "04 · The lift", quote: "", text: "So cool" }],
      close: true,
    });
    expect(readPageComposeRequest(compose([note], { close: "yes" }))?.close).toBe(false);
    const png = { dataUrl: "data:image/png;base64,iVBORw0KGgo=", width: 4, height: 3 };
    const rect = { x: 0, y: 10, width: 300, height: 120 };
    expect(readPageComposeRequest(compose([{ ...note, rect, image: png }]))?.comments[0]).toEqual({
      anchor: "fig-lift",
      title: "04 · The lift",
      quote: "",
      text: "So cool",
      rect,
      image: png,
    });
    // A picture that is not a PNG data URL, or has no size, is dropped and the note kept.
    for (const image of [
      { ...png, dataUrl: "https://example.com/a.png" },
      { ...png, width: 0 },
    ]) {
      expect(
        readPageComposeRequest(compose([{ ...note, image }]))?.comments[0]?.image,
      ).toBeUndefined();
    }
    // At most eight pictures per send; the ninth note keeps its text and loses its picture.
    const nine = readPageComposeRequest(
      compose(Array.from({ length: 9 }, () => ({ ...note, image: png }))),
    );
    expect(nine?.comments.filter((comment) => comment.image !== undefined)).toHaveLength(8);
    expect(nine?.comments).toHaveLength(9);
    expect(
      readPageComposeRequest(compose([{ ...note, rect: { x: 0, y: "1", width: 1, height: 1 } }]))
        ?.comments[0]?.rect,
    ).toBeUndefined();
    expect(readPageComposeRequest(compose([]))).toBeUndefined();
    expect(readPageComposeRequest(compose([{ ...note, text: "  " }]))).toBeUndefined();
    expect(readPageComposeRequest(compose([{ ...note, text: "x".repeat(8_001) }]))).toBeUndefined();
    expect(
      readPageComposeRequest(compose(Array.from({ length: 201 }, () => note))),
    ).toBeUndefined();
    expect(readPageComposeRequest(compose([{ anchor: 1, text: "hi" }]))).toBeUndefined();
    expect(
      readPageComposeRequest({
        jsonrpc: "2.0",
        method: "t3/compose",
        params: { comments: [note] },
      }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderLinkRequest", () => {
  it("accepts only http(s) URLs in an MCP Apps ui/open-link request", () => {
    const link = (url: unknown, modifiers = {}) => ({
      jsonrpc: "2.0",
      id: 1,
      method: "ui/open-link",
      params: { url, ...modifiers },
    });
    expect(readHtmlRenderLinkRequest(link("https://example.com/a"))).toEqual({
      id: 1,
      url: "https://example.com/a",
      metaKey: false,
      ctrlKey: false,
    });
    expect(
      readHtmlRenderLinkRequest(link("https://example.com/a", { metaKey: true, ctrlKey: "yes" })),
    ).toEqual({ id: 1, url: "https://example.com/a", metaKey: true, ctrlKey: false });
    expect(readHtmlRenderLinkRequest(link("javascript:alert(1)"))).toBeUndefined();
    expect(readHtmlRenderLinkRequest(link("file:///etc/passwd"))).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({
        jsonrpc: "2.0",
        method: "ui/open-link",
        params: { url: "https://example.com" },
      }),
    ).toBeUndefined();
    expect(
      readHtmlRenderLinkRequest({ type: "t3-html-render-link", url: "https://example.com" }),
    ).toBeUndefined();
  });
});

describe("readHtmlRenderImageRequest", () => {
  it("accepts http(s) and inline image URLs in an open-image notification", () => {
    const image = (params: unknown) => ({
      jsonrpc: "2.0",
      method: "t3/notifications/open-image",
      params,
    });
    expect(
      readHtmlRenderImageRequest(image({ src: "data:image/png;base64,AA", name: " Chart " })),
    ).toEqual({
      src: "data:image/png;base64,AA",
      name: "Chart",
    });
    expect(readHtmlRenderImageRequest(image({ src: "https://example.com/a.png" }))).toEqual({
      src: "https://example.com/a.png",
      name: "Image",
    });
    expect(readHtmlRenderImageRequest(image({ src: "javascript:alert(1)" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "data:text/html,<p>" }))).toBeUndefined();
    expect(readHtmlRenderImageRequest(image({ src: "blob:null/1" }))).toBeUndefined();
  });
});

describe("htmlRenderFromToolItem", () => {
  const result = { htmlRender: reference, message: "Rendered above your reply." };

  it("reads the reference from each provider's result envelope", () => {
    for (const [toolName, output] of [
      ["mcp__t3-code__html_render", [{ type: "text", text: JSON.stringify(result) }]],
      ["t3-code.html_render", { structuredContent: result, content: [] }],
      ["t3-code-thread_1_html_render", JSON.stringify(result)],
      ["html_render", result],
    ] as const) {
      expect(htmlRenderFromToolItem({ toolName, output })).toEqual(reference);
    }
  });
});
