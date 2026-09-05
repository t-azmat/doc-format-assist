import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useTheme } from "@/components/ThemeProvider";

/**
 * Two-state toggle rather than a light/dark/system menu.
 *
 * The stored preference still supports "system" (that is the default until the
 * user expresses one), but a single control that flips to the opposite of what
 * is on screen is the whole interaction most people want, and a three-item
 * dropdown for it is a menu nobody opens twice.
 */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const next = resolved === "dark" ? "light" : "dark";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={() => setTheme(next)}
          aria-label={`Switch to ${next} theme`}
        >
          {resolved === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Switch to {next} theme</TooltipContent>
    </Tooltip>
  );
}
