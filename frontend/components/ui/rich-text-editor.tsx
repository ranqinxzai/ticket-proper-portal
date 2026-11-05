"use client";

/**
 * Shared Tiptap rich-text editor with a formatting toolbar.
 *
 * Used by every `richtext` field surface (ticket create form, the detail-view
 * Description editor, and inline custom rich-text fields). Emits sanitisable
 * HTML — the server still runs every body through `sanitize_html` (bleach) on
 * save, so the toolbar can only produce markup inside that allowlist.
 *
 * All sub-components are module-top-level (never defined inside another
 * component's body) so the editor never loses focus on a parent re-render —
 * see the "React Component Stability" rule in docs/QA_CHECKLIST.md.
 */

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapImage from "@tiptap/extension-image";
import Mention from "@tiptap/extension-mention";
import type { SuggestionKeyDownProps, SuggestionProps } from "@tiptap/suggestion";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  Code,
  Link as LinkIcon,
  Image as ImageIcon,
  Undo2,
  Redo2,
  RemoveFormatting,
} from "lucide-react";

import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/utils";
import { MENTION_CHIP_CLS } from "./mention-styles";

/** Upload `files` (already filtered to images) and insert each at the cursor.
 *  `upload` returns the stored URL (absolute — base64 is stripped server-side),
 *  or null on failure (the caller surfaces the error). */
async function uploadAndInsertImages(
  editor: Editor,
  files: File[],
  upload: (file: File) => Promise<string | null>,
  setBusy: (b: boolean) => void,
) {
  setBusy(true);
  try {
    for (const file of files) {
      const url = await upload(file);
      if (url) editor.chain().focus().setImage({ src: url }).run();
    }
  } finally {
    setBusy(false);
  }
}

const imagesOf = (list: FileList | null | undefined): File[] =>
  Array.from(list ?? []).filter((f) => f.type.startsWith("image/"));

/** One @mention candidate offered by the `mentions` search (e.g. an agent). */
export type MentionItem = { id: string; label: string; detail?: string };

/** Mention chip styling now lives in `./mention-styles` (no editor bundle for
 *  read-only surfaces); re-exported here for existing imports. */
export { MENTION_CHIP_CLS } from "./mention-styles";

/** Open @-suggestion popup state (null ⇒ closed). */
type SuggestState = {
  items: MentionItem[];
  index: number;
  query: string;
  rect: DOMRect | null;
  command: (item: MentionItem) => void;
};

/** The editor's true value: empty document → "" (so required validation works
 *  and we never persist a bare `<p></p>`). */
function editorHtml(editor: Editor | null): string {
  if (!editor || editor.isEmpty) return "";
  return editor.getHTML();
}

export interface RichTextEditorProps {
  /** Initial / external HTML value. */
  value: string;
  /** Fired on every change (debounce-free; callers hold the draft in state). */
  onChange?: (html: string) => void;
  /** Fired when the editor loses focus (commit-on-blur callers, e.g. inline edit). */
  onBlur?: (html: string) => void;
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  /** Minimum editor body height in px (default 140). */
  minHeight?: number;
  /** Focus the editor body as soon as it mounts (e.g. click-to-edit surfaces). */
  autoFocus?: boolean;
  /** Enables inline images: a toolbar button + paste/drop upload the file and
   *  embed its returned URL. Omit to keep the editor image-free (description /
   *  custom fields). Must return an absolute URL (base64 is stripped on save). */
  onImageUpload?: (file: File) => Promise<string | null>;
  /** Opt-in @mentions: typing "@" lists the matches this returns (e.g. the ticket
   *  helpdesk's agents) and inserts `<span data-type="mention" data-id data-label>`.
   *  Read once at mount (the extension list is fixed); the latest function is used. */
  mentions?: (query: string) => Promise<MentionItem[]>;
}

/** Imperative API for callers that need to drive the editor (e.g. inserting a
 *  canned response at the cursor). The `ref` is optional — callers that only
 *  bind `value`/`onChange` need not pass one. */
export interface RichTextEditorHandle {
  /** Insert HTML at the current cursor (focuses first). Fires `onChange`. */
  insertContent: (html: string) => void;
  /** Focus the editor body. */
  focus: () => void;
}

