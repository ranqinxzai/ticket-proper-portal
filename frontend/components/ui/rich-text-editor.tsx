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

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import TiptapImage from "@tiptap/extension-image";
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

import { cn } from "@/lib/utils";

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
  /** Enables inline images: a toolbar button + paste/drop upload the file and
   *  embed its returned URL. Omit to keep the editor image-free (description /
   *  custom fields). Must return an absolute URL (base64 is stripped on save). */
  onImageUpload?: (file: File) => Promise<string | null>;
}

export function RichTextEditor({
  value,
  onChange,
  onBlur,
  disabled,
  placeholder,
  ariaLabel,
  className,
  minHeight = 140,
  onImageUpload,
}: RichTextEditorProps) {
  // Latest editor + upload fn behind refs so the (create-once) paste/drop
  // handlers below never go stale.
  const editorRef = useRef<Editor | null>(null);
  const uploadRef = useRef(onImageUpload);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  useEffect(() => {
    uploadRef.current = onImageUpload;
  }, [onImageUpload]);

  const editor = useEditor({
    // Next.js SSR: render on the client only to avoid a hydration mismatch.
    immediatelyRender: false,
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
    ],
    content: value || "",
    editorProps: {
      attributes: {
        class: "rte-content focus:outline-none",
        style: `min-height:${minHeight}px`,
        ...(ariaLabel ? { "aria-label": ariaLabel } : {}),
        role: "textbox",
        "aria-multiline": "true",
      },
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
        "rounded-md border border-input bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring",
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
      <EditorContent editor={editor} className="px-3 py-2 text-sm" />
    </div>
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
      <TBtn label="Bold" active={editor.isActive("bold")} disabled={disabled} onClick={() => editor.chain().focus().toggleBold().run()}>
        <Bold className="h-4 w-4" />
      </TBtn>
      <TBtn label="Italic" active={editor.isActive("italic")} disabled={disabled} onClick={() => editor.chain().focus().toggleItalic().run()}>
        <Italic className="h-4 w-4" />
      </TBtn>
      <TBtn label="Underline" active={editor.isActive("underline")} disabled={disabled} onClick={() => editor.chain().focus().toggleUnderline().run()}>
        <UnderlineIcon className="h-4 w-4" />
      </TBtn>
      <TBtn label="Strikethrough" active={editor.isActive("strike")} disabled={disabled} onClick={() => editor.chain().focus().toggleStrike().run()}>
        <Strikethrough className="h-4 w-4" />
      </TBtn>
      <Divider />
      <TBtn label="Heading" active={editor.isActive("heading", { level: 2 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
        <Heading2 className="h-4 w-4" />
      </TBtn>
      <TBtn label="Subheading" active={editor.isActive("heading", { level: 3 })} disabled={disabled} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
        <Heading3 className="h-4 w-4" />
      </TBtn>
      <Divider />
      <TBtn label="Bullet list" active={editor.isActive("bulletList")} disabled={disabled} onClick={() => editor.chain().focus().toggleBulletList().run()}>
        <List className="h-4 w-4" />
      </TBtn>
      <TBtn label="Numbered list" active={editor.isActive("orderedList")} disabled={disabled} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
        <ListOrdered className="h-4 w-4" />
      </TBtn>
      <TBtn label="Quote" active={editor.isActive("blockquote")} disabled={disabled} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
        <Quote className="h-4 w-4" />
      </TBtn>
      <TBtn label="Code" active={editor.isActive("code")} disabled={disabled} onClick={() => editor.chain().focus().toggleCode().run()}>
        <Code className="h-4 w-4" />
      </TBtn>
      <TBtn label="Link" active={editor.isActive("link")} disabled={disabled} onClick={() => setLink(editor)}>
        <LinkIcon className="h-4 w-4" />
      </TBtn>
      {canImage ? (
        <TBtn label="Insert image" disabled={disabled} onClick={() => onPickImage?.()}>
          <ImageIcon className="h-4 w-4" />
        </TBtn>
      ) : null}
      <Divider />
      <TBtn label="Clear formatting" disabled={disabled} onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}>
        <RemoveFormatting className="h-4 w-4" />
      </TBtn>
      <div className="ml-auto flex items-center gap-0.5">
        <TBtn label="Undo" disabled={disabled || !editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 className="h-4 w-4" />
        </TBtn>
        <TBtn label="Redo" disabled={disabled || !editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 className="h-4 w-4" />
        </TBtn>
      </div>
    </div>
  );
}

function TBtn({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
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
