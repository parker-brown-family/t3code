import type { PreviewAnnotationPayload } from "@t3tools/contracts";
import type { PageComposeComment } from "@t3tools/shared/htmlRender";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";

import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  useComposerDraftStore,
} from "~/composerDraftStore";
import { capturePreviewAnnotationScreenshot } from "~/lib/previewAnnotation";

import { toastManager } from "../ui/toast";

/**
 * A page's reader notes land in the composer as annotations, one per note, unsent: the
 * element it is on, the reader's remark, and any picture they attached, which also goes to
 * the agent as an image. The reader sees each one and can drop any before sending.
 * Resending the same note replaces it.
 */
export function placePageNotes(
  target: ComposerThreadTarget,
  page: string,
  comments: ReadonlyArray<PageComposeComment>,
): void {
  const store = useComposerDraftStore.getState();
  const name = page.split(/[\\/]/).at(-1) || page;
  const createdAt = new Date().toISOString();
  let hiddenCharacters = 0;
  let pictures = 0;
  let droppedPictures = 0;
  for (const comment of comments) {
    const text = sanitizeLinkedPrompt(comment.text);
    hiddenCharacters += text.hiddenCharacters;
    if (text.text === "") continue;
    const annotation = pageNoteAnnotation(page, name, comment, text.text, createdAt);
    const capture = capturePreviewAnnotationScreenshot(annotation);
    const kept = capture.status === "failed" ? { ...annotation, screenshot: null } : annotation;
    store.addPreviewAnnotation(target, kept);
    if (capture.status === "failed") droppedPictures++;
    if (capture.status !== "captured" || kept.screenshot === null) continue;
    const image: ComposerImageAttachment = {
      type: "image",
      id: kept.id,
      name: capture.file.name,
      mimeType: capture.file.type,
      sizeBytes: capture.file.size,
      previewUrl: kept.screenshot.dataUrl,
      file: capture.file,
    };
    if (store.addImage(target, image)) pictures++;
    else droppedPictures++;
  }
  const noun = comments.length === 1 ? "A note" : `${comments.length} notes`;
  toastManager.add({
    type: hiddenCharacters > 0 || droppedPictures > 0 ? "warning" : "info",
    title: `${noun} from ${name}${pictures > 0 ? `, ${pictures} with pictures` : ""}`,
    description: [
      hiddenCharacters > 0
        ? "Hidden characters were removed because they can carry instructions for the agent."
        : "Added to your message.",
      droppedPictures > 0
        ? `${droppedPictures} picture${droppedPictures === 1 ? "" : "s"} could not be attached; the notes were kept.`
        : "",
      "Read them before you send.",
    ]
      .filter(Boolean)
      .join(" "),
  });
}

function pageNoteAnnotation(
  page: string,
  name: string,
  comment: PageComposeComment,
  text: string,
  createdAt: string,
): PreviewAnnotationPayload {
  const id = `page:${page}#${comment.anchor}:${text.slice(0, 200)}`;
  // The page measured the element when it sent; without that, the box is unknown, not empty.
  const rect = comment.rect ?? null;
  const selector = comment.anchor ? `#${CSS.escape(comment.anchor)}` : null;
  const label = comment.title || comment.anchor || name;
  return {
    id,
    pageUrl: page,
    pageTitle: `${name} · ${label}`,
    comment: text,
    elements: rect
      ? [
          {
            id: comment.anchor || "page",
            rect,
            element: {
              pageUrl: page,
              pageTitle: name,
              tagName: "section",
              selector,
              htmlPreview: [label, comment.quote].filter(Boolean).join(" · "),
              componentName: null,
              source: null,
              stack: [],
              styles: "",
              pickedAt: createdAt,
            },
          },
        ]
      : [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot: comment.image
      ? {
          dataUrl: comment.image.dataUrl,
          width: comment.image.width,
          height: comment.image.height,
          cropRect: { x: 0, y: 0, width: comment.image.width, height: comment.image.height },
        }
      : null,
    createdAt,
  };
}