export const RichTextEditor = forwardRef<RichTextEditorHandle, RichTextEditorProps>(function RichTextEditor({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  ariaLabel,
  className,
  minHeight = 140,
  autoFocus,
  onImageUpload,
  mentions,
}, ref) {
  // Latest editor + upload fn behind refs so the (create-once) paste/drop
  // handlers below never go stale.
  const editorRef = useRef<Editor | null>(null);
  const uploadRef = useRef(onImageUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    uploadRef.current = onImageUpload;
  }, [onImageUpload]);
  // Read by the editor's attributes (spell check only while editable); updated during
  // render, so the setEditable effect below re-renders the attributes with it.
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  // @mention suggestions (opt-in). The extension list is created once, so the search
  // fn and popup state are reached through refs from its (create-once) callbacks.
  const mentionsRef = useRef(mentions);
  useEffect(() => {
    mentionsRef.current = mentions;
  }, [mentions]);
  const [mentionEnabled] = useState(() => Boolean(mentions));
  const [suggest, setSuggestState] = useState<SuggestState | null>(null);
  const suggestRef = useRef<SuggestState | null>(null);
  const setSuggest = (next: SuggestState | null) => {
    suggestRef.current = next;
    setSuggestState(next);
  };
  const toSuggest = (props: SuggestionProps<MentionItem>): SuggestState => ({
    items: props.items,
    index: 0,
    query: props.query,
    rect: props.clientRect?.() ?? null,
    command: (item) => props.command({ id: item.id, label: item.label }),
  });

  const editor = useEditor({
    // Next.js SSR: render on the client only to avoid a hydration mismatch.
    immediatelyRender: false,
    autofocus: autoFocus ? "end" : false,
    editable: !disabled,
    extensions: [
      StarterKit.configure({
        // Keep the toolbar set tight; matches the bleach allowlist.
        heading: { levels: [2, 3] },
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
      }),
      // Always registered so stored <img> round-trips; insertion (button/paste/
      // drop) is gated on `onImageUpload`. No base64 — we upload and embed a URL.
      TiptapImage.configure({ inline: false, allowBase64: false }),
      Placeholder.configure({ placeholder: placeholder ?? "Describe the issue…" }),
      ...(mentionEnabled
        ? [
            Mention.configure({
              HTMLAttributes: { class: "mention" },
              suggestion: {
                char: "@",
                items: async ({ query }: { query: string }) => {
                  const fn = mentionsRef.current;
                  if (!fn) return [];
                  try {
                    return (await fn(query)).slice(0, 8);
                  } catch {
                    return [];
                  }
                },
                render: () => ({
                  onStart: (props: SuggestionProps<MentionItem>) => setSuggest(toSuggest(props)),
                  onUpdate: (props: SuggestionProps<MentionItem>) => setSuggest(toSuggest(props)),
                  onKeyDown: ({ event }: SuggestionKeyDownProps) => {
                    const cur = suggestRef.current;
                    if (!cur) return false;
                    if (event.key === "Escape") {
                      setSuggest(null);
                      return true;
                    }
                    if (cur.items.length === 0) return false;
                    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                      const step = event.key === "ArrowDown" ? 1 : -1;
                      setSuggest({ ...cur, index: (cur.index + step + cur.items.length) % cur.items.length });
                      return true;
                    }
                    if (event.key === "Enter" || event.key === "Tab") {
                      cur.command(cur.items[cur.index]);
                      return true;
                    }
                    return false;
                  },
                  onExit: () => setSuggest(null),
                }),
              },
            }),
          ]
        : []),
    ],
    content: value || "",
    editorProps: {
      // A function so ProseMirror re-reads it on every view update: the browser's own
      // spell check (red underline + right-click suggestions) runs only while the editor
      // is editable (2026-11-05c). `autocorrect` / `autocapitalize` help phones / Safari.
      attributes: () => ({
        class: "rte-content focus:outline-none focus-visible:ring-0",
        style: `min-height:${minHeight}px`,
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        role: "textbox",
        "aria-multiline": "true",
        spellcheck: disabledRef.current ? "false" : "true",
        autocapitalize: "sentences",
        autocorrect: "on",
      }),
      // Paste / drop an image → upload and embed (only when images are enabled).
      handlePaste: (_view, event) => {
        const upload = uploadRef.current;
        const ed = editorRef.current;
        if (!upload || !ed) return false;
        const imgs = imagesOf(event.clipboardData?.files);
        if (imgs.length === 0) return false;
        event.preventDefault();
        void uploadAndInsertImages(ed, imgs, upload, setUploading);
        return true;
      },
      handleDrop: (_view, event) => {
        const upload = uploadRef.current;
        const ed = editorRef.current;
        if (!upload || !ed) return false;
        const imgs = imagesOf((event as DragEvent).dataTransfer?.files);
        if (imgs.length === 0) return false;
        event.preventDefault();
        void uploadAndInsertImages(ed, imgs, upload, setUploading);
        return true;
      },
    },
    onUpdate: ({ editor }) => onChange?.(editorHtml(editor)),
    onBlur: ({ editor }) => onBlur?.(editorHtml(editor)),
  });

  // Keep the ref pointed at the live editor for the paste/drop handlers.
  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Imperative handle: insert at the cursor (used by the canned-response picker).
  // insertContent fires Tiptap's onUpdate → the parent's onChange, so the caller's
  // draft state stays in sync without any extra plumbing. Reads editorRef.current
  // lazily so the handle is valid even before the editor finishes mounting.
  useImperativeHandle(
    ref,
    () => ({
      insertContent: (html: string) => {
        editorRef.current?.chain().focus().insertContent(html).run();
      },
      focus: () => {
        editorRef.current?.chain().focus().run();
      },
    }),
    [],
  );

  // Reflect external value changes (form reset, switching tickets) WITHOUT
  // resetting on our own emitted HTML — otherwise the cursor jumps every key.
  useEffect(() => {
    if (!editor) return;
    const incoming = value || "";
    const current = editorHtml(editor);
    if (incoming === current) return;
    if (incoming === "" && editor.isEmpty) return;
    editor.commands.setContent(incoming, false);
  }, [value, editor]);

  // Keep the editable flag in sync with `disabled`.
  useEffect(() => {
    editor?.setEditable(!disabled);
  }, [disabled, editor]);

  return (
    <div
      className={cn(
        "rounded-md border border-input bg-background shadow-sm transition-all focus-within:border-ring/50 focus-within:ring-[3px] focus-within:ring-ring/15",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      <Toolbar
        editor={editor}
        disabled={disabled || uploading}
        canImage={Boolean(onImageUpload)}
        onPickImage={() => fileInputRef.current?.click()}
      />
      {onImageUpload ? (
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            const ed = editorRef.current;
            const upload = uploadRef.current;
            const imgs = imagesOf(e.target.files);
            if (ed && upload && imgs.length > 0) void uploadAndInsertImages(ed, imgs, upload, setUploading);
            e.target.value = ""; // allow re-selecting the same file
          }}
        />
      ) : null}
      <EditorContent
        editor={editor}
        className={cn("rounded-b-md px-3 py-2 text-sm", MENTION_CHIP_CLS)}
      />
      {suggest ? <MentionSuggestList state={suggest} onPick={(item) => suggest.command(item)} /> : null}
    </div>
  );
});

