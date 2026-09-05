import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import {
  db,
  loginSchema,
  registerSchema,
  toPublicUser,
  usersTable,
} from "@workspace/db";
import { fakeVerify, hashPassword, verifyPassword } from "../lib/password";
import {
  SESSION_COOKIE,
  clearSessionCookie,
  createSession,
  revokeAllSessionsForUser,
  revokeSession,
  setSessionCookie,
} from "../lib/session";
import { requireAuth } from "../middlewares/auth";
import { authRateLimit } from "../middlewares/rateLimit";

const router: IRouter = Router();

// Registration and login are deliberately vague about which half of the
// credential pair was wrong — a precise message ("no such account") turns the
// endpoint into a user-enumeration oracle.
const INVALID_CREDENTIALS = "Email or password is incorrect.";

router.post("/auth/register", authRateLimit, async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({
        error: parsed.error.issues[0]?.message ?? "Invalid registration details.",
      });
      return;
    }

    const { email, password, displayName } = parsed.data;
    const passwordHash = await hashPassword(password);

    let user;
    try {
      [user] = await db
        .insert(usersTable)
        .values({ email, passwordHash, displayName: displayName ?? null })
        .returning();
    } catch (err) {
      // The unique index is the authority on "already registered" — checking
      // first and inserting after leaves a race between two signups.
      if ((err as { code?: string }).code === "23505") {
        res.status(409).json({ error: "That email is already registered." });
        return;
      }
      throw err;
    }

    const session = await createSession(user!.id, req.get("user-agent"));
    setSessionCookie(res, session);
    req.log.info({ userId: user!.id }, "User registered");
    res.status(201).json(toPublicUser(user!));
  } catch (err) {
    next(err);
  }
});

router.post("/auth/login", authRateLimit, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: INVALID_CREDENTIALS });
      return;
    }

    const { email, password } = parsed.data;
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.email, email));

    if (!user) {
      // Burn the same ~100ms scrypt cost as a real check so response time does
      // not reveal whether the account exists.
      await fakeVerify(password);
      res.status(401).json({ error: INVALID_CREDENTIALS });
      return;
    }

    if (!(await verifyPassword(password, user.passwordHash))) {
      req.log.warn({ userId: user.id }, "Failed login");
      res.status(401).json({ error: INVALID_CREDENTIALS });
      return;
    }

    const session = await createSession(user.id, req.get("user-agent"));
    setSessionCookie(res, session);
    res.json(toPublicUser(user));
  } catch (err) {
    next(err);
  }
});

router.post("/auth/logout", async (req, res, next) => {
  try {
    await revokeSession(req.cookies?.[SESSION_COOKIE] as string | undefined);
    clearSessionCookie(res);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

router.get("/auth/me", (req, res) => {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required." });
    return;
  }
  res.json(toPublicUser(req.user));
});

router.post("/auth/password", requireAuth, authRateLimit, async (req, res, next) => {
  try {
    const currentPassword = String(req.body?.currentPassword ?? "");
    const newPassword = String(req.body?.newPassword ?? "");

    if (newPassword.length < 8 || newPassword.length > 200) {
      res.status(422).json({ error: "New password must be 8-200 characters." });
      return;
    }
    if (!(await verifyPassword(currentPassword, req.user!.passwordHash))) {
      res.status(401).json({ error: "Current password is incorrect." });
      return;
    }

    const passwordHash = await hashPassword(newPassword);
    await db
      .update(usersTable)
      .set({ passwordHash })
      .where(eq(usersTable.id, req.user!.id));

    // A password change must invalidate sessions elsewhere; keep the caller
    // signed in on this device by re-issuing after the purge.
    await revokeAllSessionsForUser(req.user!.id);
    const session = await createSession(req.user!.id, req.get("user-agent"));
    setSessionCookie(res, session);

    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
