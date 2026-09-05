const heading = (text: string) => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

/** Synthetic teaching material. Never derived from an uploaded manuscript. */
export function sampleDocumentValues() {
  return {
    title: "Sample · A cooler walk across campus",
    authors: [],
    affiliations: [],
    references: [
      {
        id: "example-reference",
        type: "article-journal",
        title: "Example reference for learning the editor",
        author: [{ literal: "Example Research Group" }],
        note: "Fictional demonstration reference; not a published source.",
      },
    ],
    originalFilename: null,
    status: "extracted" as const,
    conferenceStyle: "apa" as const,
    documentClass: "apa-journal" as const,
    pageBudget: null,
    styleSpec: null,
    guidelinesText:
      "Demonstration guidelines, not a real journal's requirements.\nAbstract must not exceed 60 words.",
    editorContent: {
      type: "doc",
      content: [
        heading("Abstract"),
        paragraph(
          "This fictional manuscript explores how a campus walking study might be presented to a research audience. It introduces a possible comparison of shaded and exposed routes, describes a proposed observation method, and explains how a researcher could report practical limitations. No measurements were collected and no scientific findings are claimed. The abstract is intentionally longer than the demonstration limit so you can try the submission checklist, edit the text, and see how the result changes before preparing a real manuscript.",
        ),
        heading("Introduction"),
        paragraph(
          "Start with the question your paper addresses. This sample lets you explore formatting and recovery without uploading your own research. Every source and scenario in this draft is fictional.",
        ),
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "This citation links to an example entry in the reference library ",
            },
            { type: "citation", attrs: { ids: ["example-reference"] } },
            {
              type: "text",
              text: ". Replace demonstration references before using a draft for real work.",
            },
          ],
        },
        heading("Method"),
        paragraph(
          "Describe how a future study could compare routes, record observations, and account for changing conditions. Use the authors and references panels to explore the manuscript's supporting information.",
        ),
        heading("Discussion"),
        paragraph(
          "Try Review format to compare the proposed changes. Apply them, then open Versions to restore this draft. The original is saved before formatting is applied.",
        ),
        heading("References"),
        paragraph(
          "The exporter builds the bibliography from your reference library. The example reference is fictional and is included only to demonstrate citation links.",
        ),
      ],
    },
    extractedContent: { sample: true },
    formattingIssues: [],
  };
}
