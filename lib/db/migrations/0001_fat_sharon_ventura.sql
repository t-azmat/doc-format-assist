ALTER TABLE "documents" ADD COLUMN "authors" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "affiliations" jsonb DEFAULT '[]'::jsonb NOT NULL;