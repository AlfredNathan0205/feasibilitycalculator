"use server";

import { redirect } from "next/navigation";
import { AuthorizationError } from "../../../auth/authz.js";
import { getDb } from "../../../lib/db.js";
import { NotFoundError, ValidationError } from "../../../services/decide-requirement.js";
import {
  createDraftFramework,
  discardDraftFramework,
  publishFramework,
  recordReplay,
  updateDraftFramework,
} from "../../../services/niche-framework-editor.js";
import type { NicheFrameworkPayload } from "../../../engine/niche-assessment.js";
import { currentSession, type Session } from "../../niche/gate.js";

async function run(
  back: string,
  op: (s: Session) => Promise<{ to?: string; ok: string }>,
): Promise<never> {
  const session = await currentSession();
  if (!session) redirect("/");
  let target: string;
  try {
    const r = await op(session);
    target = withParam(r.to ?? back, "ok", r.ok);
  } catch (e) {
    if (
      e instanceof ValidationError ||
      e instanceof AuthorizationError ||
      e instanceof NotFoundError
    ) {
      target = withParam(back, "error", e.message);
    } else throw e;
  }
  redirect(target);
}

function withParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

export async function createFrameworkDraftAction() {
  await run("/admin/niche-frameworks", async (s) => {
    const d = await createDraftFramework(getDb(), s);
    return {
      to: `/admin/niche-frameworks/${d.id}`,
      ok: `Draft version ${d.version} created.`,
    };
  });
}

export async function saveFrameworkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await run(`/admin/niche-frameworks/${id}`, async (s) => {
    let payload: NicheFrameworkPayload;
    try {
      payload = JSON.parse(
        String(formData.get("payload") ?? ""),
      ) as NicheFrameworkPayload;
    } catch {
      throw new ValidationError("The framework could not be read; reload and try again");
    }
    await updateDraftFramework(getDb(), s, id, payload);
    return { ok: "Draft saved." };
  });
}

export async function replayFrameworkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await run(`/admin/niche-frameworks/${id}`, async (s) => {
    await recordReplay(getDb(), s, id);
    return {
      to: `/admin/niche-frameworks/${id}?replay=1`,
      ok: "Replay complete (nothing was changed).",
    };
  });
}

export async function publishFrameworkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await run(`/admin/niche-frameworks/${id}`, async (s) => {
    await publishFramework(getDb(), s, id);
    return {
      to: "/admin/niche-frameworks",
      ok: "Framework published. Existing assessments keep their original version.",
    };
  });
}

export async function discardFrameworkAction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  await run(`/admin/niche-frameworks/${id}`, async (s) => {
    await discardDraftFramework(getDb(), s, id);
    return { to: "/admin/niche-frameworks", ok: "Draft discarded." };
  });
}
