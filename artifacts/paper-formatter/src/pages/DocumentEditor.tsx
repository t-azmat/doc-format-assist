import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRoute, Link } from "wouter";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Typography from "@tiptap/extension-typography";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import { MathBlock, MathInline } from "@/lib/mathNodes";
import { Citation } from "@/lib/citationNode";
import { EditorToolbar } from "@/components/EditorToolbar";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetDocument,
  getGetDocumentQueryKey,
  updateDocument,
  type DocumentUpdate,
  useAnalyzeDocument,
  useListDocumentClasses,
  getExportDocumentUrl,
  type Author,
  type Affiliation,
  type DocumentClass,
  type Reference,
  type Document,
  type StyleSpec,
} from "@workspace/api-client-react";
import {
  Loader2,
  ChevronLeft,
  Wand2,
  Sparkles,
  Download,
  AlertCircle,
  Upload,
  FileText,
  ScanLine,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { SpecSheet } from "@/components/SpecSheet";
import { AuthorPanel } from "@/components/AuthorPanel";
import { ClassSuggestionBanner } from "@/components/ClassSuggestionBanner";
import { ReferencePanel } from "@/components/ReferencePanel";
import { IssueList } from "@/components/IssueList";
import { PageMeter, PX_PER_INCH } from "@/components/PageMeter";
import { Autosave } from "@/lib/autosave";
import { SaveStatus, type SaveState } from "@/components/SaveStatus";

// guidelinesText and styleSpec are part of the OpenAPI contract, so these are
// aliases onto the generated types rather than hand-written stand-ins.
type GuidelinesFields = Pick<Document, "guidelinesText" | "styleSpec">;

// Mirrors _FAMILY_DEFAULT in docclass.py: the shortest genre in each family, so
// an unstated genre never silently relaxes a page limit the user is bound by.
const LEGACY_CLASS_FOR_STYLE: Record<string, string> = {
  ieee: "ieee-conference",
  acm: "acm-conference",
  apa: "apa-journal",
};

const GUIDELINES_ACCEPT = ".txt,.md,.markdown,.yaml,.yml,.pdf,.docx,.doc";
const AUTOSAVE_DELAY_MS = 1000;
const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5] as const;

