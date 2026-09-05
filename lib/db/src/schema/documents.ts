import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export const documentStatusValues = ["extracted", "formatted"] as const;
export type DocumentStatus = (typeof documentStatusValues)[number];

export const conferenceStyleValues = ["ieee", "apa", "acm"] as const;
export type ConferenceStyleId = (typeof conferenceStyleValues)[number];

// A document class is venue family x genre. "IEEE" is a family, not a format:
// a six-page conference paper and a hundred-page dissertation need different
// structure, page budgets and contents-page rules from the same typography.
// Mirrors CLASSES in artifacts/api-server/python/docclass.py, which is the
// source of truth for their contents.
export const documentClassValues = [
  "ieee-conference",
  "ieee-journal",
  "acm-conference",
  "apa-journal",
  "apa-dissertation",
] as const;
export type DocumentClassId = (typeof documentClassValues)[number];

export type DocumentGenre = "conference_paper" | "journal_article" | "thesis";
export type TocPolicy = "required" | "optional" | "forbidden";

export interface PageBudget {
  maxPages: number;
  // Load-bearing: calls for papers say "8 pages including references" and
  // "10 pages excluding references", and the difference is real work.
  includesReferences: boolean;
}

export interface FormattingIssue {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  location?: string | null;
}

export type HeadingCase = "title" | "upper" | "sentence" | "none";
export type CitationStyle = "numeric" | "author-date";

// --- Authorship -------------------------------------------------------------
// Authors are document metadata, never prose in editorContent. The author block
// is the most venue-specific artifact in a paper — IEEE sets it as a grid, APA
// as a title page with an author note — so it has to be re-renderable when the
// style changes. Anything stored as a paragraph could not be.

export interface Affiliation {
  id: string;
  organization: string;
  department?: string | null;
  city?: string | null;
  country?: string | null;
}

export interface Author {
  id: string;
  // Split, and joined only for display. The split is for citations, where the
  // same person is rendered "Smith, J. A." — and a full name cannot be reliably
  // split after the fact (particles, double surnames, family-name-first).
  given: string;
  family: string;
  // Escape hatch for names that do not decompose: mononyms, and organisations
  // credited as an author. Wins over given/family when set.
  literal?: string | null;
  suffix?: string | null;
  // Order is significant, and many-to-one: an author may hold several posts.
  affiliationIds: string[];
  email?: string | null;
  orcid?: string | null;
  corresponding: boolean;
  equalContribution: boolean;
}

export const affiliationSchema = z.object({
  id: z.string().min(1).max(64),
  organization: z.string().min(1, "An affiliation needs an organization.").max(300),
  department: z.string().max(300).nullish(),
  city: z.string().max(200).nullish(),
  country: z.string().max(200).nullish(),
});

export const authorSchema = z.object({
  id: z.string().min(1).max(64),
  given: z.string().max(200).default(""),
  family: z.string().max(200).default(""),
  literal: z.string().max(400).nullish(),
  suffix: z.string().max(50).nullish(),
  affiliationIds: z.array(z.string().min(1).max(64)).max(20).default([]),
  email: z.string().max(320).nullish(),
  orcid: z.string().max(100).nullish(),
  corresponding: z.boolean().default(false),
  equalContribution: z.boolean().default(false),
});

// Bounded so a malformed client cannot push an unbounded jsonb blob. Papers
// with more than 200 authors exist in particle physics; they are also not this
// product's audience.
export const authorsSchema = z.array(authorSchema).max(200);
export const affiliationsSchema = z.array(affiliationSchema).max(100);

// --- References -------------------------------------------------------------
// Stored as CSL-JSON, the interchange format Zotero, Mendeley and pandoc all
// read and write. Not BibTeX: `.bst` style files are a BibTeX-only DSL and are
// inert off the LaTeX toolchain, so `.bib` is an import path, not a store.
//
// Deliberately loose: CSL-JSON has ~60 optional fields and the engine ignores
// what it does not use. Constraining the shape here would reject valid
// libraries exported from a reference manager.

export interface CslName {
  family?: string;
  given?: string;
  literal?: string;
}

