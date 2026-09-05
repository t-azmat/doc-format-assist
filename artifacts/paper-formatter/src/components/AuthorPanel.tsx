import { useEffect, useState } from "react";
import type { Affiliation, Author } from "@workspace/api-client-react";
import { ArrowDown, ArrowUp, Plus, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";

interface AuthorPanelProps {
  authors: Author[];
  affiliations: Affiliation[];
  onSave: (authors: Author[], affiliations: Affiliation[]) => void;
}

function newId(): string {
  return crypto.randomUUID();
}

/** Given/family joined for display; `literal` wins where it is set. */
export function displayName(author: Author): string {
  if (author.literal?.trim()) return author.literal.trim();
  const name = [author.given?.trim(), author.family?.trim()]
    .filter(Boolean)
    .join(" ");
  return author.suffix?.trim() ? `${name}, ${author.suffix.trim()}` : name;
}

function affiliationLabel(affiliation: Affiliation): string {
  return [
    affiliation.department,
    affiliation.organization,
    [affiliation.city, affiliation.country].filter(Boolean).join(", "),
  ]
    .filter(Boolean)
    .join(", ");
}

function emptyAuthor(): Author {
  return {
    id: newId(),
    given: "",
    family: "",
    affiliationIds: [],
    corresponding: false,
    equalContribution: false,
  };
}

function emptyAffiliation(): Affiliation {
  return { id: newId(), organization: "" };
}

function move<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * Authorship editor.
 *
 * Authors are metadata, not prose, precisely so the exporter can lay them out
 * per venue — an IEEE grid, an APA title page. That only works if there is
 * somewhere to enter them that is not the document body, which is this.
 *
 * Given and family names are separate fields rather than one "full name" box.
 * Splitting a name after the fact is unreliable (particles, double surnames,
 * mononyms), and citation rendering needs the parts.
 */
export function AuthorPanel({ authors, affiliations, onSave }: AuthorPanelProps) {
  const [open, setOpen] = useState(false);
  const [draftAuthors, setDraftAuthors] = useState<Author[]>(authors);
  const [draftAffiliations, setDraftAffiliations] =
    useState<Affiliation[]>(affiliations);

  // Re-seed the draft whenever the dialog opens, so a cancelled edit does not
  // linger and a change from elsewhere is picked up.
  useEffect(() => {
    if (open) {
      setDraftAuthors(authors);
      setDraftAffiliations(affiliations);
    }
  }, [open, authors, affiliations]);

  const updateAuthor = (id: string, patch: Partial<Author>) =>
    setDraftAuthors((list) =>
      list.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );

  const removeAffiliation = (id: string) => {
    setDraftAffiliations((list) => list.filter((a) => a.id !== id));
    // Drop the reference everywhere, or authors keep pointing at an
    // affiliation that no longer exists.
    setDraftAuthors((list) =>
      list.map((a) => ({
        ...a,
        affiliationIds: a.affiliationIds.filter((ref) => ref !== id),
      })),
    );
  };

  const toggleAffiliation = (author: Author, affiliationId: string) => {
    const has = author.affiliationIds.includes(affiliationId);
    updateAuthor(author.id, {
      affiliationIds: has
        ? author.affiliationIds.filter((ref) => ref !== affiliationId)
        : [...author.affiliationIds, affiliationId],
    });
  };

  const save = () => {
    // Drop rows the user added but never filled in.
    const cleanedAffiliations = draftAffiliations.filter((a) =>
      a.organization.trim(),
    );
    const live = new Set(cleanedAffiliations.map((a) => a.id));
    const cleanedAuthors = draftAuthors
      .filter((a) => displayName(a))
      .map((a) => ({
        ...a,
        affiliationIds: a.affiliationIds.filter((ref) => live.has(ref)),
      }));
    onSave(cleanedAuthors, cleanedAffiliations);
    setOpen(false);
  };

  const names = authors.map(displayName).filter(Boolean);

  return (
    <div className="rounded-md border border-border bg-background/60 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="type-eyebrow">Authorship</p>
          {names.length > 0 ? (
            <p className="type-label mt-1 leading-snug text-foreground">
              {names.join(", ")}
            </p>
          ) : (
            <p className="mt-1 text-xs leading-snug text-muted-foreground">
              No authors yet. Every venue formats these differently, so they are
              kept as data rather than typed into the page.
            </p>
          )}
          {affiliations.length > 0 && (
            <p className="mt-1.5 text-xs leading-snug text-muted-foreground">
              {affiliations.length} affiliation
              {affiliations.length === 1 ? "" : "s"}
            </p>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <Users className="mr-1.5 h-3.5 w-3.5" />
              Edit
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Authors and affiliations</DialogTitle>
              <DialogDescription>
                Order is the author order. The exporter lays these out to match
                the selected style.
              </DialogDescription>
            </DialogHeader>

            <ScrollArea className="max-h-[60vh] pr-3">
              <section className="space-y-3">
                {draftAuthors.map((author, index) => (
                  <div
                    key={author.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="mb-2 flex items-center gap-2">
                      <span className="type-eyebrow shrink-0">
                        Author {index + 1}
                      </span>
                      <div className="ml-auto flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Move author up"
                          disabled={index === 0}
                          onClick={() =>
                            setDraftAuthors((l) => move(l, index, index - 1))
                          }
                        >
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Move author down"
                          disabled={index === draftAuthors.length - 1}
                          onClick={() =>
                            setDraftAuthors((l) => move(l, index, index + 1))
                          }
                        >
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Remove author"
                          onClick={() =>
                            setDraftAuthors((l) =>
                              l.filter((a) => a.id !== author.id),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <Label htmlFor={`given-${author.id}`}>Given name</Label>
                        <Input
                          id={`given-${author.id}`}
                          value={author.given ?? ""}
                          onChange={(e) =>
                            updateAuthor(author.id, { given: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`family-${author.id}`}>Family name</Label>
                        <Input
                          id={`family-${author.id}`}
                          value={author.family ?? ""}
                          onChange={(e) =>
                            updateAuthor(author.id, { family: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`email-${author.id}`}>Email</Label>
                        <Input
                          id={`email-${author.id}`}
                          type="email"
                          value={author.email ?? ""}
                          onChange={(e) =>
                            updateAuthor(author.id, { email: e.target.value })
                          }
                        />
                      </div>
                      <div>
                        <Label htmlFor={`orcid-${author.id}`}>ORCID</Label>
                        <Input
                          id={`orcid-${author.id}`}
                          placeholder="https://orcid.org/0000-0000-0000-0000"
                          value={author.orcid ?? ""}
                          onChange={(e) =>
                            updateAuthor(author.id, { orcid: e.target.value })
                          }
                        />
                      </div>
                    </div>

                    {draftAffiliations.length > 0 && (
                      <div className="mt-3">
                        <p className="type-eyebrow mb-1.5">Affiliations</p>
                        <div className="space-y-1.5">
                          {draftAffiliations.map((affiliation) => (
                            <label
                              key={affiliation.id}
                              className="flex items-center gap-2 text-sm"
                            >
                              <Checkbox
                                checked={author.affiliationIds.includes(
                                  affiliation.id,
                                )}
                                onCheckedChange={() =>
                                  toggleAffiliation(author, affiliation.id)
                                }
                              />
                              <span className="text-muted-foreground">
                                {affiliationLabel(affiliation) ||
                                  "Untitled affiliation"}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-4">
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={author.corresponding}
                          onCheckedChange={(checked) =>
                            updateAuthor(author.id, {
                              corresponding: checked === true,
                            })
                          }
                        />
                        Corresponding author
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={author.equalContribution}
                          onCheckedChange={(checked) =>
                            updateAuthor(author.id, {
                              equalContribution: checked === true,
                            })
                          }
                        />
                        Contributed equally
                      </label>
                    </div>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraftAuthors((l) => [...l, emptyAuthor()])}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add author
                </Button>
              </section>

              <section className="mt-6 space-y-3">
                <p className="type-eyebrow">Affiliations</p>
                {draftAffiliations.map((affiliation) => (
                  <div
                    key={affiliation.id}
                    className="rounded-md border border-border p-3"
                  >
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <Label htmlFor={`org-${affiliation.id}`}>
                          Organization
                        </Label>
                        <Input
                          id={`org-${affiliation.id}`}
                          value={affiliation.organization}
                          onChange={(e) =>
                            setDraftAffiliations((list) =>
                              list.map((a) =>
                                a.id === affiliation.id
                                  ? { ...a, organization: e.target.value }
                                  : a,
                              ),
                            )
                          }
                        />
                      </div>
                      {(
                        [
                          ["department", "Department"],
                          ["city", "City"],
                          ["country", "Country"],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field}>
                          <Label htmlFor={`${field}-${affiliation.id}`}>
                            {label}
                          </Label>
                          <Input
                            id={`${field}-${affiliation.id}`}
                            value={affiliation[field] ?? ""}
                            onChange={(e) =>
                              setDraftAffiliations((list) =>
                                list.map((a) =>
                                  a.id === affiliation.id
                                    ? { ...a, [field]: e.target.value }
                                    : a,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="mt-2"
                      onClick={() => removeAffiliation(affiliation.id)}
                    >
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                      Remove
                    </Button>
                  </div>
                ))}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraftAffiliations((l) => [...l, emptyAffiliation()])
                  }
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add affiliation
                </Button>
              </section>
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