// Mirror the app's existing fetch convention (see DocumentList upload/export):
// prefix the base path, API paths already start with "/api".
const apiUrl = (path: string) =>
  import.meta.env.BASE_URL + path.replace(/^\//, "");

export default function DocumentEditor() {
  const [, params] = useRoute("/documents/:id");
  const documentId = parseInt(params?.id || "0", 10);

  const { data: document, isLoading, error } = useGetDocument(documentId, {
    query: { enabled: !!documentId, queryKey: getGetDocumentQueryKey(documentId) },
  });

  const { data: documentClasses } = useListDocumentClasses();
  const analyzeDoc = useAnalyzeDocument();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [title, setTitle] = useState("");
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [guidelines, setGuidelines] = useState("");
  const [applyingGuidelines, setApplyingGuidelines] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const [pageView, setPageView] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [pageLimit, setPageLimit] = useState<number | null>(null);
  const [suggestionDismissed, setSuggestionDismissed] = useState(false);
  const [importingBibtex, setImportingBibtex] = useState(false);
  const guidelinesFileRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const activeClass: DocumentClass | undefined = documentClasses?.find(
    (candidate) => candidate.id === selectedClass,
  );

  // A limit read from the user's own guidelines beats the class preset: their
  // call for papers is more specific than any preset can be.
  const effectiveBudget = document?.pageBudget ?? activeClass?.pageBudget ?? null;

  // Adopt that limit when it changes. Keyed on the value rather than run every
  // render, so a limit the user typed in by hand survives — until the venue's
  // own rule changes, which is a new rule.
  const budgetAppliedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedClass && !effectiveBudget) return;
    const key = `${selectedClass}:${effectiveBudget?.maxPages ?? ""}`;
    if (budgetAppliedFor.current === key) return;
    budgetAppliedFor.current = key;
    setPageLimit(effectiveBudget?.maxPages ?? null);
  }, [selectedClass, effectiveBudget]);

  // Refs for tracking initialization and auto-save
  const initializedForId = useRef<number | null>(null);
  const lastSavedTitle = useRef("");
  const lastSavedContent = useRef<unknown>(null);

  // TipTap builds its handlers once, so anything read inside onUpdate has to
  // come from a ref or it will still refer to the first document opened.
  const documentIdRef = useRef(documentId);
  documentIdRef.current = documentId;

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const autosave = useMemo(() => new Autosave<DocumentUpdate>(
    async (patch) => {
      await updateDocument(documentId, patch);
      if (patch.title !== undefined) lastSavedTitle.current = patch.title;
      if (patch.editorContent !== undefined) lastSavedContent.current = patch.editorContent;
      queryClient.setQueryData(getGetDocumentQueryKey(documentId), (old: Document | undefined) =>
        old ? { ...old, ...patch } : old,
      );
    },
    (state) => {
      setSaveState(state);
      if (state === "saved") setSavedAt(Date.now());
    },
    AUTOSAVE_DELAY_MS,
  ), [documentId, queryClient]);
  const saveContentNow = useCallback(() => {
    void autosave.flush().catch(() => {});
  }, [autosave]);

  const saveAuthorship = useCallback(
    (authors: Author[], affiliations: Affiliation[]) => {
      autosave.schedule({ authors, affiliations });
      void autosave.flush().catch(() => {});
    },
    [autosave],
  );

  const saveReferences = useCallback(
    (references: Reference[]) => {
      autosave.schedule({ references });
      void autosave.flush().catch(() => {});
    },
    [autosave],
  );

  const importBibtex = useCallback(
    async (bibtex: string) => {
      setImportingBibtex(true);
      try {
        await autosave.flush();
        const id = documentIdRef.current;
        const res = await fetch(apiUrl(`/api/documents/${id}/references/bibtex`), {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bibtex }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Could not read that BibTeX.");
        }
        const updated = await res.json();
        queryClient.setQueryData(getGetDocumentQueryKey(id), updated);
        toast({
          title: "References imported",
          description: `${updated.references?.length ?? 0} in the library.`,
        });
      } catch (err: any) {
        toast({
          title: "Import failed",
          description: err.message,
          variant: "destructive",
        });
      } finally {
        setImportingBibtex(false);
      }
    },
    [autosave, queryClient, toast],
  );

  const scheduleContentSave = useCallback(
    (json: unknown) => autosave.schedule({ editorContent: json }),
    [autosave],
  );

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (autosave.isDirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      void autosave.flush().catch(() => {});
    };
  }, [autosave]);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Typography,
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      // Registered so extracted equations survive a load/save cycle — an
      // unknown node type is dropped by the schema, and autosave would then
      // write the loss back to the server.
      MathInline,
      MathBlock,
      Citation,
    ],
    content: "",
    editorProps: {
      attributes: {
        // No `dark:prose-invert`. The manuscript sheet is white paper in both
        // themes, so inverting prose in dark mode set --tw-prose-bold to white
        // and every bold run — the abstract, index terms — turned white on
        // white and disappeared. The two surfaces set their own prose colors in
        // index.css instead: .doc-page always paper, .doc-plain theme-aware.
        class: "prose prose-stone max-w-none focus:outline-none",
      },
    },
    onUpdate: ({ editor }) => {
      scheduleContentSave(editor.getJSON());
    },
  });

  // Initialize data
  useEffect(() => {
    if (document && editor && initializedForId.current !== document.id) {
      initializedForId.current = document.id;
      setTitle(document.title);
      // Documents predating classes carry only a conferenceStyle; show the
      // family's default class so the picker is never blank for them.
      setSelectedClass(
        document.documentClass ||
          (document.conferenceStyle
            ? LEGACY_CLASS_FOR_STYLE[document.conferenceStyle]
            : "") ||
          "",
      );
      setGuidelines((document as GuidelinesFields).guidelinesText || "");
      setSuggestionDismissed(false);
      setSaveState("saved");
      setSavedAt(null);

      lastSavedTitle.current = document.title;
      lastSavedContent.current = document.editorContent;

      if (document.editorContent) {
        // Loading the server's copy is not a user edit — emitting an update
        // here would schedule an autosave that immediately writes the document
        // back to the server on every page load.
        editor.commands.setContent(document.editorContent, { emitUpdate: false });
      }
    }
  }, [document, editor, documentId]);

  const applyUpdatedDoc = (updatedDoc: any) => {
    queryClient.setQueryData(getGetDocumentQueryKey(documentId), updatedDoc);
    if (updatedDoc.editorContent && editor) {
      editor.commands.setContent(updatedDoc.editorContent, { emitUpdate: false });
      lastSavedContent.current = updatedDoc.editorContent;
      setSaveState("saved");
      setSavedAt(Date.now());
    }
  };

  // Format using whichever style the document has: an explicitly selected
  // preset wins; otherwise the guidelines-derived spec stored on the document.
  const handleFormat = async () => {
    const hasGuidelines = Boolean((document as GuidelinesFields | undefined)?.styleSpec);
    if (!selectedClass && !hasGuidelines) {
      toast({
        title: "Nothing to format with",
        description: "Apply guidelines or select a document class first.",
        variant: "destructive",
      });
      return;
    }

    setFormatting(true);
    editor?.setEditable(false);
    try {
      await autosave.flush();
      const body = selectedClass ? { documentClass: selectedClass } : {};
      const res = await fetch(apiUrl(`/api/documents/${documentId}/format`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Formatting failed.");
      }
      const updated = await res.json();
      applyUpdatedDoc(updated);
      toast({
        title: "Formatted",
        description: selectedClass
          ? "Applied the selected document class."
          : "Applied your guidelines.",
      });
    } catch (err: any) {
      toast({
        title: "Formatting failed",
        description: err.message ?? "Could not apply the style.",
        variant: "destructive",
      });
    } finally {
      setFormatting(false);
      editor?.setEditable(true);
    }
  };

  const applyGuidelinesText = async () => {
    if (!guidelines.trim()) {
      toast({
        title: "No guidelines",
        description: "Type or paste some formatting guidelines first.",
        variant: "destructive",
      });
      return;
    }
    setApplyingGuidelines(true);
    try {
      const res = await fetch(apiUrl(`/api/documents/${documentId}/guidelines`), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ guidelines }),
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Could not apply guidelines.");
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetDocumentQueryKey(documentId), updated);
      // The class is deliberately left alone: guidelines override typography,
      // but they say nothing about genre. A dissertation is still a
      // dissertation after pasting a call for papers.
      toast({
        title: "Guidelines applied",
        description: "Run Format to reformat the manuscript to match them.",
      });
    } catch (err: any) {
      toast({
        title: "Could not apply guidelines",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setApplyingGuidelines(false);
    }
  };

  const applyGuidelinesFile = async (file: File) => {
    setApplyingGuidelines(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(apiUrl(`/api/documents/${documentId}/guidelines/file`), {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || "Could not read that guidelines file.");
      }
      const updated = await res.json();
      queryClient.setQueryData(getGetDocumentQueryKey(documentId), updated);
      setGuidelines((updated as GuidelinesFields).guidelinesText || "");
      toast({
        title: "Guidelines loaded",
        description: "Run Format to apply them.",
      });
    } catch (err: any) {
      toast({
        title: "Could not read guidelines file",
        description: err.message,
        variant: "destructive",
      });
    } finally {
      setApplyingGuidelines(false);
      if (guidelinesFileRef.current) guidelinesFileRef.current.value = "";
    }
  };

  const handleAnalyze = async () => {
    try {
      await autosave.flush();
    } catch {
      toast({ title: "Save failed", description: "Retry saving before running a check.", variant: "destructive" });
      return;
    }
    analyzeDoc.mutate(
      { id: documentId },
      {
        onSuccess: (updatedDoc) => {
          queryClient.setQueryData(getGetDocumentQueryKey(documentId), updatedDoc);
          const count = updatedDoc.formattingIssues.length;
          toast({
            title: "Check complete",
            description:
              count === 0
                ? "Nothing flagged."
                : `Flagged ${count} ${count === 1 ? "issue" : "issues"}.`,
          });
        },
        onError: (err: any) => {
          if (err.status === 422) {
            toast({
              title: "Check unavailable",
              description:
                "The AI check needs an OpenAI API key configured on the server.",
              variant: "destructive",
            });
          } else {
            toast({
              title: "Check failed",
              description: "Something went wrong reading this manuscript.",
              variant: "destructive",
            });
          }
        },
      },
    );
  };

  const [exporting, setExporting] = useState(false);
  const handleExport = async (format: "docx" | "pdf") => {
    setExporting(true);
    try {
      await autosave.flush();
      const response = await fetch(`${apiUrl(getExportDocumentUrl(documentId))}?format=${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || "Export failed. Please try again.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[\\/:*?"<>|]/g, "-") || "manuscript"}.${format}`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      toast({ title: "Could not export", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setExporting(false);
    }
  };

  const styleSpec: StyleSpec | null =
    (document as GuidelinesFields | undefined)?.styleSpec ?? null;

  // Effective values for the page preview — the document's resolved spec, with
  // sensible fallbacks for anything not yet set.
  const eff = useMemo(() => {
    const margins = styleSpec?.margins_in ?? {};
    return {
      font: styleSpec?.body_font ?? "Times New Roman",
      size: styleSpec?.body_size_pt ?? 12,
      line: styleSpec?.line_spacing ?? 1.5,
      cols: styleSpec?.columns ?? 1,
      widthIn: styleSpec?.page_width_in ?? 8.5,
      heightIn: styleSpec?.page_height_in ?? 11,
      top: margins.top ?? 1,
      right: margins.right ?? 1,
      bottom: margins.bottom ?? 1,
      left: margins.left ?? 1,
    };
  }, [styleSpec]);

  // Printable height of one sheet, in CSS pixels — drives both the page count
  // and where the break markers land.
  const printableHeightPx = Math.max(
    (eff.heightIn - eff.top - eff.bottom) * PX_PER_INCH,
    1,
  );

  const [contentHeight, setContentHeight] = useState(0);

  // A callback ref, not an effect keyed on [pageView, editor].
  //
  // The editor instance exists before the document finishes loading, so an
  // effect with those deps runs exactly once — while the component is still
  // rendering its loading state and the sheet is not in the DOM. It bailed on a
  // null ref and never re-ran, which left the page count at 0.0 and suppressed
  // every break marker. A callback ref fires when the node actually mounts.
  const contentObserver = useRef<ResizeObserver | null>(null);
  const setContentNode = useCallback((node: HTMLDivElement | null) => {
    contentObserver.current?.disconnect();
    contentRef.current = node;
    if (!node) {
      setContentHeight(0);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setContentHeight(entry.contentRect.height);
    });
    observer.observe(node);
    setContentHeight(node.getBoundingClientRect().height);
    contentObserver.current = observer;
  }, []);

  useEffect(() => () => contentObserver.current?.disconnect(), []);

  const breakCount = Math.max(
    0,
    Math.ceil(contentHeight / printableHeightPx) - 1,
  );

  const hsz = styleSpec?.heading_sizes_pt ?? {};
  const pageStyle = {
    "--doc-w": `${eff.widthIn}in`,
    "--doc-h": `${eff.heightIn}in`,
    "--doc-pt": `${eff.top}in`,
    "--doc-pr": `${eff.right}in`,
    "--doc-pb": `${eff.bottom}in`,
    "--doc-pl": `${eff.left}in`,
    "--doc-cols": String(eff.cols),
    "--doc-font": eff.font,
    "--doc-size": `${eff.size}pt`,
    "--doc-line": String(eff.line),
    "--doc-h1": `${hsz["1"] ?? eff.size + 4}pt`,
    "--doc-h2": `${hsz["2"] ?? eff.size + 1}pt`,
    "--doc-h3": `${hsz["3"] ?? eff.size}pt`,
  } as CSSProperties;

  const issues = document?.formattingIssues ?? [];

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <p className="text-xs">Opening manuscript</p>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-sm text-center">
          <AlertCircle className="mx-auto mb-4 h-6 w-6 text-muted-foreground" />
          <h2 className="type-section text-foreground">
            That manuscript isn't here
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            It may have been deleted, or it belongs to another account.
          </p>
          <Button asChild variant="outline" className="mt-5">
            <Link href="/">Back to workspace</Link>
          </Button>
        </div>
      </div>
    );
  }

  const zoomIndex = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden lg:flex-row">
      {/* ---------------------------------------------------------------- */}
      {/* Manuscript                                                        */}
      {/* ---------------------------------------------------------------- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                asChild
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground"
              >
                <Link href="/" aria-label="Back to workspace">
                  <ChevronLeft className="h-4 w-4" />
                </Link>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Back to workspace</TooltipContent>
          </Tooltip>

          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); autosave.schedule({ title: e.target.value }); }}
            disabled={formatting}
            className="h-8 w-full max-w-md border-transparent bg-transparent px-2 text-sm font-medium shadow-none focus-visible:border-input"
            placeholder="Untitled manuscript"
            aria-label="Manuscript title"
          />

          <div className="ml-auto flex items-center gap-2">
            <SaveStatus
              state={saveState}
              savedAt={savedAt}
              onRetry={saveContentNow}
            />

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8" disabled={exporting || formatting}>
                  <Download className="mr-1.5 h-3.5 w-3.5" />
                  {exporting ? "Exporting?" : "Export"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => handleExport("docx")}>
                  Word document (.docx)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleExport("pdf")}>
                  PDF (.pdf)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <EditorToolbar editor={editor} />

        <ScrollArea className="flex-1 bg-background">
          {pageView ? (
            <div className="doc-stage" style={{ "--doc-zoom": zoom } as CSSProperties}>
              <div className="doc-frame">
                <div className="doc-page" style={pageStyle}>
                  <div ref={setContentNode}>
                    <EditorContent editor={editor} />
                  </div>

                  {/* Where the paper actually runs out. The sheet is one
                      continuous node — TipTap cannot be split across elements —
                      so these are markers over the flow. */}
                  {Array.from({ length: breakCount }, (_, index) => (
                    <div
                      key={index}
                      className="doc-break"
                      style={{
                        top: `calc(${eff.top}in + ${
                          (index + 1) * printableHeightPx
                        }px)`,
                      }}
                    >
                      <span>page {index + 2}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex justify-center px-6 py-10">
              <div className="doc-plain">
                <EditorContent editor={editor} />
              </div>
            </div>
          )}
        </ScrollArea>

        {/* Status bar: length, and how the page is being shown. */}
        <div className="flex h-9 shrink-0 items-center gap-4 border-t border-border bg-card px-3">
          {pageView ? (
            <PageMeter
              pages={contentHeight / printableHeightPx}
              limit={pageLimit}
              onLimitChange={setPageLimit}
              budget={effectiveBudget}
            />
          ) : (
            <span className="type-measure text-muted-foreground">Draft view</span>
          )}

          <div className="ml-auto flex items-center gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant={pageView ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setPageView((v) => !v)}
                >
                  {pageView ? (
                    <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                  ) : (
                    <FileText className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {pageView ? "Page" : "Draft"}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                {pageView
                  ? "Showing the paper at its real trim size"
                  : "Showing a plain writing surface"}
              </TooltipContent>
            </Tooltip>

            {pageView && (
              <div className="ml-1 flex items-center gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  disabled={zoomIndex <= 0}
                  onClick={() => setZoom(ZOOM_STEPS[Math.max(zoomIndex - 1, 0)])}
                  aria-label="Zoom out"
                >
                  <Minus className="h-3.5 w-3.5" />
                </Button>
                <span className="type-measure w-10 text-center text-muted-foreground">
                  {Math.round(zoom * 100)}%
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 text-muted-foreground"
                  disabled={zoomIndex >= ZOOM_STEPS.length - 1}
                  onClick={() =>
                    setZoom(ZOOM_STEPS[Math.min(zoomIndex + 1, ZOOM_STEPS.length - 1)])
                  }
                  aria-label="Zoom in"
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Spec rail                                                         */}
      {/* ---------------------------------------------------------------- */}
      <aside className="flex w-full shrink-0 flex-col border-t border-border bg-card lg:w-[21rem] lg:border-l lg:border-t-0 xl:w-[23rem]">
        <ScrollArea className="flex-1">
          <div className="border-b border-border p-4">
            <p className="type-eyebrow">Your guidelines</p>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              Describe the required format in plain English, or as{" "}
              <code className="font-mono text-[11px] text-foreground">key: value</code>{" "}
              lines. Anything you leave out keeps its default.
            </p>

            <Textarea
              value={guidelines}
              onChange={(e) => setGuidelines(e.target.value)}
              placeholder={
                "12pt Times New Roman, double-spaced\n1in margins, single column\nTitle Case headings, numeric citations\nSections: abstract, introduction, references"
              }
              className="mt-2.5 min-h-[110px] resize-y bg-background font-mono text-xs leading-relaxed"
            />

            <div className="mt-2 grid grid-cols-2 gap-2">
              <Button
                size="sm"
                className="h-8"
                disabled={applyingGuidelines}
                onClick={applyGuidelinesText}
              >
                {applyingGuidelines ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                )}
                Apply
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={applyingGuidelines}
                onClick={() => guidelinesFileRef.current?.click()}
              >
                <Upload className="mr-1.5 h-3.5 w-3.5" />
                From file
              </Button>
              <input
                ref={guidelinesFileRef}
                type="file"
                accept={GUIDELINES_ACCEPT}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) applyGuidelinesFile(f);
                }}
              />
            </div>

            <div className="mt-4 space-y-2">
              <Label
                htmlFor="style-select"
                className="type-eyebrow block"
              >
                Or a document class
              </Label>

              {/* Offered, never applied — see ClassSuggestionBanner. Hidden
                  once the user has chosen for themselves. */}
              {!document.documentClass &&
                document.suggestedClass &&
                !suggestionDismissed &&
                document.suggestedClass.classId !== selectedClass && (
                  <div className="mb-2">
                    <ClassSuggestionBanner
                      suggestion={document.suggestedClass}
                      classes={documentClasses}
                      onAccept={(classId) => {
                        setSelectedClass(classId);
                        setSuggestionDismissed(true);
                      }}
                      onDismiss={() => setSuggestionDismissed(true)}
                    />
                  </div>
                )}
              <Select
                value={selectedClass}
                onValueChange={setSelectedClass}
              >
                <SelectTrigger id="style-select" className="h-8 w-full bg-background text-xs">
                  <SelectValue placeholder="None selected" />
                </SelectTrigger>
                <SelectContent>
                  {documentClasses?.map((documentClass) => (
                    <SelectItem key={documentClass.id} value={documentClass.id}>
                      {documentClass.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                className="h-8"
                disabled={formatting || (!selectedClass && !styleSpec)}
                onClick={handleFormat}
              >
                {formatting ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" />
                )}
                Format
              </Button>
              <Button
                variant="secondary"
                className="h-8"
                disabled={analyzeDoc.isPending}
                onClick={handleAnalyze}
              >
                {analyzeDoc.isPending ? (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ScanLine className="mr-1.5 h-3.5 w-3.5" />
                )}
                Check
              </Button>
            </div>
          </div>

          {styleSpec && (
            <div className="border-b border-border p-4">
              <SpecSheet spec={styleSpec} />
            </div>
          )}

          <div className="border-b border-border p-4">
            <AuthorPanel
              authors={document.authors ?? []}
              affiliations={document.affiliations ?? []}
              onSave={saveAuthorship}
            />
          </div>

          <div className="border-b border-border p-4">
            <ReferencePanel
              references={document.references ?? []}
              onSave={saveReferences}
              onImportBibtex={importBibtex}
              importing={importingBibtex}
            />
          </div>

          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <p className="type-eyebrow">Compliance</p>
            {issues.length > 0 && (
              <span className="type-measure text-muted-foreground">
                {issues.length}
              </span>
            )}
          </div>

          <IssueList issues={issues} editor={editor} />
        </ScrollArea>
      </aside>
    </div>
  );
}
