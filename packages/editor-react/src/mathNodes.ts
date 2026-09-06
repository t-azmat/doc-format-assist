import { Node, mergeAttributes } from "@tiptap/core";

/**
 * Math nodes for the editor schema.
 *
 * These exist first and foremost so the schema *knows* about equations.
 * ProseMirror silently discards nodes its schema does not declare: extraction
 * would produce `mathBlock` nodes, `setContent` would drop every one of them on
 * load, and the first keystroke would autosave the stripped document back over
 * the original. The equations would be gone with nothing to indicate it. A node
 * that merely round-trips is enough to prevent that.
 *
 * LaTeX is stored bare in the `latex` attribute — no delimiters — matching what
 * `richconvert.py` emits and what `export.py` converts to OMML.
 *
 * Rendering is deliberately plain text in a monospace box rather than typeset
 * output. Typesetting needs KaTeX, which is a dependency this workspace does
 * not have; the export path does not depend on it, so it can be added later
 * without touching the document format.
 */

export interface MathAttributes {
  latex: string;
}

const latexAttribute = {
  latex: {
    default: "",
    parseHTML: (element: HTMLElement) => element.getAttribute("data-latex") ?? "",
    renderHTML: (attributes: Record<string, unknown>) => ({
      "data-latex": String(attributes.latex ?? ""),
    }),
  },
};

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  // An equation is edited as a whole, not character by character: without
  // `atom` the caret walks into it and the LaTeX can be corrupted piecemeal.
  atom: true,
  selectable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: "span[data-latex]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "math-inline" }),
      node.attrs.latex || "",
    ];
  },
});

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return latexAttribute;
  },

  parseHTML() {
    return [{ tag: "div[data-latex]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: "math-block" }),
      node.attrs.latex || "",
    ];
  },
});
