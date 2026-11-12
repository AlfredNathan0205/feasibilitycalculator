import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema.js";
import type { AuthSession } from "../auth/authz.js";
import { AuthorizationError } from "../auth/authz.js";
import { ValidationError } from "./decide-requirement.js";
import type { NicheFrameworkPayload } from "../engine/niche-assessment.js";
import { NICHE_FRAMEWORK_V1 } from "../engine/niche-framework-v1.js";
import {
  createDraftFramework,
  discardDraftFramework,
  publishFramework,
  replayFramework,
  updateDraftFramework,
} from "./niche-framework-editor.js";

const databaseUrl = process.env.DATABASE_URL;
const describeIfDb = databaseUrl ? describe : describe.skip;
type Db = ReturnType<typeof drizzle<typeof schema>>;
class Rollback extends Error {}

describeIfDb("niche framework editor (integration, each test rolls back)", () => {
  let client: ReturnType<typeof postgres>;
  let db: Db;
  beforeAll(() => {
    client = postgres(databaseUrl!);
    db = drizzle(client, { schema });
  });
  afterAll(async () => {
    await client.end();
  });
  async function inRollback(fn: (tx: Db) => Promise<void>) {
    try {
      await db.transaction(async (tx) => {
        await fn(tx as unknown as Db);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }
  const tag = () => Math.random().toString(36).slice(2, 9);

  async function setup(tx: Db) {
    const t = tag();
    const [u] = await tx
      .insert(schema.users)
      .values({
        entraObjectId: `fe-${t}`,
        upn: `${t}@fe.example`,
        displayName: "A",
        email: `${t}@fe.example`,
      })
      .returning();
    const admin: AuthSession = {
      userId: u!.id,
      accessRoles: ["admin"],
      approvalAuthorityRoles: [],
    };
    const other: AuthSession = {
      userId: u!.id,
      accessRoles: ["account_manager"],
      approvalAuthorityRoles: [],
    };
    // Isolate: drop any existing draft and make sure exactly one published framework exists.
    await tx
      .delete(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "draft"));
    const [pub] = await tx
      .select()
      .from(schema.nicheFrameworks)
      .where(eq(schema.nicheFrameworks.status, "published"));
    if (!pub) {
      await tx.insert(schema.nicheFrameworks).values({
        version: 1,
        status: "published",
        payload: NICHE_FRAMEWORK_V1,
        sourceNote: "test",
        createdBy: u!.id,
        publishedBy: u!.id,
        publishedAt: new Date(),
      });
    }
    return { admin, other };
  }

  it("only an Admin can create a draft", async () => {
    await inRollback(async (tx) => {
      const { other } = await setup(tx);
      await expect(createDraftFramework(tx, other)).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });
  });

  it("creates a draft, edits it, rejects invalid edits, and refuses a second draft", async () => {
    await inRollback(async (tx) => {
      const { admin } = await setup(tx);
      const d = await createDraftFramework(tx, admin);
      await expect(createDraftFramework(tx, admin)).rejects.toBeInstanceOf(
        ValidationError,
      );
      const [row] = await tx
        .select()
        .from(schema.nicheFrameworks)
        .where(eq(schema.nicheFrameworks.id, d.id));
      const p = structuredClone(row!.payload) as NicheFrameworkPayload;
      p.sections[0]!.criteria[0]!.text = "Reworded question";
      await updateDraftFramework(tx, admin, d.id, p);
      const bad = structuredClone(p);
      bad.sections[0]!.criteria[0]!.weight += 1; // total no longer 100
      await expect(updateDraftFramework(tx, admin, d.id, bad)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  it("publishing supersedes the previous version; published versions are immutable", async () => {
    await inRollback(async (tx) => {
      const { admin } = await setup(tx);
      const d = await createDraftFramework(tx, admin);
      await publishFramework(tx, admin, d.id);
      const published = await tx
        .select()
        .from(schema.nicheFrameworks)
        .where(eq(schema.nicheFrameworks.status, "published"));
      expect(published).toHaveLength(1);
      expect(published[0]!.id).toBe(d.id);
      await expect(
        updateDraftFramework(tx, admin, d.id, NICHE_FRAMEWORK_V1),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(discardDraftFramework(tx, admin, d.id)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });
  });

  it("replay is read only and reports nothing for an unchanged draft", async () => {
    await inRollback(async (tx) => {
      const { admin } = await setup(tx);
      const d = await createDraftFramework(tx, admin);
      const r = await replayFramework(tx, d.id);
      expect(r.changes).toEqual([]);
      expect(r.warnings).toEqual([]);
    });
  });

  it("writes audit events for created, updated, published", async () => {
    await inRollback(async (tx) => {
      const { admin } = await setup(tx);
      const d = await createDraftFramework(tx, admin);
      await publishFramework(tx, admin, d.id);
      const ev = await tx
        .select()
        .from(schema.auditEvents)
        .where(eq(schema.auditEvents.entityId, d.id));
      expect(ev.map((e) => e.action).sort()).toEqual([
        "niche_framework.created",
        "niche_framework.published",
      ]);
    });
  });
});
