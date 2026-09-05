import { useEffect, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

export type SaveState = "saved" | "saving" | "dirty" | "error";

interface SaveStatusProps {
  state: SaveState;
  savedAt: number | null;
  onRetry?: () => void;
}

function relative(timestamp: number, now: number): string {
  const seconds = Math.round((now - timestamp) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

/**
 * Honest autosave state.
 *
 * What was here before was a spinner bound to `isPending`, which meant it
 * flashed for a few hundred milliseconds and then showed nothing — leaving no
 * way to tell "saved" apart from "never saved". Unsaved work is exactly the
 * thing a writing tool must never be vague about.
 */
export function SaveStatus({ state, savedAt, onRetry }: SaveStatusProps) {
  const [now, setNow] = useState(() => Date.now());

  // Only tick while there is a timestamp on screen to age.
  useEffect(() => {
    if (state !== "saved" || savedAt === null) return;
    const id = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(id);
  }, [state, savedAt]);

  if (state === "error") {
    return (
      <button
        type="button"
        onClick={onRetry}
        className="flex items-center gap-1.5 text-xs text-destructive hover:underline"
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Couldn't save — retry
      </button>
    );
  }

  if (state === "saving") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Saving
      </span>
    );
  }

  if (state === "dirty") {
    return (
      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60" />
        Unsaved changes
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      Saved{savedAt !== null && ` ${relative(savedAt, now)}`}
    </span>
  );
}