export interface Reference {
  id: string;
  type?: string;
  title?: string;
  author?: CslName[];
  "container-title"?: string;
  publisher?: string;
  volume?: string;
  issue?: string;
  page?: string;
  issued?: { "date-parts"?: number[][]; literal?: string };
  edition?: string;
  DOI?: string;
  URL?: string;
  note?: string;
  // Set when a reference could not be parsed into fields — extraction yields
  // strings, not structure. Rendered verbatim rather than dropped.
  literal?: string;
  [field: string]: unknown;
}

export const referenceSchema = z
  .object({ id: z.string().min(1).max(200) })
  .loose();

export const referencesSchema = z.array(referenceSchema).max(2000);

// Resolved, engine-ready formatting spec. Mirrors the StyleSpec dataclass in
// artifacts/api-server/python/styles.py (snake_case keys are intentional — the
// same JSON is consumed directly by the Python engine over stdin).
export interface StyleSpec {
  id: string;
  name: string;
  description: string;
  body_font: string;
  heading_font: string;
  body_size_pt: number;
  heading_sizes_pt: { 1: number; 2: number; 3: number };
  line_spacing: number;
  margins_in: { top: number; bottom: number; left: number; right: number };
  // Actual source page size (inches), when known — lets the editor render the
  // real page (e.g. A4 vs Letter) instead of assuming one.
  page_width_in?: number;
  page_height_in?: number;
  columns: number;
  heading_case: HeadingCase;
  citation_style: CitationStyle;
  required_sections: string[];
}

export const documentsTable = pgTable(
  "documents",
  {
  id: serial("id").primaryKey(),
  // Every document belongs to exactly one user. Deleting the user removes
  // their manuscripts; nothing in the API is allowed to read a row without
  // filtering on this column.
  ownerId: integer("owner_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  // Authorship, kept beside the body rather than inside it so switching venue
  // re-renders the author block instead of leaving stale prose.
  authors: jsonb("authors").$type<Author[]>().notNull().default([]),
  affiliations: jsonb("affiliations")
    .$type<Affiliation[]>()
    .notNull()
    .default([]),
  // CSL-JSON reference library. The exporter renders in-text citations and the
  // bibliography from this, per style — which is why citations are stored in
  // the body as ids rather than as "[1]".
  references: jsonb("references").$type<Reference[]>().notNull().default([]),
  originalFilename: text("original_filename"),
  revision: integer("revision").notNull().default(0),
  // Absolute path on disk to the originally uploaded source file (kept for re-export/re-analysis).
  sourceFilePath: text("source_file_path"),
  status: text("status", { enum: documentStatusValues })
    .notNull()
    .default("extracted"),
  conferenceStyle: text("conference_style", { enum: conferenceStyleValues }),
  // Supersedes conferenceStyle: it names the genre as well as the family. The
  // older column is kept for documents created before classes existed, and
  // resolves to its family's default class.
  documentClass: text("document_class", { enum: documentClassValues }),
  // A page limit read out of the user's own guidelines, overriding the class
  // preset. Their call for papers is more specific than any preset can be.
  pageBudget: jsonb("page_budget").$type<PageBudget>(),
  // Raw formatting guidelines supplied by the user (pasted text, or text
  // extracted from an uploaded .txt/.md/.yaml/.pdf/.docx guidelines file).
  guidelinesText: text("guidelines_text"),
  // Resolved StyleSpec (fonts, sizes, spacing, margins, columns, heading case,
  // citation style, required sections) that drives format.py/export.py. Derived
  // from the guidelines when present; otherwise a built-in preset is used.
  styleSpec: jsonb("style_spec").$type<Partial<StyleSpec>>(),
  // TipTap/ProseMirror JSON document — the editable source of truth.
  editorContent: jsonb("editor_content").notNull(),
  // Raw structured extraction produced by Docling (sections, references, images, tables).
  extractedContent: jsonb("extracted_content").notNull(),
  formattingIssues: jsonb("formatting_issues")
    .$type<FormattingIssue[]>()
    .notNull()
    .default([]),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  },
  (table) => [
    // The list view is always "this user's documents, newest first".
    index("documents_owner_id_updated_at_idx").on(
      table.ownerId,
      table.updatedAt,
    ),
  ],
);

export const insertDocumentSchema = createInsertSchema(documentsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDocument = z.infer<typeof insertDocumentSchema>;
export type Document = typeof documentsTable.$inferSelect;

export const documentIssueCount = (doc: {
  formattingIssues: FormattingIssue[] | null;
}): number => doc.formattingIssues?.length ?? 0;
