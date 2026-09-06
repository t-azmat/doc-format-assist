import { useState } from "react";
import {
  useManuscriptEditor,
  ManuscriptCanvas,
  EquationControl,
  manuscriptTemplates,
  resolveManuscriptStyle,
  type JSONContent,
} from "@editorial-desk/editor-react";
import "@editorial-desk/editor-react/styles.css";

const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const initial: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "A manuscript that follows your style" }],
    },
    paragraph(
      "Write here, create a heading, or paste text. Switch the template and the typography updates without replacing your words. This playground is temporary: nothing is uploaded or saved when you leave.",
    ),
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Method and notation" }],
    },
    paragraph(
      "Equations and citation IDs remain structured parts of the document. Select an equation and choose Equation to edit its LaTeX source, or insert a new one at the cursor.",
    ),
    { type: "mathBlock", attrs: { latex: "E = mc^2" } },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "A fictional citation marker " },
        { type: "citation", attrs: { ids: ["example-reference"] } },
      ],
    },
    {
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableHeader", content: [paragraph("Element")] },
            { type: "tableHeader", content: [paragraph("Behavior")] },
          ],
        },
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [paragraph("New paragraphs")] },
            { type: "tableCell", content: [paragraph("Inherit the template")] },
          ],
        },
      ],
    },
  ],
};

export default function EditorLab() {
  const [template, setTemplate] = useState("apa-journal");
  const [changes, setChanges] = useState(0);
  const [content, setContent] = useState(initial);
  const [columns, setColumns] = useState(false);
  const editor = useManuscriptEditor({
    content: initial,
    onChange: (value) => {
      setContent(value);
      setChanges((n) => n + 1);
    },
  });
  const style = resolveManuscriptStyle({ documentClass: template });
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8">
      <p className="text-xs uppercase tracking-wider text-brand">
        Independent editor · Prototype
      </p>
      <h1 className="mt-3 text-3xl font-medium">
        Write. Let the style follow.
      </h1>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        Try automatic typography with a temporary manuscript. Your edits stay in
        this tab and disappear when you leave. Column flow is experimental; this
        is not a final paginated preview.
      </p>
      <div className="my-6 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          Template
          <select
            aria-label="Editor template"
            className="ml-3 rounded border border-border bg-card p-2"
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          >
            {Object.entries(manuscriptTemplates).map(([id, spec]) => (
              <option key={id} value={id}>
                {spec.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={columns}
            onChange={(e) => setColumns(e.target.checked)}
          />
          Show template columns
        </label>
        <span role="status" className="text-xs text-muted-foreground">
          {style.body_size_pt} pt · {style.line_spacing}× spacing · {changes}{" "}
          content edits
        </span>
      </div>
      <div
        role="toolbar"
        aria-label="Manuscript tools"
        className="flex flex-wrap gap-2 rounded-t-lg border border-border bg-card p-3"
      >
        <EquationControl editor={editor} />
        {[
          ["Paragraph", () => editor?.chain().focus().setParagraph().run()],
          [
            "Heading",
            () => editor?.chain().focus().toggleHeading({ level: 2 }).run(),
          ],
          ["Bold", () => editor?.chain().focus().toggleBold().run()],
          ["Undo", () => editor?.chain().focus().undo().run()],
          ["Redo", () => editor?.chain().focus().redo().run()],
        ].map(([label, action]) => (
          <button
            key={String(label)}
            type="button"
            disabled={!editor}
            className="rounded border border-border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
            onClick={action as () => void}
          >
            {String(label)}
          </button>
        ))}
      </div>
      <div className="rounded-b-lg border border-t-0 border-border bg-white p-6 text-black sm:p-12">
        <ManuscriptCanvas
          editor={editor}
          styleSpec={style}
          layout={columns ? "columns" : "flow"}
        />
      </div>
      <details className="mt-5 rounded border border-border p-4">
        <summary className="cursor-pointer text-sm">
          Inspect document JSON
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">
          Template changes alter presentation, not this content. Equations,
          tables, and citation IDs round-trip through the editor.
        </p>
        <pre
          data-testid="editor-json"
          className="mt-3 max-h-80 overflow-auto text-xs"
        >
          {JSON.stringify(content, null, 2)}
        </pre>
      </details>
    </div>
  );
}
