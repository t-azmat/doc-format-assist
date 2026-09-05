import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  // Stored lowercased; the unique constraint is what makes registration
  // race-safe, so never rely on a pre-insert existence check alone.
  email: text("email").notNull().unique(),
  displayName: text("display_name"),
  // scrypt output, encoded as "scrypt$N$r$p$<salt-b64>$<hash-b64>". The
  // parameters live in the string so existing hashes stay verifiable after the
  // cost factors are raised.
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const sessionsTable = pgTable(
  "sessions",
  {
    // Random 256-bit token id, generated server-side.
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    // SHA-256 of the cookie token. The raw token is never stored, so a
    // database leak does not hand out live sessions.
    tokenHash: text("token_hash").notNull(),
    userAgent: text("user_agent"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("sessions_token_hash_idx").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
  ],
);

export type User = typeof usersTable.$inferSelect;
export type Session = typeof sessionsTable.$inferSelect;

/** A user as exposed over the API — never includes the password hash. */
export interface PublicUser {
  id: number;
  email: string;
  displayName: string | null;
  createdAt: string;
}

export const toPublicUser = (user: User): PublicUser => ({
  id: user.id,
  email: user.email,
  displayName: user.displayName,
  createdAt: user.createdAt.toISOString(),
});

// Deliberately stricter than the column: an 8-char minimum is the floor, and
// the max stops a multi-megabyte body turning into a multi-second scrypt call.
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(200, "Password must be at most 200 characters.");

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .max(320);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().trim().min(1).max(120).optional(),
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required.").max(200),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
