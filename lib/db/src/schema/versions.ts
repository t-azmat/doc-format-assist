import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { documentsTable, type Document } from "./documents";

export type DocumentSnapshot = Pick<
  Document,
  | "title"
  | "authors"
  | "affiliations"
  | "references"
  | "editorContent"
  | "conferenceStyle"
  | "documentClass"
  | "pageBudget"
  | "styleSpec"
  | "guidelinesText"
  | "status"
  | "formattingIssues"
>;

export const documentVersionsTable = pgTable(
  "document_versions",
  {
    id: serial("id").primaryKey(),
    documentId: integer("document_id")
      .notNull()
      .references(() => documentsTable.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    snapshot: jsonb("snapshot").$type<DocumentSnapshot>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("document_versions_document_id_idx").on(table.documentId, table.id),
  ],
);

export function documentSnapshot(row: Document): DocumentSnapshot {
  const {
    title,
    authors,
    affiliations,
    references,
    editorContent,
    conferenceStyle,
    documentClass,
    pageBudget,
    styleSpec,
    guidelinesText,
    status,
    formattingIssues,
  } = row;
  return {
    title,
    authors,
    affiliations,
    references,
    editorContent,
    conferenceStyle,
    documentClass,
    pageBudget,
    styleSpec,
    guidelinesText,
    status,
    formattingIssues,
  };
}
