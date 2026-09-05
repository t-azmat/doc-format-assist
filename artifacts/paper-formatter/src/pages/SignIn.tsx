import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

type Mode = "login" | "register";

export default function SignIn() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isRegister = mode === "register";

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);

    // Checked here only for a faster message; the server enforces the same rule
    // and is the one that matters.
    if (isRegister && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      if (isRegister) {
        await register(email, password, displayName.trim() || undefined);
      } else {
        await login(email, password);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign in failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-1 items-center justify-center px-6 py-14">
      {/* The form sits on a panel rather than directly on the board. Inputs use
          the board color as their fill so they read as recessed wells — on a
          page whose background is also board, they disappeared entirely. */}
      <div className="w-full max-w-[21rem] rounded-md border border-card-border bg-card p-7">
        {/* The one place a page is drawn at rest: a sheet with a rule on it,
            same mark as the header, at a size where it reads as an object. */}
        <svg
          width="40"
          height="52"
          viewBox="0 0 40 52"
          fill="none"
          aria-hidden="true"
          className="mb-6"
        >
          <rect
            x="0.75"
            y="0.75"
            width="38.5"
            height="50.5"
            rx="1"
            className="fill-paper stroke-border"
            strokeWidth="1.5"
          />
          <path
            d="M8 12h24M8 19h24M8 26h24M8 33h13"
            className="stroke-brand"
            strokeWidth="1.5"
            strokeLinecap="round"
            opacity="0.4"
          />
        </svg>

        <h1 className="type-section text-foreground">
          {isRegister ? "Create an account" : "Sign in"}
        </h1>
        <p className="mt-1.5 text-sm leading-snug text-muted-foreground">
          {isRegister
            ? "Your manuscripts stay private to your account."
            : "Pick up where you left off."}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {isRegister && (
            <div className="space-y-1.5">
              <Label htmlFor="displayName" className="type-label">
                Name <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="displayName"
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                disabled={submitting}
              />
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="email" className="type-label">
              Email
            </Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={submitting}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password" className="type-label">
              Password
            </Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete={isRegister ? "new-password" : "current-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
            />
            {isRegister && (
              <p className="text-xs text-muted-foreground">At least 8 characters.</p>
            )}
          </div>

          {error && (
            <p
              role="alert"
              className="border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs leading-snug text-destructive"
            >
              {error}
            </p>
          )}

          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
            {isRegister ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="mt-6 text-sm text-muted-foreground">
          {isRegister ? "Already have an account?" : "No account yet?"}{" "}
          <button
            type="button"
            className="font-medium text-brand hover:underline"
            onClick={() => {
              setMode(isRegister ? "login" : "register");
              setError(null);
            }}
          >
            {isRegister ? "Sign in" : "Create one"}
          </button>
        </p>
      </div>
    </div>
  );
}
