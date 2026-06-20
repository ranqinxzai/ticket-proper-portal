"use client";

import { useEffect } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import {
  Bold, Italic, UnderlineIcon, Strikethrough, List, ListOrdered, Heading2, Link as LinkIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Controlled HTML value (used for seeding / external resets via `resetKey`). */
  value?: string;
  placeholder?: string;
  onChange: (html: string, isEmpty: boolean) => void;
  className?: string;
  minHeight?: number;
  /** Change this to force the editor to re-seed from `value` (e.g. template applied). */
  resetKey?: string | number;
};

/**
 * Self-contained Tiptap rich-text editor. Mirrors the toolbar from
 * components/pm/CommentComposer.tsx but is decoupled from the PM data layer
 * so it can back ITSM comments and the create form.
 */
export function RichTextEditor({ value, placeholder, onChange, className, minHeight = 100, resetKey }: Props) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: placeholder ?? "Write something…" }),
    ],
    content: value ?? "",
    editorProps: {
      attributes: {
        class: cn(
          "prose prose-sm max-w-none focus:outline-none px-3 py-2 overflow-y-auto",
          "[&_ul]:list-disc [&_ol]:list-decimal [&_a]:text-indigo-600 [&_a]:underline",
        ),
        style: `min-height:${minHeight}px;max-height:320px`,
      },
    },
    onUpdate: ({ editor }) => onChange(editor.getHTML(), editor.isEmpty),
    immediatelyRender: false,
  });

  // Re-seed when resetKey changes (template apply / external clear).
  useEffect(() => {
    if (editor && resetKey !== undefined) {
      editor.commands.setContent(value ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  if (!editor) return null;

  return (
    <div className={cn("rounded-lg border bg-white", className)}>
      <MenuBar editor={editor} />
      <EditorContent editor={editor} />
    </div>
  );
}

function MenuBar({ editor }: { editor: Editor }) {
  const btn = (active: boolean) =>
    cn(
      "h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors",
      active && "text-indigo-700 bg-indigo-100 hover:bg-indigo-100",
    );

  return (
    <div className="flex items-center gap-0.5 px-2 py-1 border-b text-xs">
      <button type="button" title="Bold" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))}>
        <Bold className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Italic" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))}>
        <Italic className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Underline" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btn(editor.isActive("underline"))}>
        <UnderlineIcon className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Strikethrough" onClick={() => editor.chain().focus().toggleStrike().run()} className={btn(editor.isActive("strike"))}>
        <Strikethrough className="h-3.5 w-3.5" />
      </button>
      <span className="w-px h-4 bg-muted mx-1" />
      <button type="button" title="Heading" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btn(editor.isActive("heading", { level: 2 }))}>
        <Heading2 className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Bullet list" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))}>
        <List className="h-3.5 w-3.5" />
      </button>
      <button type="button" title="Ordered list" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))}>
        <ListOrdered className="h-3.5 w-3.5" />
      </button>
      <span className="w-px h-4 bg-muted mx-1" />
      <button
        type="button"
        title="Add link"
        onClick={() => {
          const prev = editor.getAttributes("link").href as string | undefined;
          const url = window.prompt("Link URL", prev ?? "https://");
          if (url === null) return;
          if (url === "") {
            editor.chain().focus().extendMarkRange("link").unsetLink().run();
            return;
          }
          editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
        }}
        className={btn(editor.isActive("link"))}
      >
        <LinkIcon className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
