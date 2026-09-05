import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Route, Switch, Router as WouterRouter, Link, Redirect } from "wouter";
import DocumentList from "@/pages/DocumentList";
import { lazy, Suspense } from "react";
import SignIn from "@/pages/SignIn";
import Landing from "@/pages/Landing";
import { Loader2, LogOut } from "lucide-react";
import {
  useHealthCheck,
  getHealthCheckQueryKey,
} from "@workspace/api-client-react";
import { AuthProvider, useAuth } from "@/lib/auth";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { CommandPalette } from "@/components/CommandPalette";
import { Button } from "@/components/ui/button";

const DocumentEditor = lazy(() => import("@/pages/DocumentEditor"));
const Demo = lazy(() => import("@/pages/Demo"));

function DemoPage() {
  return (
    <Suspense
      fallback={
        <p className="p-8 text-sm text-muted-foreground">Opening the sample…</p>
      }
    >
      <Demo />
    </Suspense>
  );
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 is resolved by signing in again, not by retrying the request two
      // more times first.
      retry: (failureCount, error) =>
        (error as { status?: number })?.status === 401
          ? false
          : failureCount < 2,
    },
  },
});

/**
 * The mark: a sheet of paper with a rule across it.
 *
 * Drawn rather than an icon-set glyph, because the whole product is about the
 * page and no lucide icon says "manuscript" without also saying "file".
 */
function DeskMark() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      fill="none"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="3.5"
        y="1.5"
        width="11"
        height="15"
        rx="0.5"
        className="stroke-brand"
        strokeWidth="1.25"
      />
      <path
        d="M6 6h6M6 9h6M6 12h3.5"
        className="stroke-brand"
        strokeWidth="1.25"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function AccountMenu() {
  const { user, logout } = useAuth();
  if (!user) return null;

  return (
    <div className="flex items-center gap-1">
      <span className="hidden sm:inline max-w-[14rem] truncate text-xs text-muted-foreground">
        {user.displayName || user.email}
      </span>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => {
          void logout();
        }}
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  // Polling health while signed out is noise on a screen that shows nothing.
  const { isError: healthFailed } = useHealthCheck({
    query: {
      enabled: !!user,
      queryKey: getHealthCheckQueryKey(),
      refetchInterval: 30_000,
    },
  });
  const offline = Boolean(user) && healthFailed;

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background text-foreground">
      <header className="sticky top-0 z-40 w-full border-b border-border bg-background/85 backdrop-blur-sm">
        <div className="mx-auto flex h-12 max-w-[100rem] items-center justify-between px-4">
          <Link
            href="/"
            className="flex items-center gap-2 text-sm font-medium tracking-tight text-foreground transition-colors hover:text-brand"
          >
            <DeskMark />
            <span>Editorial Desk</span>
          </Link>

          <div className="flex items-center gap-1">
            {/* Surfaced only when it means something. A green "System Online"
                pip on every screen is decoration; a warning when the server is
                unreachable is information. */}
            {offline && (
              <span className="mr-2 flex items-center gap-1.5 text-xs text-warning">
                <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                Reconnecting
              </span>
            )}
            {/* Available signed out too — someone reading the sign-in screen at
                night should not have to authenticate to dim it. */}
            <ThemeToggle />
            {!user && (
              <Button asChild variant="ghost" size="sm">
                <Link href="/signin">Sign in</Link>
              </Button>
            )}
            <AccountMenu />
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}

/**
 * Gate the app on a session.
 *
 * Every document route is owner-scoped server-side, so this is a UX guard
 * rather than the security boundary — but rendering the workspace to a
 * signed-out visitor would just produce a page of failed requests.
 */
function Router() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <Layout>
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      </Layout>
    );
  }

  if (!user) {
    return (
      <Layout>
        <Switch>
          <Route path="/" component={Landing} />
          <Route path="/demo" component={DemoPage} />
          <Route path="/signup">
            <SignIn key="register" initialMode="register" />
          </Route>
          <Route>
            <SignIn key="login" />
          </Route>
        </Switch>
      </Layout>
    );
  }

  return (
    <Layout>
      <CommandPalette />
      <Switch>
        <Route path="/demo" component={DemoPage} />
        <Route path="/signin">
          <Redirect to="/" />
        </Route>
        <Route path="/signup">
          <Redirect to="/" />
        </Route>
        <Route path="/" component={DocumentList} />
        <Route path="/documents/:id">
          {(params) => (
            <Suspense
              fallback={
                <div className="p-8 text-sm text-muted-foreground">
                  Opening manuscript…
                </div>
              }
            >
              <DocumentEditor key={params.id} />
            </Suspense>
          )}
        </Route>
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider delayDuration={300}>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Router />
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
