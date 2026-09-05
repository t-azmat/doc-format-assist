import { useEffect, useRef, useState } from "react";
import type { Reference } from "@workspace/api-client-react";
import { BookMarked, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";

interface ReferencePanelProps {
  references: Reference[];
  onSave: (references: Reference[]) => void;
  onImportBibtex: (bibtex: string) => Promise<void>;
  importing: boolean;
}

/** "Smith, Doe & Lee" — enough to recognise an entry in a list. */
function authorSummary(reference: Reference): string {
  const authors = reference.author ?? [];
  const names = authors
    .map((a) => a.family || a.literal || a.given || "")
    .filter(Boolean);
  if (names.length === 0) return "";
  if (names.length <= 2) return names.join(" & ");
  return `${names[0]} et al.`;
}

function yearOf(reference: Reference): string {
  const parts = reference.issued?.["date-parts"];
  if (Array.isArray(parts) && parts[0]?.[0]) return String(parts[0][0]);
  return reference.issued?.literal?.slice(0, 4) ?? "";
}

/**
 * The CSL-JSON reference library.
 *
 * BibTeX is the import path because it is what users already have — every
 * manager exports it, and "Cite → BibTeX" on a single paper gives one entry to
 * paste. It is converted at the door; nothing stores BibTeX, because `.bst`
 * style files only mean something to the BibTeX binary.
 *
 * Entries are shown, not edited field by field. Re-importing a corrected .bib
 * merges by cite key, which is how a reference library is actually kept
 * up to date.
 */
export function ReferencePanel({
  references,
  onSave,
  onImportBibtex,
  importing,
}: ReferencePanelProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Reference[]>(references);
  const [bibtex, setBibtex] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setDraft(references);
  }, [open, references]);

  const remove = (id: string) =>
    setDraft((list) => list.filter((reference) => reference.id !== id));

  const save = () => {
    onSave(draft);
    setOpen(false);
  };

  const importPasted = async () => {
    if (!bibtex.trim()) return;
    await onImportBibtex(bibtex);
    setBibtex("");
  };

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow">References</p>
          {references.length > 0 ? (
            <p className="type-label mt-1 text-foreground">
              {references.length} reference{references.length === 1 ? "" : "s"}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              No references yet. Import a .bib file and citations format
              themselves to the selected style.
            </p>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <BookMarked className="mr-1.5 h-3.5 w-3.5" />
              Manage
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Reference library</DialogTitle>
              <DialogDescription>
                Stored as CSL-JSON. The exporter renders in-text citations and
                the bibliography from these, in the selected style.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-2">
              <Label htmlFor="bibtex-input" className="type-eyebrow">
                Import BibTeX
              </Label>
              <Textarea
                id="bibtex-input"
                rows={4}
                placeholder={"@article{smith2020,\n  author = {Smith, John},\n  ...\n}"}
                value={bibtex}
                onChange={(event) => setBibtex(event.target.value)}
                className="font-mono text-xs"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  disabled={importing || !bibtex.trim()}
                  onClick={importPasted}
                >
                  {importing ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : null}
                  Import
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={importing}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Upload .bib
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".bib,.bibtex,text/plain"
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) await onImportBibtex(await file.text());
                  }}
                />
              </div>
              <p className="text-[11px] leading-snug text-muted-foreground">
                Re-importing merges by cite key, so a corrected library updates
                the entries it covers and leaves the rest alone.
              </p>
            </div>

            <ScrollArea className="max-h-[40vh] pr-3">
              <ul className="divide-y divide-border/60">
                {draft.map((reference) => (
                  <li
                    key={reference.id}
                    className="flex items-start gap-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug text-foreground">
                        {reference.title || reference.literal || reference.id}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[authorSummary(reference), yearOf(reference), reference["container-title"]]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                      <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {reference.id}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${reference.id}`}
                      onClick={() => remove(reference.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </li>
                ))}
                {draft.length === 0 && (
                  <li className="py-4 text-sm text-muted-foreground">
                    Nothing here yet.
                  </li>
                )}
              </ul>
            </ScrollArea>

            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={save}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
