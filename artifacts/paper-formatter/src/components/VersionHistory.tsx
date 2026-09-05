import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  listDocumentVersions,
  restoreDocumentVersion,
  type Document,
} from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export function VersionHistory({
  documentId,
  flush,
  onRestored,
}: {
  documentId: number;
  flush: () => Promise<number>;
  onRestored: (doc: Document) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [restoring, setRestoring] = useState(false);
  const { toast } = useToast();
  const versions = useQuery({
    queryKey: ["versions", documentId],
    queryFn: () => listDocumentVersions(documentId),
    enabled: open,
  });
  const restore = async () => {
    if (selected === null) return;
    setRestoring(true);
    try {
      const expectedRevision = await flush();
      const restored = await restoreDocumentVersion(documentId, selected, {
        expectedRevision,
      });
      onRestored(restored);
      await versions.refetch();
      setSelected(null);
      setOpen(false);
      toast({
        title: "Version restored",
        description: "Your previous draft is also saved in Versions.",
      });
    } catch (error) {
      toast({
        title: "Could not restore",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRestoring(false);
    }
  };
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-8"
        onClick={() => {
          setSelected(null);
          setOpen(true);
          void versions.refetch();
        }}
      >
        Versions
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!restoring) setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Saved versions</DialogTitle>
            <DialogDescription>
              Original drafts are saved before formatting and before restoring.
              The latest 50 are shown.
            </DialogDescription>
          </DialogHeader>
          {versions.isPending ? (
            <p className="text-sm">Loading versions…</p>
          ) : versions.isError ? (
            <Button variant="outline" onClick={() => void versions.refetch()}>
              Retry loading versions
            </Button>
          ) : !versions.data?.length ? (
            <p className="text-sm text-muted-foreground">
              No saved versions yet. Applying formatting creates the first one.
            </p>
          ) : (
            <div className="space-y-2">
              {versions.data.map((version) => (
                <label
                  key={version.id}
                  className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
                >
                  <input
                    type="radio"
                    name="version"
                    className="mt-1"
                    disabled={restoring}
                    checked={selected === version.id}
                    onChange={() => setSelected(version.id)}
                  />
                  <span className="text-sm">
                    {version.label}
                    <span className="block text-xs text-muted-foreground">
                      {new Date(version.createdAt).toLocaleString()}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          )}
          {selected !== null && (
            <div className="space-y-3 border-t border-border pt-3">
              <p className="text-sm">
                Restore this version's text, title, references, authors, and
                formatting? Your current draft will be saved first.
              </p>
              <Button disabled={restoring} onClick={() => void restore()}>
                {restoring ? "Restoring…" : "Save current draft and restore"}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
