import {
  useEditor,
  EditorContent,
  type Editor,
  type JSONContent,
  type UseEditorOptions,
} from "@tiptap/react";
import type { CSSProperties } from "react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import {
  manuscriptStyleVariables,
  resolveManuscriptStyle,
  type ManuscriptStyle,
} from "@editorial-desk/editor-core";
import { MathInline, MathBlock } from "./mathNodes.js";
import { Citation } from "./citationNode.js";

export { MathInline, MathBlock, Citation };
// Keep extension command augmentations available to TypeScript consumers.
export { StarterKit, Image, Table, TableRow, TableHeader, TableCell };
export type { Editor, JSONContent };
export {
  resolveManuscriptStyle,
  manuscriptTemplates,
} from "@editorial-desk/editor-core";
export type {
  ManuscriptStyle,
  ManuscriptStyleInput,
} from "@editorial-desk/editor-core";

export interface ManuscriptEditorOptions {
  /** Initial content only. Use editor.commands.setContent for external replacements. */
  content?: JSONContent;
  editable?: boolean;
  onChange?: (document: JSONContent) => void;
  extensions?: UseEditorOptions["extensions"];
  editorProps?: UseEditorOptions["editorProps"];
}

export function useManuscriptEditor(options: ManuscriptEditorOptions = {}) {
  return useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Typography,
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      MathInline,
      MathBlock,
      Citation,
      ...(options.extensions ?? []),
    ],
    content: options.content ?? {
      type: "doc",
      content: [{ type: "paragraph" }],
    },
    editable: options.editable ?? true,
    editorProps: {
      ...options.editorProps,
      attributes: (state) => {
        const attributes = options.editorProps?.attributes;
        return {
          role: "textbox",
          "aria-label": "Manuscript",
          "aria-multiline": "true",
          ...(typeof attributes === "function"
            ? attributes(state)
            : attributes),
        };
      },
    },
    onUpdate: ({ editor }) => options.onChange?.(editor.getJSON()),
  });
}

export interface ManuscriptCanvasProps {
  editor: Editor | null;
  styleSpec?: ManuscriptStyle;
  /** Columns are continuous flow, not print pagination. */
  layout?: "flow" | "columns";
  className?: string;
}

export function ManuscriptCanvas({
  editor,
  styleSpec = resolveManuscriptStyle(),
  layout = "flow",
  className = "",
}: ManuscriptCanvasProps) {
  return (
    <div
      className={`ed-canvas ${className}`}
      data-layout={layout}
      style={manuscriptStyleVariables(styleSpec) as CSSProperties}
    >
      <EditorContent editor={editor} />
    </div>
  );
}

/** Uncontrolled convenience component. Key by document ID when changing documents. */
export function ManuscriptEditor({
  styleSpec,
  layout,
  className,
  ...options
}: ManuscriptEditorOptions & Omit<ManuscriptCanvasProps, "editor">) {
  const editor = useManuscriptEditor(options);
  return (
    <ManuscriptCanvas
      editor={editor}
      styleSpec={styleSpec}
      layout={layout}
      className={className}
    />
  );
}