RichTextEditor.displayName = "RichTextEditor";

// ---- @mention popup ---------------------------------------------------------

/** The "@" suggestion list, portalled to <body> (comment cards clip overflow) and
 *  pinned to the caret; flips above it near the bottom of the viewport. Mouse-down
 *  picks without stealing the editor's focus. Module-level (focus-stability rule). */
function MentionSuggestList({ state, onPick }: { state: SuggestState; onPick: (item: MentionItem) => void }) {
  if (typeof document === "undefined" || !state.rect) return null;
  const r = state.rect;
  const below = r.bottom + 260 < window.innerHeight;
  const style: React.CSSProperties = {
    position: "fixed",
    left: Math.max(8, Math.min(r.left, window.innerWidth - 272)),
    ...(below ? { top: r.bottom + 4 } : { bottom: window.innerHeight - r.top + 4 }),
  };
  return createPortal(
    <div
      style={style}
      className="z-50 w-64 overflow-hidden rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md"
    >
      {state.items.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {state.query ? "No matching agents" : "Type a name…"}
        </p>
      ) : (
        <ul role="listbox" aria-label="Mention an agent">
          {state.items.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === state.index}
              onMouseDown={(e) => {
                e.preventDefault();
                onPick(item);
              }}
              className={cn(
                "flex cursor-pointer flex-col rounded px-2 py-1.5",
                i === state.index ? "bg-accent text-accent-foreground" : "hover:bg-muted",
              )}
            >
              <span className="truncate font-medium">{item.label}</span>
              {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}

// ---- toolbar --------------------------------------------------------------

function Toolbar({
  editor,
  disabled,
  canImage,
  onPickImage,
}: {
  editor: Editor | null;
  disabled?: boolean;
  canImage?: boolean;
  onPickImage?: () => void;
}) {
  if (!editor) return <div className="h-9 border-b border-input" aria-hidden="true" />;
  return (
    <div
      className="flex flex-wrap items-center gap-0.5 border-b border-input px-1.5 py-1"
      role="toolbar"
      aria-label="Text formatting"
    >
      <TBtn label="Bold" shortcut="Ctrl/⌘+B" active={editor.isActive("bold")} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Italic" shortcut="Ctrl/⌘+I" active={editor.isActive("italic")} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Underline" shortcut="Ctrl/⌘+U" active={editor.isActive("underline")} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Strikethrough" shortcut="Ctrl/⌘+Shift+S" active={editor.isActive("strike")} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <Divider />
      <TBtn label="Heading" shortcut="Ctrl/⌘+Alt+2" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Subheading" shortcut="Ctrl/⌘+Alt+3" active={editor.isActive("heading", { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <Divider />
      <TBtn label="Bullet list" shortcut="Ctrl/⌘+Shift+8" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Numbered list" shortcut="Ctrl/⌘+Shift+7" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Quote" shortcut="Ctrl/⌘+Shift+B" active={editor.isActive("blockquote")} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Inline code" shortcut="Ctrl/⌘+E" active={editor.isActive("code")} disabled={disabled} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <TBtn label="Link" active={editor.isActive("link")} disabled={disabled} onClick={() => setLink(editor)}>
        <LinkIcon className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      {canImage ? (
        <TBtn label="Insert image" disabled={disabled} onClick={() => onPickImage?.()}>
          <ImageIcon className="h-4 w-4" aria-hidden="true" />
        </TBtn>
      ) : null}
      <Divider />
      <TBtn label="Clear formatting" disabled={disabled} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting className="h-4 w-4" aria-hidden="true" />
      </TBtn>
      <div className="ml-auto flex items-center gap-0.5">
        <TBtn label="Undo" shortcut="Ctrl/⌘+Z" disabledReason={disabled ? undefined : "Nothing to undo"} disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-4 w-4" aria-hidden="true" />
        </TBtn>
        <TBtn label="Redo" shortcut="Ctrl/⌘+Shift+Z or Ctrl+Y" disabledReason={disabled ? undefined : "Nothing to redo"} disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-4 w-4" aria-hidden="true" />
        </TBtn>
      </div>
    </div>
  );
}

function TBtn({
  label,
  shortcut,
  disabledReason,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  /** Tiptap's default keyboard shortcut, shown in the tooltip. */
  shortcut?: string;
  /** Tooltip while disabled (e.g. "Nothing to undo"). Without one a disabled button
   *  gets no tooltip, so a fully read-only editor adds no extra tab stops. */
  disabledReason?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const tip = disabled ? disabledReason : shortcut ? `${label} (${shortcut})` : label;
  return (
    <Hint label={tip}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active ?? undefined}
        disabled={disabled}
        // Keep the editor selection on mousedown so toggles apply to it.
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
        className={cn(
          "inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:pointer-events-none disabled:opacity-40",
          active && "bg-accent text-accent-foreground",
        )}
      >
        {children}
      </button>
    </Hint>
  );
}

function Divider() {
  return <span className="mx-0.5 h-5 w-px bg-border" aria-hidden="true" />;
}

/** Prompt for a URL and toggle a link on the current selection. */
function setLink(editor: Editor) {
  const prev = (editor.getAttributes("link").href as string) ?? "";
  const url = window.prompt("Link URL", prev);
  if (url === null) return; // cancelled
  if (url === "") {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
}
