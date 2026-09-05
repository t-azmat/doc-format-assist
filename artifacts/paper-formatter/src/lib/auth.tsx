import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** True until the first /auth/me round-trip settles, so the app can avoid
   *  flashing the sign-in screen at an already-authenticated user. */
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    displayName?: string,
  ) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Auth endpoints are hand-called rather than generated: they set and clear a
// cookie, which the typed client has no way to express.
const authUrl = (path: string) =>
  `${import.meta.env.BASE_URL}api/auth/${path}`.replace(/([^:]\/)\/+/g, "$1");

async function authRequest<T>(path: string, body?: unknown): Promise<T | null> {
  const response = await fetch(authUrl(path), {
    method: body === undefined ? "GET" : "POST",
    credentials: "include",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) return null;

  const data = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    throw new Error(data?.error ?? "Something went wrong. Please try again.");
  }
  return data;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  // Restore the session on load: the cookie is httpOnly, so asking the server
  // who we are is the only way to know.
  useEffect(() => {
    let cancelled = false;
    fetch(authUrl("me"), { credentials: "include" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: AuthUser | null) => {
        if (!cancelled) setUser(data);
      })
      .catch(() => {
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from the typed client means the session expired or was revoked
  // elsewhere. Drop the user and the cached documents rather than leaving the
  // UI showing stale data it can no longer refresh.
  useEffect(() => {
    const onUnauthorized = () => {
      setUser(null);
      queryClient.clear();
    };
    window.addEventListener("api:unauthorized", onUnauthorized);
    return () => window.removeEventListener("api:unauthorized", onUnauthorized);
  }, [queryClient]);

  const login = useCallback(
    async (email: string, password: string) => {
      const data = await authRequest<AuthUser>("login", { email, password });
      setUser(data);
      // A different user may have been signed in a moment ago; never show them
      // the previous account's cached documents.
      queryClient.clear();
    },
    [queryClient],
  );

  const register = useCallback(
    async (email: string, password: string, displayName?: string) => {
      const data = await authRequest<AuthUser>("register", {
        email,
        password,
        ...(displayName ? { displayName } : {}),
      });
      setUser(data);
      queryClient.clear();
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await authRequest("logout", {});
    } finally {
      setUser(null);
      queryClient.clear();
    }
  }, [queryClient]);

  const value = useMemo(
    () => ({ user, isLoading, login, register, logout }),
    [user, isLoading, login, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
