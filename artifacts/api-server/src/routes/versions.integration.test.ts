import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import request from "supertest";
import { eq, inArray } from "drizzle-orm";
import type { Express } from "express";

const engine = vi.hoisted(() => ({ format: vi.fn(), export: vi.fn() }));
vi.mock("../lib/pythonClient", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/pythonClient")>()),
  formatDocument: engine.format,
  exportDocument: engine.export,
}));

// Runs only against the explicitly provisioned CI test database.
describe.skipIf(!process.env.TEST_DATABASE_URL)(
  "format previews and version recovery",
  () => {
    let app: Express;
    let database: typeof import("@workspace/db");
    let aliceId: number;
    let bobId: number;
    let aliceCookie: string;
    let bobCookie: string;
    const originalContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Introduction" }],
        },
      ],
    };
    const formattedContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "INTRODUCTION" }],
        },
      ],
    };
    const result = () => ({
      editorContent: formattedContent,
      formattingIssues: [],
      documentClass: "ieee-conference",
      styleSpec: { body_size_pt: 10 },
    });

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.LOG_LEVEL = "silent";
      database = await import("@workspace/db");
      app = (await import("../app")).default;
      const { createSession, SESSION_COOKIE } = await import("../lib/session");
      const stamp = crypto.randomUUID();
      const users = await database.db
        .insert(database.usersTable)
        .values([
          {
            email: `alice-${stamp}@example.invalid`,
            passwordHash: "test-only",
          },
          { email: `bob-${stamp}@example.invalid`, passwordHash: "test-only" },
        ])
        .returning();
      aliceId = users[0].id;
      bobId = users[1].id;
      aliceCookie = `${SESSION_COOKIE}=${(await createSession(aliceId)).token}`;
      bobCookie = `${SESSION_COOKIE}=${(await createSession(bobId)).token}`;
    });

    beforeEach(() =>
      engine.format.mockReset().mockImplementation(async () => result()),
    );

    afterAll(async () => {
      if (database) {
        const ids = [aliceId, bobId].filter((id) => id !== undefined);
        if (ids.length)
          await database.db
            .delete(database.usersTable)
            .where(inArray(database.usersTable.id, ids));
        await database.pool.end();
      }
    });

    it("returns a conflict for duplicate signup without changing the existing account", async () => {
      const [before] = await database.db
        .select()
        .from(database.usersTable)
        .where(eq(database.usersTable.id, aliceId));
      const response = await request(app).post("/api/auth/register").send({
        email: before.email,
        password: "Different-password-123!",
        displayName: "Should not replace the account",
      });
      expect(response.status).toBe(409);
      expect(response.body).toEqual({
        error: "That email is already registered.",
      });
      expect(response.headers["set-cookie"]).toBeUndefined();
      const [after] = await database.db
        .select()
        .from(database.usersTable)
        .where(eq(database.usersTable.id, aliceId));
      expect(after).toEqual(before);
    });

    it("creates one usable account when two signups use the same email", async () => {
      const email = `signup-${crypto.randomUUID()}@example.invalid`;
      const details = { email, password: "Signup-regression-123!" };
      try {
        const responses = await Promise.all([
          request(app).post("/api/auth/register").send(details),
          request(app).post("/api/auth/register").send(details),
        ]);
        expect(responses.map((response) => response.status).sort()).toEqual([
          201, 409,
        ]);
        const created = responses.find((response) => response.status === 201)!;
        expect(created.body.email).toBe(email);
        expect(created.body).not.toHaveProperty("passwordHash");
        const cookie = created.headers["set-cookie"];
        expect(cookie).toBeDefined();
        const me = await request(app).get("/api/auth/me").set("Cookie", cookie);
        expect(me.status).toBe(200);
        expect(me.body.id).toBe(created.body.id);
        const login = await request(app).post("/api/auth/login").send(details);
        expect(login.status).toBe(200);
        expect(login.body.id).toBe(created.body.id);
      } finally {
        await database.db
          .delete(database.usersTable)
          .where(eq(database.usersTable.email, email));
      }
    });

    async function seed() {
      const [doc] = await database.db
        .insert(database.documentsTable)
        .values({
          ownerId: aliceId,
          title: "Synthetic manuscript",
          editorContent: originalContent,
          extractedContent: {},
          status: "extracted",
          conferenceStyle: "ieee",
        })
        .returning();
      return doc;
    }
    const versions = (id: number, cookie = aliceCookie) =>
      request(app).get(`/api/documents/${id}/versions`).set("Cookie", cookie);

    it("offers a public fictional example and creates private copies only after sign-in", async () => {
      const example = await request(app).get("/api/examples/manuscript");
      expect(example.status).toBe(200);
      expect(example.body.id).toBe(0);
      expect(example.body.extractedContent.sample).toBe(true);
      expect(example.body.ownerId).toBeUndefined();
      expect(example.body.sourceFilePath).toBeUndefined();
      expect((await request(app).post("/api/documents/sample")).status).toBe(
        401,
      );
      const copy = await request(app)
        .post("/api/documents/sample")
        .set("Cookie", aliceCookie);
      expect(copy.status).toBe(201);
      expect(copy.body.id).toBeGreaterThan(0);
      expect(copy.body.editorContent).toEqual(example.body.editorContent);
      expect(copy.body.revision).toBe(0);
      const path = `/api/documents/${copy.body.id}`;
      expect(
        (await request(app).get(path).set("Cookie", aliceCookie)).status,
      ).toBe(200);
      expect(
        (await request(app).get(path).set("Cookie", bobCookie)).status,
      ).toBe(404);
      expect(
        (await request(app).get("/api/documents/0").set("Cookie", aliceCookie))
          .status,
      ).toBe(404);
    });

    it("previews without modifying the document or creating a version", async () => {
      const doc = await seed();
      const preview = await request(app)
        .post(`/api/documents/${doc.id}/format`)
        .set("Cookie", aliceCookie)
        .send({ dryRun: true, expectedRevision: 0 });
      expect(preview.status).toBe(200);
      expect(preview.body.editorContent).toEqual(formattedContent);
      const saved = await request(app)
        .get(`/api/documents/${doc.id}`)
        .set("Cookie", aliceCookie);
      expect(saved.body.editorContent).toEqual(originalContent);
      expect(saved.body.revision).toBe(0);
      expect((await versions(doc.id)).body).toEqual([]);
    });

    it("labels export snapshots and rejects stale revisions before rendering", async () => {
      const doc = await seed();
      const { writeFile } = await import("node:fs/promises");
      engine.export.mockReset().mockImplementation(async ({ pdfPath }) => {
        await writeFile(pdfPath, "%PDF-1.4\nsynthetic snapshot");
      });
      const stale = await request(app)
        .get(`/api/documents/${doc.id}/export?format=pdf&expectedRevision=1`)
        .set("Cookie", aliceCookie);
      expect(stale.status).toBe(409);
      expect(engine.export).not.toHaveBeenCalled();
      const invalid = await request(app)
        .get(`/api/documents/${doc.id}/export?format=pdf&expectedRevision=-1`)
        .set("Cookie", aliceCookie);
      expect(invalid.status).toBe(422);
      const forbidden = await request(app)
        .get(`/api/documents/${doc.id}/export?format=pdf&expectedRevision=0`)
        .set("Cookie", bobCookie);
      expect(forbidden.status).toBe(404);
      const exported = await request(app)
        .get(`/api/documents/${doc.id}/export?format=pdf&expectedRevision=0`)
        .set("Cookie", aliceCookie);
      expect(exported.status).toBe(200);
      expect(exported.headers["x-document-revision"]).toBe("0");
      expect(engine.export).toHaveBeenCalledOnce();
      expect(engine.export.mock.calls[0][0].editorContent).toEqual(
        originalContent,
      );
    });

    it("saves the original and makes restoration itself reversible", async () => {
      const doc = await seed();
      const applied = await request(app)
        .post(`/api/documents/${doc.id}/format`)
        .set("Cookie", aliceCookie)
        .send({ expectedRevision: 0 });
      expect(applied.status).toBe(200);
      expect(applied.body.revision).toBe(1);
      const history = (await versions(doc.id)).body;
      expect(history).toHaveLength(1);
      expect(history[0].snapshot).toBeUndefined();
      const restored = await request(app)
        .post(`/api/documents/${doc.id}/versions/${history[0].id}/restore`)
        .set("Cookie", aliceCookie)
        .send({ expectedRevision: 1 });
      expect(restored.status).toBe(200);
      expect(restored.body.editorContent).toEqual(originalContent);
      expect(restored.body.revision).toBe(2);
      const latest = (await versions(doc.id)).body;
      expect(latest).toHaveLength(2);
      const undo = await request(app)
        .post(`/api/documents/${doc.id}/versions/${latest[0].id}/restore`)
        .set("Cookie", aliceCookie)
        .send({ expectedRevision: 2 });
      expect(undo.body.editorContent).toEqual(formattedContent);
    });

    it("does not reveal or restore another account's versions", async () => {
      const doc = await seed();
      await request(app)
        .post(`/api/documents/${doc.id}/format`)
        .set("Cookie", aliceCookie)
        .send({});
      const version = (await versions(doc.id)).body[0];
      expect((await versions(doc.id, bobCookie)).status).toBe(404);
      expect(
        (
          await request(app)
            .post(`/api/documents/${doc.id}/versions/${version.id}/restore`)
            .set("Cookie", bobCookie)
            .send({ expectedRevision: 1 })
        ).status,
      ).toBe(404);
      const otherDoc = await seed();
      expect(
        (
          await request(app)
            .post(
              `/api/documents/${otherDoc.id}/versions/${version.id}/restore`,
            )
            .set("Cookie", aliceCookie)
            .send({ expectedRevision: 0 })
        ).status,
      ).toBe(404);
    });

    it("rejects a stale preview and leaves the newer edit untouched", async () => {
      const doc = await seed();
      await request(app)
        .patch(`/api/documents/${doc.id}`)
        .set("Cookie", aliceCookie)
        .send({ title: "New title" });
      const applied = await request(app)
        .post(`/api/documents/${doc.id}/format`)
        .set("Cookie", aliceCookie)
        .send({ expectedRevision: 0 });
      expect(applied.status).toBe(409);
      expect(engine.format).not.toHaveBeenCalled();
      expect((await versions(doc.id)).body).toHaveLength(0);
    });

    it("rejects edits that race with the formatting engine", async () => {
      const doc = await seed();
      let release!: () => void;
      let started!: () => void;
      const start = new Promise<void>((resolve) => {
        started = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      engine.format.mockImplementationOnce(async () => {
        started();
        await gate;
        return result();
      });
      const applying = request(app)
        .post(`/api/documents/${doc.id}/format`)
        .set("Cookie", aliceCookie)
        .send({ expectedRevision: 0 })
        .then((res) => res);
      await start;
      try {
        await request(app)
          .patch(`/api/documents/${doc.id}`)
          .set("Cookie", aliceCookie)
          .send({ title: "Concurrent edit" });
      } finally {
        release();
      }
      expect((await applying).status).toBe(409);
      expect((await versions(doc.id)).body).toHaveLength(0);
    });

    it("does not save a version when formatting fails", async () => {
      const doc = await seed();
      engine.format.mockRejectedValueOnce(new Error("synthetic failure"));
      expect(
        (
          await request(app)
            .post(`/api/documents/${doc.id}/format`)
            .set("Cookie", aliceCookie)
            .send({})
        ).status,
      ).toBe(500);
      expect((await versions(doc.id)).body).toHaveLength(0);
      const [row] = await database.db
        .select()
        .from(database.documentsTable)
        .where(eq(database.documentsTable.id, doc.id));
      expect(row.editorContent).toEqual(originalContent);
    });
  },
);
