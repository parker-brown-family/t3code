import { PROVIDER_SEND_TURN_MAX_IMAGE_BYTES } from "@t3tools/contracts";
import { ImagePlus, MessageSquarePlus, X } from "lucide-react";
import {
  type ClipboardEvent as ReactClipboardEvent,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  type ComposerImageAttachment,
  type ComposerThreadTarget,
  REVIEW_COMMENT_PICTURE_SEPARATOR,
  useComposerDraftStore,
  useComposerThreadDraft,
} from "~/composerDraftStore";
import { DiffCommentAnnotation } from "~/components/diffs/DiffCommentAnnotation";
import { Button } from "~/components/ui/button";
import { toastManager } from "~/components/ui/toast";
import { prepareImageForAttachment } from "~/lib/imageCompression";
import { dispatchSnapShotComposerFocus } from "~/lib/desktopSnapShot";
import { observeResize } from "~/lib/observeResize";
import { buildFileReviewComment, type ReviewCommentContext } from "~/reviewCommentContext";

import {
  SOURCE_LINES_ATTRIBUTE,
  type SourceLineRange,
  headingAbove,
  parseSourceLines,
  sourceRangesOverlap,
} from "./markdownSourceLines";

const HAS_NOTE_ATTRIBUTE = "data-has-note";
const OPEN_NOTE_ATTRIBUTE = "data-note-open";
const MAX_NOTE_PICTURES = 8;
let noteSequence = 0;

interface NotePicture {
  readonly file: File;
  readonly url: string;
}

interface OpenNote {
  readonly range: SourceLineRange;
  readonly top: number;
}

/**
 * Notes on a rendered markdown file: each names the file and the block's source lines and
 * goes straight into the message as a file comment, pictures attached. The bar on top counts
 * them and, in one click, closes the file and focuses the message box.
 */
