import { useEffect, useRef, useState } from "react";
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type RenderTask,
} from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

GlobalWorkerOptions.workerSrc = workerUrl;

interface Snapshot {
  revision: number;
  title: string;
}
interface PreviewFile extends Snapshot {
  blob: Blob;
  url: string;
}

function PdfPages({ blob }: { blob: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(700);
  const [error, setError] = useState("");
  const [rendering, setRendering] = useState(true);
  const [pageText, setPageText] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    let loading: ReturnType<typeof getDocument> | undefined;
    void blob
      .arrayBuffer()
      .then(async (buffer) => {
        if (cancelled) return;
        loading = getDocument({ data: new Uint8Array(buffer), useWasm: false });
        const loaded = await loading.promise;
        if (!cancelled) setPdf(loaded);
      })
      .catch(() => {
        if (!cancelled)
          setError(
            "This PDF could not be displayed. You can still download the rendered file.",
          );
      });
    return () => {
      cancelled = true;
      void loading?.destroy().catch(() => {});
    };
  }, [blob]);

  useEffect(() => {
    const node = host.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, entry.contentRect.width - 32)),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task: RenderTask | undefined;
    const surface = canvas.current;
    setRendering(true);
    setError("");
    setPageText("");
    void pdf
      .getPage(page)
      .then(async (current) => {
        if (cancelled) return;
        const natural = current.getViewport({ scale: 1 });
        const scale = (Math.min(width, 1000) / natural.width) * zoom;
        const viewport = current.getViewport({ scale });
        const ratio = Math.min(
          window.devicePixelRatio || 1,
          2,
          Math.sqrt(16_000_000 / (viewport.width * viewport.height)),
        );
        surface.width = Math.floor(viewport.width * ratio);
        surface.height = Math.floor(viewport.height * ratio);
        surface.style.width = `${viewport.width}px`;
        surface.style.height = `${viewport.height}px`;
        task = current.render({
          canvas: surface,
          viewport,
          transform: [ratio, 0, 0, ratio, 0, 0],
        });
        await task.promise;
        if (!cancelled) setRendering(false);
        const text = await current.getTextContent();
        if (!cancelled)
          setPageText(
            text.items.map((item) => ("str" in item ? item.str : "")).join(" "),
          );
      })
      .catch((error) => {
        if (!cancelled && error?.name !== "RenderingCancelledException") {
          setRendering(false);
          setError(
            "This page could not be displayed. Try another page or download the PDF.",
          );
        }
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width, zoom]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            disabled={!pdf || page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous page
          </Button>
          <span role="status" className="text-sm">
            {pdf ? `Page ${page} of ${pdf.numPages}` : "Opening PDF..."}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next page
          </Button>
        </div>
        <label className="text-sm">
          Zoom{" "}
          <select
            aria-label="PDF zoom"
            className="rounded border border-border bg-background p-1"
            value={zoom}
            onChange={(e) => setZoom(Number(e.target.value))}
          >
            <option value={1}>Fit width</option>
            <option value={1.5}>150%</option>
            <option value={2}>200%</option>
          </select>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div
        ref={host}
        className="min-h-64 overflow-auto rounded border border-border bg-muted p-4"
        aria-busy={rendering && !error}
      >
        {rendering && !error && (
          <p className="mb-2 text-xs text-muted-foreground">
            Rendering page...
          </p>
        )}
        <canvas
          ref={canvas}
          role="img"
          aria-label={`Rendered PDF page ${page}`}
          className="mx-auto bg-white shadow-sm"
        />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer">Read page text</summary>
        <p className="mt-2 whitespace-pre-wrap">
          {pageText || "No selectable text available on this page."}
        </p>
      </details>
    </>
  );
}

export default function ExportPreview({
  documentId,
  currentRevision,
  dirty,
  prepare,
  onClose,
}: {
  documentId: number;
  currentRevision: number;
  dirty: boolean;
  prepare: () => Promise<Snapshot>;
  onClose: () => void;
}) {
  const [file, setFile] = useState<PreviewFile | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const prepareRef = useRef(prepare);
  prepareRef.current = prepare;
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setBusy(true);
    setError("");
    setFile(null);
    void (async () => {
      const snapshot = await prepareRef.current();
      if (controller.signal.aborted) return;
      const response = await fetch(
        `${import.meta.env.BASE_URL}api/documents/${documentId}/export?format=pdf&expectedRevision=${snapshot.revision}`,
        { credentials: "include", signal: controller.signal },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(
          body.error || "Could not render a PDF. Please try again.",
        );
      }
      if (
        response.headers.get("X-Document-Revision") !==
        String(snapshot.revision)
      )
        throw new Error(
          "The export snapshot could not be verified. Refresh the app and try again.",
        );
      const blob = await response.blob();
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setFile({ ...snapshot, blob, url: objectUrl });
    })()
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error.message || "Could not render the PDF.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, attempt]);
  const stale = !!file && (file.revision !== currentRevision || dirty);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[94dvh] w-[96vw] max-w-5xl flex-col overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export preview</DialogTitle>
          <DialogDescription>
            This is the rendered PDF, including its actual page breaks. Download
            PDF saves the exact file shown here. Word may paginate differently
            when opened on another system.
          </DialogDescription>
        </DialogHeader>
        {busy && (
          <p role="status" className="py-8 text-sm">
            Saving your draft and rendering its PDF...
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {file && (
          <>
            <p className="text-xs text-muted-foreground">
              Rendered draft revision {file.revision}
            </p>
            {stale && (
              <p
                role="alert"
                className="rounded border border-warning p-3 text-sm"
              >
                Your draft has changed. Refresh the preview before downloading
                the latest version.
              </p>
            )}
            <PdfPages key={file.url} blob={file.blob} />
          </>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setAttempt((n) => n + 1)}
          >
            {error ? "Try again" : "Refresh preview"}
          </Button>
          {file && (
            <Button asChild disabled={stale}>
              <a
                href={stale ? undefined : file.url}
                aria-disabled={stale}
                onClick={(e) => {
                  if (stale) e.preventDefault();
                }}
                download={`${file.title.replace(/[\\/:*?"<>|]/g, "-") || "manuscript"}.pdf`}
              >
                Download PDF
              </a>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
