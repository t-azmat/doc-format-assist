import { Link, useLocation } from "wouter";
import {
  FileText,
  CheckCircle2,
  Upload,
  Loader2,
  Clock,
  AlertTriangle,
  MoreVertical,
  Trash2,
} from "lucide-react";
import {
  useListDocuments,
  useDeleteDocument,
  getListDocumentsQueryKey,
  getUploadDocumentUrl,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useSampleManuscript } from "@/hooks/use-sample-manuscript";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useCallback, useEffect, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";

const ACCEPT =
  ".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Card-shaped placeholder, so the layout does not jump when data lands. */
function CardSkeleton() {
  return (
    <div className="rounded-md border border-card-border bg-card p-4">
      <div className="mb-3 h-3 w-16 animate-pulse rounded bg-muted" />
      <div className="mb-2 h-4 w-4/5 animate-pulse rounded bg-muted" />
      <div className="h-3 w-3/5 animate-pulse rounded bg-muted" />
      <div className="mt-6 h-3 w-24 animate-pulse rounded bg-muted" />
    </div>
  );
}

export default function DocumentList() {
  const [, setLocation] = useLocation();
  const { data: documents, isLoading, isError, refetch } = useListDocuments();
  const deleteDocument = useDeleteDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [uploadName, setUploadName] = useState("");
  const [pendingDelete, setPendingDelete] = useState<{
    id: number;
    title: string;
  } | null>(null);
  const busy = useRef(false);
  const sample = useSampleManuscript();
  const visible = (documents ?? []).filter(
    (doc) =>
      (filter === "all" || doc.status === filter) &&
      [
        doc.title,
        doc.originalFilename,
        doc.styleName,
        doc.documentClass,
        doc.conferenceStyle,
      ].some((value) =>
        value?.toLowerCase().includes(search.trim().toLowerCase()),
      ),
  );

  const uploadFile = useCallback(
    async (file: File) => {
      if (busy.current) return;
      if (
        !/\.(pdf|docx)$/i.test(file.name) ||
        !file.size ||
        file.size > 50 * 1024 * 1024
      ) {
        toast({
          title: "Choose a PDF or DOCX",
          description: "Use a non-empty PDF or Word document up to 50 MB.",
          variant: "destructive",
        });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      busy.current = true;
      setUploadName(file.name);
      setIsUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);

        const url =
          import.meta.env.BASE_URL + getUploadDocumentUrl().replace(/^\//, "");

        const response = await fetch(url, {
          method: "POST",
          // The session lives in a cookie; without this the upload is anonymous
          // and the server rejects it.
          credentials: "include",
          body: formData,
        });

        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.error || "Upload failed");
        }

        const newDoc = await response.json();
        queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
        setLocation(`/documents/${newDoc.id}`);
      } catch (error) {
        toast({
          title: "Couldn't read that file",
          description:
            error instanceof Error
              ? error.message
              : "Try a PDF or Word document under 50MB.",
          variant: "destructive",
        });
      } finally {
        busy.current = false;
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [queryClient, setLocation, toast],
  );

  // The command palette can ask for the picker; it lives here.
  useEffect(() => {
    const open = () => {
      if (!busy.current) fileInputRef.current?.click();
    };
    const protectUpload = (event: BeforeUnloadEvent) => {
      if (busy.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("app:upload", open);
    window.addEventListener("beforeunload", protectUpload);
    return () => {
      window.removeEventListener("app:upload", open);
      window.removeEventListener("beforeunload", protectUpload);
    };
  }, []);

  const handleDelete = async (id: number) => {
    if (deleteDocument.isPending) return;
    try {
      await deleteDocument.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      toast({ title: "Manuscript deleted" });
      setPendingDelete(null);
    } catch {
      toast({
        title: "Couldn't delete that manuscript",
        description: "It may already be gone. Refresh and try again.",
        variant: "destructive",
      });
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void uploadFile(file);
  };

  const hasDocuments = Boolean(documents && documents.length > 0);

  return (
    <div
      className="mx-auto w-full max-w-6xl flex-1 px-6 py-8"
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files") || busy.current) return;
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves the region, not when it
        // crosses onto a child element.
        if (
          !(event.relatedTarget instanceof Node) ||
          !event.currentTarget.contains(event.relatedTarget)
        ) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-2 font-mono text-xs uppercase tracking-wider text-brand">
            Your research desk
          </p>
          <h1 className="type-display text-foreground">Your manuscripts</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasDocuments
              ? `${documents!.length} ${documents!.length === 1 ? "manuscript" : "manuscripts"}`
              : "Start with a draft. We'll help you work through the details."}
          </p>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          aria-label="Upload manuscript"
          accept={ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
        {hasDocuments && (
          <Button
            variant="outline"
            size="sm"
            className="sm:ml-auto"
            disabled={isUploading || sample.creating}
            onClick={() => void sample.create()}
          >
            {sample.creating ? "Opening…" : "Open sample"}
          </Button>
        )}
        {hasDocuments && (
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            size="sm"
          >
            {isUploading ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Upload className="mr-1.5 h-3.5 w-3.5" />
            )}
            Add manuscript
          </Button>
        )}
      </div>

      {isUploading && (
        <div
          role="status"
          aria-live="polite"
          className="mb-6 flex items-start gap-3 rounded-lg border border-brand/30 bg-card p-5"
        >
          <Loader2 className="mt-1 h-5 w-5 shrink-0 animate-spin text-brand" />
          <div className="min-w-0">
            <p className="text-sm font-medium">Reading your manuscript…</p>
            <p className="mt-1 truncate text-sm text-muted-foreground">
              {uploadName}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              PDF extraction can take a few minutes. Keep this tab open; the
              editor will open when it's ready.
            </p>
          </div>
        </div>
      )}

      {hasDocuments && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <Input
            aria-label="Search manuscripts"
            placeholder="Search title, file, or style…"
            className="sm:max-w-sm"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div
            role="group"
            aria-label="Filter manuscripts"
            className="flex gap-1 rounded-md border border-border bg-card p-1"
          >
            {[
              ["all", "All drafts"],
              ["extracted", "Unformatted"],
              ["formatted", "Formatted"],
            ].map(([value, label]) => (
              <Button
                key={value}
                size="sm"
                variant={filter === value ? "secondary" : "ghost"}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {isError ? (
        <div
          role="alert"
          className="rounded-md border border-border p-6 text-center"
        >
          <p className="text-sm">
            We couldn't load your manuscripts. Please check your connection.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
          >
            Try again
          </Button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : hasDocuments ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {!visible.length && (
            <div className="col-span-full rounded-lg border border-dashed border-border bg-card p-10 text-center">
              <h2 className="text-base font-medium">No manuscripts match</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Try a different title or show all drafts.
              </p>
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setSearch("");
                  setFilter("all");
                }}
              >
                Clear filters
              </Button>
            </div>
          )}
          {visible.map((doc) => (
            <article
              key={doc.id}
              className="group relative flex flex-col rounded-lg border border-card-border bg-card transition-shadow hover:shadow-md"
              data-testid={`card-document-${doc.id}`}
            >
              <div className="flex-1 p-4">
                <div className="mb-2.5 flex items-start justify-between gap-2">
                  <span className="type-eyebrow">
                    {doc.styleName ??
                      (doc.conferenceStyle
                        ? doc.conferenceStyle.toUpperCase()
                        : "No style set")}
                  </span>

                  <DropdownMenu>
                    <DropdownMenuTrigger
                      asChild
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-1.5 -mt-1.5 h-8 w-8 text-muted-foreground"
                        aria-label={`Actions for ${doc.title}`}
                      >
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="text-destructive focus:bg-destructive/10 focus:text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete({ id: doc.id, title: doc.title });
                        }}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <h2 className="type-label line-clamp-2 leading-snug text-foreground transition-colors group-hover:text-brand">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="rounded-sm hover:text-brand hover:underline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    {doc.title || "Untitled manuscript"}
                  </Link>
                </h2>
                <p
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={doc.originalFilename || ""}
                >
                  {doc.originalFilename || "Created in your workspace"}
                </p>
              </div>

              <footer className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(doc.updatedAt), {
                    addSuffix: true,
                  })}
                </span>

                {doc.issueCount !== undefined && doc.issueCount > 0 ? (
                  <span className="flex items-center gap-1 text-warning">
                    <AlertTriangle className="h-3 w-3" />
                    {doc.issueCount} flagged
                  </span>
                ) : doc.status === "formatted" ? (
                  <span className="flex items-center gap-1 text-success">
                    <CheckCircle2 className="h-3 w-3" />
                    Formatted
                  </span>
                ) : null}
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <section
          className={`flex w-full flex-col items-center justify-center rounded-md border border-dashed px-6 py-16 text-center transition-colors ${
            dragging
              ? "border-brand bg-brand/5"
              : // bg-card, not card/40: at 40% the panel was within a couple of
                // percent of the board behind it and the whole target read as a
                // hole in the page rather than a surface.
                "border-muted-foreground/30 bg-card hover:border-brand/50"
          }`}
        >
          {isUploading ? (
            <Loader2 className="mb-4 h-6 w-6 animate-spin text-muted-foreground" />
          ) : (
            <FileText className="mb-4 h-6 w-6 text-muted-foreground" />
          )}
          <span className="type-section text-foreground">
            {dragging ? "Drop it here" : "Bring your first manuscript"}
          </span>
          <span className="mt-2 max-w-sm text-sm text-muted-foreground">
            Drop a PDF or Word file here. If you have the original DOCX, start
            there for the best chance of preserving its structure.
          </span>
          <div className="mt-6 flex flex-wrap justify-center gap-3">
            <Button
              disabled={isUploading || sample.creating}
              onClick={() => fileInputRef.current?.click()}
            >
              Choose manuscript
            </Button>
            <Button
              variant="outline"
              disabled={isUploading || sample.creating}
              onClick={() => void sample.create()}
            >
              {sample.creating ? "Opening sample…" : "Open a sample manuscript"}
            </Button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            PDF or DOCX · Up to 50 MB · The sample uses fictional content.
          </p>
        </section>
      )}

      {!hasDocuments && !isLoading && !isError && (
        <section
          aria-label="Getting started"
          className="mt-8 grid gap-5 sm:grid-cols-3"
        >
          {[
            [
              "01",
              "Review your draft",
              "Check imported text, equations, and figures against the original.",
            ],
            [
              "02",
              "Set your requirements",
              "Add your venue's instructions or choose a starting style.",
            ],
            [
              "03",
              "Preview and export",
              "Compare changes, apply them, and inspect the final Word or PDF file.",
            ],
          ].map(([step, title, text]) => (
            <div key={step} className="flex gap-3">
              <span className="mt-1 font-mono text-xs text-brand">{step}</span>
              <div>
                <h3 className="text-sm font-medium">{title}</h3>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {text}
                </p>
              </div>
            </div>
          ))}
        </section>
      )}

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteDocument.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this manuscript?</AlertDialogTitle>
            <AlertDialogDescription>
              “{pendingDelete?.title}” and its saved versions will be
              permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteDocument.isPending}>
              Keep manuscript
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteDocument.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                if (pendingDelete) void handleDelete(pendingDelete.id);
              }}
            >
              {deleteDocument.isPending ? "Deleting…" : "Delete manuscript"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Drop target overlay for the populated state, so dragging onto a full
          workspace works the same as onto an empty one. */}
      {dragging && hasDocuments && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70">
          <div className="rounded-md border border-dashed border-brand bg-card px-8 py-6 text-center">
            <Upload className="mx-auto mb-3 h-5 w-5 text-brand" />
            <p className="type-label text-foreground">
              Drop to add a manuscript
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              PDF or Word, up to 50MB
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
