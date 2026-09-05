import type { Document } from "@workspace/api-client-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatReview } from "@/lib/formatReview";

export function FormatReview({
  before,
  after,
  applying,
  onClose,
  onApply,
}: {
  before: Document;
  after: Document;
  applying: boolean;
  onClose: () => void;
  onApply: () => void;
}) {
  const { blocks, styles } = formatReview(before, after);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !applying) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] max-w-3xl overflow-y-auto"
        onEscapeKeyDown={(e) => {
          if (applying) e.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Review formatting</DialogTitle>
          <DialogDescription>
            Your manuscript has not changed. Applying these changes saves the
            original in Versions.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {blocks.length} content blocks and {styles.length} layout settings
          changed. {after.formattingIssues.length} formatting notes.
        </p>
        {before.documentClass !== after.documentClass && (
          <p className="text-sm">
            Document class: {before.documentClass ?? "Not set"} →{" "}
            {after.documentClass ?? "Not set"}
          </p>
        )}
        {styles.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <caption className="mb-2 text-left font-medium">
                Layout settings
              </caption>
              <thead>
                <tr>
                  <th className="p-2">Setting</th>
                  <th className="p-2">Before</th>
                  <th className="p-2">After</th>
                </tr>
              </thead>
              <tbody>
                {styles.map((style) => (
                  <tr key={style.name} className="border-t border-border">
                    <th className="p-2 font-normal">{style.name}</th>
                    <td className="p-2 break-words">{style.before}</td>
                    <td className="p-2 break-words">{style.after}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {blocks.map((block) => (
          <section
            key={block.position}
            className="rounded-md border border-border p-3"
          >
            <h3 className="mb-2 text-xs font-medium">
              Content block {block.position}
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">Before</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {block.before || "No text"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">After</p>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {block.after || "No text"}
                </p>
              </div>
            </div>
          </section>
        ))}
        <p className="text-xs text-muted-foreground">
          This comparison shows content and settings, not a rendered PDF. Review
          the exported file for final layout.
        </p>
        <DialogFooter>
          <Button variant="outline" disabled={applying} onClick={onClose}>
            Keep original
          </Button>
          <Button disabled={applying} onClick={onApply}>
            {applying ? "Applying…" : "Apply and save original"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
