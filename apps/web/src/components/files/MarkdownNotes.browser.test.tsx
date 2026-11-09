import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import "~/index.css";
import { useComposerDraftStore } from "~/composerDraftStore";

import { act, render } from "../../../test/render";

import { FileMarkdownPreview } from "./FileMarkdownPreview";

const threadRef = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("notes-thread"));
const markdown = "# Plan\n\nFirst paragraph.\n\n- one\n- two\n";

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = Array.from(container.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label,
  );
  if (!found) throw new Error(`Missing button: ${label}`);
  return found;
}

function textarea(container: HTMLElement): HTMLTextAreaElement {
  const found = container.querySelector("textarea");
  if (!found) throw new Error("The note box is not open");
  return found;
}

async function type(container: HTMLElement, text: string) {
  await act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea(container),
      text,
    );
    textarea(container).dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function pointAt(container: HTMLElement, lines: string) {
  const block = container.querySelector(`[data-source-lines="${lines}"]`);
  if (!block) throw new Error(`No block for lines ${lines}`);
  const inner = block.tagName === "LI" ? block : (block.firstElementChild ?? block);
  await act(() => inner.dispatchEvent(new PointerEvent("pointermove", { bubbles: true })));
  return block;
}

async function picture(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  canvas.getContext("2d")!.fillRect(0, 0, 4, 4);
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), "image/png"));
  return new File([blob], "shot.png", { type: "image/png" });
}

it("puts a note on a rendered markdown block into the message, pictures included", async () => {
  useComposerDraftStore.setState(useComposerDraftStore.getInitialState(), true);
  const onNotesClose = vi.fn();
  const container = document.createElement("div");
  await using _screen = await render(
    <FileMarkdownPreview
      cwd="/repo"
      relativePath="docs/plan.md"
      text={markdown}
      threadRef={threadRef}
      workspaceMutationId={null}
      noteTarget={threadRef}
      onNotesClose={onNotesClose}
    />,
    { container },
  );
  const draft = () => useComposerDraftStore.getState().getComposerDraft(threadRef);

  const paragraph = await pointAt(container, "3-3");
  await act(() => button(container, "Leave a note on lines L3").click());
  await type(container, "Too vague");
  await act(() => button(container, "Add note").click());

  expect(draft()?.reviewComments).toEqual([
    expect.objectContaining({
      filePath: "docs/plan.md",
      rangeLabel: "L3",
      diff: "First paragraph.",
      sectionTitle: 'Note on the rendered file, under "Plan"',
      text: "Too vague",
    }),
  ]);
  // The box stays open for the next note, and the block shows it has one.
  expect(textarea(container).value).toBe("");
  expect(paragraph.hasAttribute("data-has-note")).toBe(true);

  const clipboardData = new DataTransfer();
  clipboardData.items.add(await picture());
  await act(() =>
    textarea(container).dispatchEvent(
      new ClipboardEvent("paste", { clipboardData, bubbles: true, cancelable: true }),
    ),
  );
  await vi.waitFor(() => expect(container.querySelector('img[alt="Picture 1"]')).not.toBeNull());
  await type(container, "Like this");
  await act(() => button(container, "Add note").click());

  const withPicture = draft()?.reviewComments.find((comment) => comment.text.startsWith("Like"));
  expect(withPicture?.text).toBe("Like this\n(pictures attached: note-L3-1.png)");
  expect(draft()?.images.map((image) => [image.id, image.name])).toEqual([
    [`${withPicture?.id}#picture-1`, "note-L3-1.png"],
  ]);

  // A list item takes its own note, on its own line, and only that item is marked.
  const item = await pointAt(container, "6-6");
  await act(() => button(container, "Leave a note on lines L6").click());
  await type(container, "Drop this one");
  await act(() => button(container, "Add note").click());
  expect(item.hasAttribute("data-has-note")).toBe(true);
  expect(container.querySelector('[data-source-lines="5-6"]')?.hasAttribute("data-has-note")).toBe(
    false,
  );
  expect(container.querySelector('[data-source-lines="5-5"]')?.hasAttribute("data-has-note")).toBe(
    false,
  );

  // Removing a note from the message takes its pictures with it.
  await act(() => useComposerDraftStore.getState().removeReviewComment(threadRef, withPicture!.id));
  expect(draft()?.images).toEqual([]);

  expect(container.textContent).toContain("2 notes on this file are in your message.");
  await act(() => button(container, "↪ Send to agent").click());
  expect(onNotesClose).toHaveBeenCalledOnce();
});