export function MarkdownNotes(props: {
  readonly target: ComposerThreadTarget;
  readonly filePath: string;
  readonly contents: string;
  readonly onClose: (() => void) | undefined;
  readonly children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const draft = useComposerThreadDraft(props.target);
  const sectionId = `file:${props.filePath}`;
  const notes = draft.reviewComments.filter((comment) => comment.sectionId === sectionId);
  const [hovered, setHovered] = useState<OpenNote | null>(null);
  const [open, setOpen] = useState<OpenNote | null>(null);
  const [text, setText] = useState("");
  const [pictures, setPictures] = useState<ReadonlyArray<NotePicture>>([]);
  const pictureInputRef = useRef<HTMLInputElement>(null);

  const blockAt = (element: Element | null): HTMLElement | null => {
    const root = rootRef.current;
    const block = element?.closest<HTMLElement>(`[${SOURCE_LINES_ATTRIBUTE}]`) ?? null;
    return block && root?.contains(block) ? block : null;
  };
  const measure = (block: HTMLElement, edge: "top" | "bottom"): number => {
    const root = rootRef.current;
    if (!root) return 0;
    return block.getBoundingClientRect()[edge] - root.getBoundingClientRect().top;
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest("[data-markdown-note-ui]")) return;
    const block = blockAt(event.target as Element);
    const range = parseSourceLines(block?.getAttribute(SOURCE_LINES_ATTRIBUTE));
    if (!block || !range) return;
    if (hovered?.range.startLine === range.startLine && hovered.range.endLine === range.endLine)
      return;
    setHovered({ range, top: measure(block, "top") });
  };

  // Marks the blocks that already have a note, and keeps the open box under its block as the
  // file re-renders or the panel changes width.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks rendered markdown DOM and measures the open block after layout
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const ranges = notes.map((note) => ({
      startLine: note.startIndex + 1,
      endLine: note.endIndex + 1,
    }));
    const overlapsNote = (block: Element) => {
      const range = parseSourceLines(block.getAttribute(SOURCE_LINES_ATTRIBUTE));
      return range !== null && ranges.some((other) => sourceRangesOverlap(range, other));
    };
    const blockFor = (range: SourceLineRange) =>
      root.querySelector<HTMLElement>(
        `[${SOURCE_LINES_ATTRIBUTE}="${range.startLine}-${range.endLine}"]`,
      );
    const sync = () => {
      for (const block of root.querySelectorAll<HTMLElement>(`[${SOURCE_LINES_ATTRIBUTE}]`)) {
        // A list is marked only through the item the note is on.
        const inner = Array.from(block.querySelectorAll(`[${SOURCE_LINES_ATTRIBUTE}]`));
        block.toggleAttribute(HAS_NOTE_ATTRIBUTE, overlapsNote(block) && !inner.some(overlapsNote));
        block.toggleAttribute(OPEN_NOTE_ATTRIBUTE, open !== null && blockFor(open.range) === block);
      }
      const openBlock = open ? blockFor(open.range) : null;
      if (open && openBlock) {
        const top = measure(openBlock, "bottom");
        if (Math.abs(top - open.top) > 0.5) setOpen({ ...open, top });
      }
      const hoveredBlock = hovered ? blockFor(hovered.range) : null;
      if (hovered && hoveredBlock) {
        const top = measure(hoveredBlock, "top");
        if (Math.abs(top - hovered.top) > 0.5) setHovered({ ...hovered, top });
      }
    };
    sync();
    return observeResize(root, sync);
  });

  const clearPictures = () => {
    for (const picture of pictures) URL.revokeObjectURL(picture.url);
    setPictures([]);
  };
  const closeBox = () => {
    clearPictures();
    setText("");
    setOpen(null);
  };
  const openBox = (range: SourceLineRange) => {
    const root = rootRef.current;
    const block = root?.querySelector<HTMLElement>(
      `[${SOURCE_LINES_ATTRIBUTE}="${range.startLine}-${range.endLine}"]`,
    );
    if (!block) return;
    if (open && (open.range.startLine !== range.startLine || open.range.endLine !== range.endLine))
      closeBox();
    setOpen({ range, top: measure(block, "bottom") });
  };

  const addPictures = async (files: ReadonlyArray<File>) => {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const room = MAX_NOTE_PICTURES - pictures.length;
    const added: NotePicture[] = [];
    let refused = images.length > room ? images.length - Math.max(room, 0) : 0;
    for (const file of images.slice(0, Math.max(room, 0))) {
      const prepared = await prepareImageForAttachment(
        file,
        PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
      ).catch(() => ({ ok: false }) as const);
      if (!prepared.ok) {
        refused++;
        continue;
      }
      added.push({ file: prepared.file, url: URL.createObjectURL(prepared.file) });
    }
    if (added.length > 0) setPictures((current) => [...current, ...added]);
    if (refused > 0) {
      toastManager.add({
        type: "warning",
        title: `${refused} picture${refused === 1 ? "" : "s"} not added`,
        description: `A note takes up to ${MAX_NOTE_PICTURES} pictures, each small enough to send.`,
      });
    }
  };
  const onPaste = (event: ReactClipboardEvent<HTMLDivElement>) => {
    const files = Array.from(event.clipboardData.files);
    if (!files.some((file) => file.type.startsWith("image/"))) return;
    event.preventDefault();
    void addPictures(files);
  };
  const onDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (files.length === 0) return;
    event.preventDefault();
    void addPictures(files);
  };

  const submit = (remark: string) => {
    if (!open || remark.trim() === "") return;
    const store = useComposerDraftStore.getState();
    const { startLine, endLine } = open.range;
    noteSequence += 1;
    const id = `markdown-note-${Date.now()}-${noteSequence}`;
    const names = pictures.map(
      (picture, index) =>
        `note-L${startLine}-${index + 1}.${picture.file.type.split("/")[1] ?? "png"}`,
    );
    const heading = headingAbove(props.contents, startLine);
    const comment: ReviewCommentContext = {
      ...buildFileReviewComment({
        id,
        filePath: props.filePath,
        startLine,
        endLine,
        text:
          names.length > 0 ? `${remark.trim()}\n(pictures attached: ${names.join(", ")})` : remark,
        contents: props.contents,
      }),
      sectionTitle: heading
        ? `Note on the rendered file, under "${heading}"`
        : "Note on the rendered file",
    };
    store.addReviewComment(props.target, comment, { insertAtCaret: false });
    let dropped = 0;
    pictures.forEach((picture, index) => {
      const image: ComposerImageAttachment = {
        type: "image",
        id: `${id}${REVIEW_COMMENT_PICTURE_SEPARATOR}${index + 1}`,
        name: names[index] ?? picture.file.name,
        mimeType: picture.file.type,
        sizeBytes: picture.file.size,
        previewUrl: picture.url,
        file: picture.file,
      };
      if (!store.addImage(props.target, image)) dropped++;
    });
    if (dropped > 0) {
      toastManager.add({
        type: "warning",
        title: `${dropped} picture${dropped === 1 ? "" : "s"} could not be attached`,
        description: "The message is at its attachment limit. The note was kept.",
      });
    }
    // The pictures now belong to the message; the box stays open for the next note.
    setPictures([]);
    setText("");
  };

  const openNotes = open
    ? notes.filter((note) =>
        sourceRangesOverlap(open.range, {
          startLine: note.startIndex + 1,
          endLine: note.endIndex + 1,
        }),
      )
    : [];
  const rangeLabel = (range: SourceLineRange) =>
    range.startLine === range.endLine
      ? `L${range.startLine}`
      : `L${range.startLine} to L${range.endLine}`;

  return (
    <div
      ref={rootRef}
      className="markdown-notes relative mx-auto max-w-4xl"
      onPointerMove={onPointerMove}
      onPointerLeave={() => setHovered(null)}
    >
      <div
        data-markdown-note-ui
        className="sticky top-0 z-20 flex items-center gap-2 border-b border-border/60 bg-background/90 px-6 py-1.5 text-xs text-muted-foreground backdrop-blur"
      >
        <span className="mr-auto min-w-0 truncate">
          {notes.length === 0
            ? "Point at a paragraph and press the note button to leave the agent a note."
            : `${notes.length} note${notes.length === 1 ? "" : "s"} on this file ${notes.length === 1 ? "is" : "are"} in your message.`}
        </span>
        {notes.length > 0 && props.onClose ? (
          <Button
            size="xs"
            onClick={() => {
              props.onClose?.();
              dispatchSnapShotComposerFocus();
            }}
          >
            ↪ Send to agent
          </Button>
        ) : null}
      </div>
      {props.children}
      {hovered ? (
        <button
          type="button"
          data-markdown-note-ui
          aria-label={`Leave a note on lines ${rangeLabel(hovered.range)}`}
          className="absolute left-1 z-10 flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          style={{ top: hovered.top + 2 }}
          onClick={() => openBox(hovered.range)}
        >
          <MessageSquarePlus className="size-3.5" aria-hidden />
        </button>
      ) : null}
      {open ? (
        <div
          data-markdown-note-ui
          className="absolute inset-x-4 z-30 overflow-hidden rounded-md border border-border bg-popover shadow-lg"
          style={{ top: open.top + 4 }}
          onPaste={onPaste}
          onDragOver={(event) => event.preventDefault()}
          onDrop={onDrop}
        >
          <div className="flex items-center gap-2 border-b border-border/60 px-3 py-1.5 text-3xs text-muted-foreground">
            <span className="mr-auto truncate">
              {props.filePath} {rangeLabel(open.range)}
            </span>
            <span>Paste or drop a picture</span>
            <button
              type="button"
              aria-label="Close note"
              className="rounded p-0.5 hover:bg-accent"
              onClick={closeBox}
            >
              <X className="size-3" aria-hidden />
            </button>
          </div>
          {openNotes.map((note) => (
            <DiffCommentAnnotation
              key={note.id}
              kind="comment"
              rangeLabel={note.rangeLabel}
              text={note.text}
              onCancel={() => {}}
              onComment={() => {}}
              onDelete={() =>
                useComposerDraftStore.getState().removeReviewComment(props.target, note.id)
              }
            />
          ))}
          {pictures.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-2">
              {pictures.map((picture, index) => (
                <span key={picture.url} className="relative">
                  <img
                    src={picture.url}
                    alt={`Picture ${index + 1}`}
                    className="h-14 max-w-24 rounded border border-border object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove picture ${index + 1}`}
                    className="absolute -top-1 -right-1 rounded-full bg-background p-0.5 shadow"
                    onClick={() => {
                      URL.revokeObjectURL(picture.url);
                      setPictures((current) => current.filter((other) => other !== picture));
                    }}
                  >
                    <X className="size-2.5" aria-hidden />
                  </button>
                </span>
              ))}
            </div>
          ) : null}
          <DiffCommentAnnotation
            kind="draft"
            rangeLabel={rangeLabel(open.range)}
            text={text}
            onTextChange={setText}
            onCancel={closeBox}
            onComment={submit}
            placeholder="A note for the agent…"
            submitLabel="Add note"
            secondaryAction={{
              label: "Add picture",
              icon: <ImagePlus className="size-3" aria-hidden />,
              allowEmpty: true,
              onAction: () => pictureInputRef.current?.click(),
            }}
          />
          <input
            ref={pictureInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              void addPictures(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
