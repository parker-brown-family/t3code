import type { ScopedThreadRef } from "@t3tools/contracts";

import ChatMarkdown from "~/components/ChatMarkdown";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { maskMarkdownFrontmatter } from "@t3tools/shared/markdownFrontmatter";

import type { ComposerThreadTarget } from "~/composerDraftStore";

import { MarkdownNotes } from "./MarkdownNotes";
import { rehypeSourceLineBlocks } from "./markdownSourceLines";

// One list for every file, so rendered files share a parse cache.
const SOURCE_LINE_REHYPE_PLUGINS = [rehypeSourceLineBlocks];

export function FileMarkdownPreview(props: {
  readonly cwd: string;
  readonly relativePath: string;
  readonly text: string;
  readonly threadRef: ScopedThreadRef;
  readonly workspaceMutationId: string | null;
  /** Where notes left on the rendered file go; without it the file is read-only to notes. */
  readonly noteTarget?: ComposerThreadTarget | undefined;
  readonly onNotesClose?: (() => void) | undefined;
  readonly onTaskListChange?:
    | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
    | undefined;
}) {
  const lastSeparator = Math.max(
    props.relativePath.lastIndexOf("/"),
    props.relativePath.lastIndexOf("\\"),
  );
  const imageBaseDir =
    lastSeparator >= 0
      ? resolvePathLinkTarget(props.relativePath.slice(0, lastSeparator), props.cwd)
      : props.cwd;

  const markdown = (
    <ChatMarkdown
      text={maskMarkdownFrontmatter(props.text)}
      cwd={props.cwd}
      imageBaseDir={imageBaseDir}
      threadRef={props.threadRef}
      workspaceMutationId={props.workspaceMutationId}
      className={props.noteTarget ? "px-6 py-5" : "mx-auto max-w-4xl px-6 py-5"}
      onTaskListChange={props.onTaskListChange}
      {...(props.noteTarget ? { extraRehypePlugins: SOURCE_LINE_REHYPE_PLUGINS } : {})}
    />
  );
  if (!props.noteTarget) return markdown;
  return (
    <MarkdownNotes
      target={props.noteTarget}
      filePath={props.relativePath}
      contents={props.text}
      onClose={props.onNotesClose}
    >
      {markdown}
    </MarkdownNotes>
  );
}
