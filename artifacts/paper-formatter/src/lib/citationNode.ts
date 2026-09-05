import { Node, mergeAttributes } from "@tiptap/core";

/**
 * An in-text citation: a reference to entries in the document's CSL-JSON
 * library, not the rendered marker itself.
 *
 * Storing ids rather than "[1]" or "(Smith, 2020)" is the whole point. The
 * marker is a function of the style — IEEE numbers by order of first citation,
 * APA writes the author and year — so text baked into the body could not be
 * re-rendered when the venue changes, which is the product's promise. The
 * exporter resolves ids to markers at render time.
 *
 * It also has to exist for the schema's sake: ProseMirror drops node types it
 * does not know, so without this every citation would be discarded on load and
 * autosaved away. Same failure as the math nodes.
 */
export const Citation = Node.create({
  name: "citation",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      ids: {
        default: [] as string[],
        parseHTML: (element: HTMLElement) => {
          const raw = element.getAttribute("data-citation-ids") ?? "";
          return raw.split(",").map((id) => id.trim()).filter(Boolean);
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const ids = Array.isArray(attributes.ids) ? attributes.ids : [];
          return { "data-citation-ids": ids.join(",") };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: "span[data-citation-ids]" }];
  },

  renderHTML({ HTMLAttributes, node }) {
    const ids: string[] = Array.isArray(node.attrs.ids) ? node.attrs.ids : [];
    // Shown as the keys, since the real marker depends on a style the editor
    // does not apply. Legible, and obviously a placeholder rather than final
    // copy the author might mistake for output.
    return [
      "span",
      mergeAttributes(HTMLAttributes, { class: "citation" }),
      ids.length ? `[${ids.join(", ")}]` : "[?]",
    ];
  },
});
