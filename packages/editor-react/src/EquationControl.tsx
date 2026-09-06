import { useEffect, useRef, useState, useId } from "react";
import type { Editor } from "@tiptap/react";
import type { SelectionBookmark } from "@tiptap/pm/state";
import katex from "katex";

/** Host-independent insertion/editing; the host's onChange handles persistence. */
export function EquationControl({ editor }: { editor: Editor | null }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [display, setDisplay] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<HTMLDivElement>(null);
  const selection = useRef<SelectionBookmark | null>(null);
  const id = useId();
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  useEffect(() => {
    if (!open || !preview.current) return;
    if (source.length > 10000) {
      preview.current.textContent = "";
      setError("Shorten this equation to 10,000 characters before rendering it.");
      return;
    }
    try {
      katex.render(source, preview.current, {
        displayMode: display,
        throwOnError: true,
        trust: false,
        maxExpand: 500,
        maxSize: 20,
        strict: "ignore",
      });
      setError("");
    } catch {
      preview.current.textContent = "";
      setError("This equation cannot be rendered. Check the LaTeX source.");
    }
  }, [open, source, display]);
  const start = () => {
    if (!editor || !editor.isEditable) return;
    const current = editor.state.selection;
    const node =
      "node" in current
        ? (current.node as {
            type: { name: string };
            attrs: { latex?: string };
          })
        : undefined;
    const isMath =
      node?.type.name === "mathInline" || node?.type.name === "mathBlock";
    selection.current = current.getBookmark();
    setSource(isMath ? String(node?.attrs.latex ?? "") : "E = mc^2");
    setDisplay(isMath ? node?.type.name === "mathBlock" : true);
    setEditing(isMath);
    setOpen(true);
  };
  return (
    <>
      <button
        type="button"
        className="ed-equation-button"
        disabled={!editor || !editor.isEditable}
        onClick={start}
      >
        Equation
      </button>
      {open && (
        <dialog
          ref={dialog}
          className="ed-equation-dialog"
          aria-labelledby={`${id}-title`}
          onClose={() => setOpen(false)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                !editor ||
                !editor.isEditable ||
                !selection.current ||
                error ||
                !source.trim()
              )
                return;
              // Native modal dialog prevents background edits while this bookmark is held.
              const saved = selection.current.resolve(editor.state.doc);
              editor.view.dispatch(editor.state.tr.setSelection(saved));
              editor
                .chain()
                .focus()
                .insertContent({
                  type: display ? "mathBlock" : "mathInline",
                  attrs: { latex: source },
                })
                .run();
              dialog.current?.close();
            }}
          >
            <h2 id={`${id}-title`}>
              {editing ? "Edit equation" : "Insert equation"}
            </h2>
            <label htmlFor={`${id}-source`}>LaTeX source</label>
            <textarea
              id={`${id}-source`}
              value={source}
              maxLength={10000}
              onChange={(e) => setSource(e.target.value)}
              autoFocus
            />
            <label className="ed-equation-choice">
              <input
                type="checkbox"
                checked={display}
                onChange={(e) => setDisplay(e.target.checked)}
              />
              Display on its own line
            </label>
            <div
              ref={preview}
              className="ed-equation-preview"
              aria-label="Equation preview"
            />
            {error && <p role="alert">{error}</p>}
            <div className="ed-equation-actions">
              <button type="button" onClick={() => dialog.current?.close()}>
                Cancel
              </button>
              <button type="submit" disabled={!!error || !source.trim()}>
                {editing ? "Update equation" : "Insert equation"}
              </button>
            </div>
          </form>
        </dialog>
      )}
    </>
  );
}
