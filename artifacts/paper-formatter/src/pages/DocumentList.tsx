import { useLocation } from "wouter";
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

  const uploadFile = useCallback(
    async (file: File) => {
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
        setIsUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [queryClient, setLocation, toast],
  );

  // The command palette can ask for the picker; it lives here.
  useEffect(() => {
    const open = () => fileInputRef.current?.click();
    window.addEventListener("app:upload", open);
    return () => window.removeEventListener("app:upload", open);
  }, []);

  const handleDelete = async (id: number) => {
    try {
      await deleteDocument.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListDocumentsQueryKey() });
      toast({ title: "Manuscript deleted" });
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
        event.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(event) => {
        // Only clear when the pointer actually leaves the region, not when it
        // crosses onto a child element.
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className="mb-7 flex items-end justify-between gap-4">
        <div>
          <h1 className="type-display text-foreground">Workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {hasDocuments
              ? `${documents!.length} ${documents!.length === 1 ? "manuscript" : "manuscripts"}`
              : "Nothing here yet"}
          </p>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          className="hidden"
          accept={ACCEPT}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void uploadFile(file);
          }}
        />
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

      {isError ? (
        <div role="alert" className="rounded-md border border-border p-6 text-center">
          <p className="text-sm">We couldn't load your manuscripts. Please check your connection.</p>
          <Button variant="outline" className="mt-4" onClick={() => void refetch()}>Try again</Button>
        </div>
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </div>
      ) : hasDocuments ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {documents!.map((doc) => (
            <article
              key={doc.id}
              className="group relative flex cursor-pointer flex-col rounded-md border border-card-border bg-card transition-shadow hover:shadow-md"
              onClick={() => setLocation(`/documents/${doc.id}`)}
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
                    <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="-mr-1.5 -mt-1.5 h-7 w-7 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
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
                          void handleDelete(doc.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-3.5 w-3.5" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <h2 className="type-label line-clamp-2 leading-snug text-foreground transition-colors group-hover:text-brand">
                  {doc.title || "Untitled manuscript"}
                </h2>
                <p
                  className="mt-1 truncate text-xs text-muted-foreground"
                  title={doc.originalFilename || ""}
                >
                  {doc.originalFilename || "No source file"}
                </p>
              </div>

              <footer className="flex items-center justify-between border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {formatDistanceToNow(new Date(doc.updatedAt), { addSuffix: true })}
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
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
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
            {dragging ? "Drop it here" : "Start with a draft"}
          </span>
          <span className="mt-2 max-w-sm text-sm text-muted-foreground">
            Drop a PDF or Word file anywhere on this page, or click to choose one.
            Your paper is extracted into an editor and checked against the style
            you pick.
          </span>
        </button>
      )}

      {/* Drop target overlay for the populated state, so dragging onto a full
          workspace works the same as onto an empty one. */}
      {dragging && hasDocuments && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/70">
          <div className="rounded-md border border-dashed border-brand bg-card px-8 py-6 text-center">
            <Upload className="mx-auto mb-3 h-5 w-5 text-brand" />
            <p className="type-label text-foreground">Drop to add a manuscript</p>
            <p className="mt-1 text-xs text-muted-foreground">PDF or Word, up to 50MB</p>
          </div>
        </div>
      )}
    </div>
  );
}
