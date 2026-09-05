import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, lt, ne } from "drizzle-orm";
import { db, sessionsTable, usersTable, type User } from "@workspace/db";
import type { CookieOptions, Response } from "express";

export const SESSION_COOKIE = "pf_session";

const DAY_MS = 24 * 60 * 60 * 1000;
const ttlDays = Number(process.env.SESSION_TTL_DAYS ?? "30");
const SESSION_TTL_MS = (Number.isFinite(ttlDays) && ttlDays > 0 ? ttlDays : 30) * DAY_MS;

// Secure cookies require HTTPS, which localhost development does not have.
// Default to on in production and allow an explicit override for the case of a
// TLS-terminating proxy in a non-production environment.
const secureCookies =
  process.env.COOKIE_SECURE === "true" ||
  (process.env.COOKIE_SECURE !== "false" &&
    process.env.NODE_ENV === "production");

function cookieOptions(maxAgeMs: number): CookieOptions {
  return {
    httpOnly: true,
    // Lax keeps the cookie off cross-site POSTs (the CSRF vector) while still
    // surviving a normal top-level navigation back into the app.
    sameSite: "lax",
    secure: secureCookies,
    path: "/",
    maxAge: maxAgeMs,
  };
}

/** SHA-256 is right here: the input is already 256 bits of entropy, so there
 *  is nothing to brute-force and no need for a slow KDF. Hashing at rest means
 *  a leaked database does not yield usable session cookies. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

export async function createSession(
  userId: number,
  userAgent?: string,
): Promise<IssuedSession> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await db.insert(sessionsTable).values({
    id: randomUUID(),
    userId,
    tokenHash: hashToken(token),
    userAgent: userAgent?.slice(0, 500) ?? null,
    expiresAt,
  });

  return { token, expiresAt };
}

export interface SessionUser {
  sessionId: string;
  user: User;
}

export async function resolveSession(
  token: string | undefined,
): Promise<SessionUser | null> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const [found] = await db
    .select({ session: sessionsTable, user: usersTable })
    .from(sessionsTable)
    .innerJoin(usersTable, eq(sessionsTable.userId, usersTable.id))
    .where(eq(sessionsTable.tokenHash, hashToken(token)));

  if (!found) return null;

  if (found.session.expiresAt.getTime() <= Date.now()) {
    // Expired rows are removed on encounter; sweepExpiredSessions handles the
    // ones nobody comes back for.
    await db.delete(sessionsTable).where(eq(sessionsTable.id, found.session.id));
    return null;
  }

  return { sessionId: found.session.id, user: found.user };
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  await db.delete(sessionsTable).where(eq(sessionsTable.tokenHash, hashToken(token)));
}

/** Used when a password changes — every other device is logged out. */
export async function revokeAllSessionsForUser(
  userId: number,
  exceptSessionId?: string,
): Promise<void> {
  const where = exceptSessionId
    ? and(
        eq(sessionsTable.userId, userId),
        ne(sessionsTable.id, exceptSessionId),
      )
    : eq(sessionsTable.userId, userId);
  await db.delete(sessionsTable).where(where);
}

/** Housekeeping: expired sessions are dead weight and a small privacy leak
 *  (they retain user agents). Called on an interval from the server entry. */
export async function sweepExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessionsTable)
    .where(lt(sessionsTable.expiresAt, new Date()))
    .returning({ id: sessionsTable.id });
  return deleted.length;
}

export function setSessionCookie(res: Response, session: IssuedSession): void {
  res.cookie(SESSION_COOKIE, session.token, cookieOptions(SESSION_TTL_MS));
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}
