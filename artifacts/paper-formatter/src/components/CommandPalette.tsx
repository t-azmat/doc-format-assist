import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import {
  FileText,
  Moon,
  Sun,
  Plus,
  LogOut,
  Library,
} from "lucide-react";
import {
  useListDocuments,
  getListDocumentsQueryKey,
} from "@workspace/api-client-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { useTheme } from "@/components/ThemeProvider";
import { useAuth } from "@/lib/auth";

/**
 * Keyboard entry point to the whole app.
 *
 * Once someone has more than a handful of manuscripts, the list page stops
 * being a good way to reach one. This is the fast path — and it costs almost
 * nothing, since cmdk is already vendored.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();
  const { resolved, setTheme } = useTheme();
  const { user, logout } = useAuth();
  const { data: documents } = useListDocuments({
    query: { enabled: Boolean(user), queryKey: getListDocumentsQueryKey() },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  if (!user) return null;

  const run = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search manuscripts, or type a command" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        {documents && documents.length > 0 && (
          <CommandGroup heading="Manuscripts">
            {documents.slice(0, 8).map((document) => (
              <CommandItem
                key={document.id}
                value={`${document.title} ${document.originalFilename ?? ""}`}
                onSelect={() => run(() => setLocation(`/documents/${document.id}`))}
              >
                <FileText className="mr-2 h-4 w-4 text-muted-foreground" />
                <span className="truncate">{document.title}</span>
                {document.styleName && (
                  <span className="ml-auto type-eyebrow">{document.styleName}</span>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandSeparator />

        <CommandGroup heading="Actions">
          <CommandItem value="workspace all manuscripts" onSelect={() => run(() => setLocation("/"))}>
            <Library className="mr-2 h-4 w-4 text-muted-foreground" />
            Go to workspace
          </CommandItem>
          <CommandItem
            value="upload new manuscript"
            onSelect={() =>
              run(() => {
                setLocation("/");
                // The list page owns the file input; let it mount before asking.
                requestAnimationFrame(() =>
                  window.dispatchEvent(new CustomEvent("app:upload")),
                );
              })
            }
          >
            <Plus className="mr-2 h-4 w-4 text-muted-foreground" />
            Upload a manuscript
          </CommandItem>
          <CommandItem
            value="theme dark light appearance"
            onSelect={() => run(() => setTheme(resolved === "dark" ? "light" : "dark"))}
          >
            {resolved === "dark" ? (
              <Sun className="mr-2 h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="mr-2 h-4 w-4 text-muted-foreground" />
            )}
            Switch to {resolved === "dark" ? "light" : "dark"} theme
          </CommandItem>
          <CommandItem value="sign out log out" onSelect={() => run(() => void logout())}>
            <LogOut className="mr-2 h-4 w-4 text-muted-foreground" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
