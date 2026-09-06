import { useRef, type ReactNode } from "react";
import type { Editor } from "@tiptap/react";
import { EquationControl } from "@editorial-desk/editor-react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  Pilcrow,
  List,
  ListOrdered,
  Quote,
  Table as TableIcon,
  Image as ImageIcon,
  Undo2,
  Redo2,
  Code,
} from "lucide-react";
import { Toggle } from "@/components/ui/toggle";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

interface EditorToolbarProps {
  editor: Editor | null;
}

// Mac reports "MacIntel"/"Mac" in userAgent; showing ⌘ to a Windows user (or
// Ctrl to a Mac user) makes every hint in the toolbar subtly wrong.
const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = IS_MAC ? "⌘" : "Ctrl";

/** Icon control with its keyboard shortcut in the tooltip. */
function Hint({
  label,
  shortcut,
  children,
}: {
  label: string;
  shortcut?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center gap-2">
        <span>{label}</span>
        {shortcut && (
          <kbd className="rounded border border-border/60 px-1 font-mono text-[10px] text-muted-foreground">
            {shortcut}
          </kbd>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Controls grouped by what they do to the document: history, block level,
 * character level, lists, and insertions. The groups are separated by space
 * rather than rules — sixteen buttons in an undifferentiated row is a wall, but
 * five hairlines is a fence.
 */
function Group({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-0.5">{children}</div>;
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);

  if (!editor) return null;

  const insertImageFromFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const src = reader.result;
      if (typeof src === "string") {
        editor.chain().focus().setImage({ src }).run();
      }
    };
    reader.readAsDataURL(file);
  };

  const toggleClass = "h-7 w-7 p-0";

  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border bg-card px-3 py-1">
      <Group>
        <Hint label="Undo" shortcut={`${MOD}Z`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().undo()}
            aria-label="Undo"
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </Hint>
        <Hint label="Redo" shortcut={`${MOD}⇧Z`}>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().redo()}
            aria-label="Redo"
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </Hint>
      </Group>

      <Group>
        <Hint label="Body text" shortcut={`${MOD}⌥0`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("paragraph")}
            onPressedChange={() => editor.chain().focus().setParagraph().run()}
            aria-label="Body text"
          >
            <Pilcrow className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Section heading" shortcut={`${MOD}⌥1`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("heading", { level: 1 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            aria-label="Heading level 1"
          >
            <Heading1 className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Subsection" shortcut={`${MOD}⌥2`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("heading", { level: 2 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            aria-label="Heading level 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Sub-subsection" shortcut={`${MOD}⌥3`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("heading", { level: 3 })}
            onPressedChange={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            aria-label="Heading level 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
      </Group>

      <Group>
        <Hint label="Bold" shortcut={`${MOD}B`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("bold")}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            aria-label="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Italic" shortcut={`${MOD}I`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("italic")}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            aria-label="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Strikethrough">
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("strike")}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
            aria-label="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Inline code" shortcut={`${MOD}E`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("code")}
            onPressedChange={() => editor.chain().focus().toggleCode().run()}
            aria-label="Inline code"
          >
            <Code className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
      </Group>

      <Group>
        <Hint label="Bulleted list" shortcut={`${MOD}⇧8`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("bulletList")}
            onPressedChange={() =>
              editor.chain().focus().toggleBulletList().run()
            }
            aria-label="Bulleted list"
          >
            <List className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Numbered list" shortcut={`${MOD}⇧7`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("orderedList")}
            onPressedChange={() =>
              editor.chain().focus().toggleOrderedList().run()
            }
            aria-label="Numbered list"
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
        <Hint label="Block quotation" shortcut={`${MOD}⇧B`}>
          <Toggle
            size="sm"
            className={toggleClass}
            pressed={editor.isActive("blockquote")}
            onPressedChange={() =>
              editor.chain().focus().toggleBlockquote().run()
            }
            aria-label="Block quotation"
          >
            <Quote className="h-3.5 w-3.5" />
          </Toggle>
        </Hint>
      </Group>

      <Group>
        <EquationControl editor={editor} />
        <Hint label="Insert table">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                .run()
            }
            aria-label="Insert table"
          >
            <TableIcon className="h-3.5 w-3.5" />
          </Button>
        </Hint>
        <Hint label="Insert figure">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            onClick={() => imageInputRef.current?.click()}
            aria-label="Insert figure"
          >
            <ImageIcon className="h-3.5 w-3.5" />
          </Button>
        </Hint>
        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) insertImageFromFile(f);
            if (imageInputRef.current) imageInputRef.current.value = "";
          }}
        />
      </Group>
    </div>
  );
}
