import { Node, mergeAttributes } from "@tiptap/core";
import katex from "katex";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

function equationView(node: ProseMirrorNode, displayMode: boolean) {
  const dom = document.createElement(displayMode ? "div" : "span");
  dom.className = displayMode ? "math-block" : "math-inline";
  dom.contentEditable = "false";
  const paint = (current: ProseMirrorNode) => {
    const source = String(current.attrs.latex ?? "");
    dom.dataset.latex = source;
    dom.setAttribute("aria-label", `Equation: ${source}`);
    dom.title = "Select this equation, then choose Equation to edit it.";
    if (source.length > 10000) {
      dom.textContent =
        "Equation source is too long to display. Its source is preserved.";
      return;
    }
    katex.render(source, dom, {
      displayMode,
      throwOnError: false,
      trust: false,
      maxExpand: 500,
      maxSize: 20,
      strict: "ignore",
    });
  };
  paint(node);
  return {
    dom,
    update(next: ProseMirrorNode) {
      if (next.type !== node.type) return false;
      if (next.attrs.latex !== node.attrs.latex) paint(next);
      node = next;
      return true;
    },
    ignoreMutation: () => true,
  };
}

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
 * KaTeX renders only the node view. Serialization retains bare LaTeX so the
 * export pipeline can generate editable Word equations from the same source.
 */

export interface MathAttributes {
  latex: string;
}

const latexAttribute = {
  latex: {
    default: "",
    parseHTML: (element: HTMLElement) =>
      element.getAttribute("data-latex") ?? "",
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
  addNodeView() {
    return ({ node }) => equationView(node, false);
  },

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
  addNodeView() {
    return ({ node }) => equationView(node, true);
  },

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
