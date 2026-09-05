import { Router, type IRouter } from "express";
import { ListStylesResponse, ListDocumentClassesResponse } from "@workspace/api-zod";

const router: IRouter = Router();

// Mirrors CLASSES in artifacts/api-server/python/docclass.py, which is the
// source of truth — the engine reads its own copy over stdin. Same duplication
// as CONFERENCE_STYLES below and StyleSpec's three declarations: adding a class
// means editing both, or the picker offers something the engine rejects.
const DOCUMENT_CLASSES = [
  {
    id: "ieee-conference" as const,
    name: "IEEE Conference Paper",
    description: "Two-column IEEE conference paper. Six pages, no contents page.",
    family: "ieee" as const,
    genre: "conference_paper" as const,
    toc: "forbidden" as const,
    pageBudget: { maxPages: 6, includesReferences: true },
  },
  {
    id: "ieee-journal" as const,
    name: "IEEE Transactions Article",
    description:
      "Two-column IEEE journal article. Longer than a conference paper, no contents page.",
    family: "ieee" as const,
    genre: "journal_article" as const,
    toc: "forbidden" as const,
    pageBudget: { maxPages: 14, includesReferences: true },
  },
  {
    id: "acm-conference" as const,
    name: "ACM Conference Paper",
    description:
      "Two-column ACM proceedings paper. Numbered sections, no contents page.",
    family: "acm" as const,
    genre: "conference_paper" as const,
    toc: "forbidden" as const,
    pageBudget: { maxPages: 10, includesReferences: false },
  },
  {
    id: "apa-journal" as const,
    name: "APA Journal Manuscript",
    description:
      "Single-column APA 7 manuscript for journal submission. No contents page.",
    family: "apa" as const,
    genre: "journal_article" as const,
    toc: "forbidden" as const,
    pageBudget: null,
  },
  {
    id: "apa-dissertation" as const,
    name: "APA Dissertation",
    description:
      "Single-column APA 7 dissertation or thesis. Contents page required, no page limit.",
    family: "apa" as const,
    genre: "thesis" as const,
    toc: "required" as const,
    pageBudget: null,
  },
];

const CONFERENCE_STYLES = [
  {
    id: "ieee" as const,
    name: "IEEE Conference",
    description:
      "Two-column IEEE conference paper format (Times New Roman, numeric citations).",
  },
  {
    id: "apa" as const,
    name: "APA 7th Edition",
    description:
      "Single-column APA manuscript format (Times New Roman 12pt, double-spaced, author-date citations).",
  },
  {
    id: "acm" as const,
    name: "ACM Conference",
    description:
      "Two-column ACM conference proceedings format (numeric citations).",
  },
];

router.get("/styles", (_req, res) => {
  res.json(ListStylesResponse.parse(CONFERENCE_STYLES));
});

router.get("/document-classes", (_req, res) => {
  res.json(ListDocumentClassesResponse.parse(DOCUMENT_CLASSES));
});

export default router;
