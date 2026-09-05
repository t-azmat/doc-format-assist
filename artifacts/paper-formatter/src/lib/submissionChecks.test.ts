import { expect, it } from "vitest";
import { submissionChecks } from "./submissionChecks";
import { formatReview } from "./formatReview";
import type { Document } from "@workspace/api-client-react";

const heading = (text: string) => ({
  type: "heading",
  content: [{ type: "text", text }],
});
const paragraph = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const draft = (guidelinesText: string | null = null) => ({
  editorContent: {
    type: "doc",
    content: [
      heading("Abstract"),
      paragraph("One two three"),
      heading("Introduction"),
      paragraph("Other words do not belong to the abstract."),
    ],
  },
  references: [],
  guidelinesText,
});

it("shows the supplied requirement and limits counting to the abstract section", () => {
  const result = submissionChecks(draft("Abstract must not exceed 3 words."));
  const check = result.find((r) => r.id === "abstract")!;
  expect(check.status).toBe("passed");
  expect(check.source).toContain("Abstract must not exceed 3 words.");
  expect(check.detail).toContain("3 whitespace-separated words");
});

it("flags an exceeded explicit maximum", () => {
  expect(
    submissionChecks(draft("Abstract: maximum 2 words.")).find(
      (r) => r.id === "abstract",
    )?.status,
  ).toBe("failed");
});

it.each([
  null,
  "Abstract length should be appropriate.",
  "Abstract: 2–5 words.",
  "Abstract maximum 2 words. Abstract maximum 5 words.",
  "For example, abstract maximum 250 words.",
  "Abstract has no maximum of 250 words.",
  "Abstract maximum 250 words unless submitting a review.",
  "Abstract maximum 0 words.",
])(
  "does not guess missing, ranged, or conflicting limits: %s",
  (guidelines) => {
    expect(
      submissionChecks(draft(guidelines)).find((r) => r.id === "abstract")
        ?.status,
    ).toBe("not_checked");
  },
);

it("does not pass an abstract check when the section cannot be located", () => {
  const doc = draft("Abstract maximum 10 words.");
  doc.editorContent.content = [
    paragraph("Abstract: this is not a structural heading"),
  ];
  expect(submissionChecks(doc).find((r) => r.id === "abstract")?.status).toBe(
    "not_checked",
  );
});

it("distinguishes absent structured citations from broken links", () => {
  expect(
    submissionChecks(draft()).find((r) => r.id === "citations")?.status,
  ).toBe("not_checked");
  const doc = {
    ...draft(),
    editorContent: {
      content: [
        {
          type: "paragraph",
          content: [{ type: "citation", attrs: { ids: ["missing"] } }],
        },
      ],
    },
  };
  expect(submissionChecks(doc).find((r) => r.id === "citations")?.status).toBe(
    "failed",
  );
  expect(
    submissionChecks({
      ...doc,
      references: [
        { id: "missing", type: "article-journal", title: "Example" },
      ],
    }).find((r) => r.id === "citations")?.status,
  ).toBe("passed");
});

it("never certifies export layout, import fidelity, or complete venue compliance", () => {
  const checks = submissionChecks(draft());
  for (const id of ["layout", "preservation", "venue"])
    expect(checks.find((r) => r.id === id)?.status).toBe("not_checked");
});

it("compares content and typography without changing the source", () => {
  const before = {
    ...draft(),
    styleSpec: { body_size_pt: 12 },
  } as unknown as Document;
  const after = {
    ...before,
    editorContent: { content: [heading("ABSTRACT")] },
    styleSpec: { body_size_pt: 10 },
  } as Document;
  const original = JSON.stringify(before);
  const diff = formatReview(before, after);
  expect(diff.blocks[0]).toMatchObject({
    before: "Abstract",
    after: "ABSTRACT",
  });
  expect(diff.styles[0]).toEqual({
    name: "body size pt",
    before: "12",
    after: "10",
  });
  expect(JSON.stringify(before)).toBe(original);
});
