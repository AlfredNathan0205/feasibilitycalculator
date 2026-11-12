"use server";

import { redirect } from "next/navigation";
import { AuthorizationError } from "../../auth/authz.js";
import { getDb } from "../../lib/db.js";
import { NotFoundError, ValidationError } from "../../services/decide-requirement.js";
import {
  createAssessmentDraft,
  createBrand,
  mergeBrands,
  reviewAssessment,
  saveAssessmentDraft,
  setBrandActive,
  submitAssessment,
  updateBrand,
  withdrawAssessment,
} from "../../services/niche-assessments.js";
import type { NicheAnswer, NicheAnswers } from "../../engine/niche-assessment.js";

import { currentSession, type Session } from "./gate.js";

/** Runs a mutation, then redirects with ok/error; redirect() must stay outside the try. */
async function run(
  back: string,
  op: (session: Session) => Promise<{ to?: string; ok: string }>,
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
      e instanceof NotFoundError ||
      (e instanceof Error && /^(Unknown criterion|Invalid answer)/.test(e.message))
    ) {
      target = withParam(back, "error", e.message);
    } else {
      throw e;
    }
  }
  redirect(target);
}

function withParam(url: string, key: string, value: string) {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${encodeURIComponent(value)}`;
}

const str = (f: FormData, k: string) => String(f.get(k) ?? "");

function readAnswers(f: FormData): NicheAnswers {
  const answers: NicheAnswers = {};
  for (const [k, v] of f.entries()) {
    if (k.startsWith("a_") && (v === "yes" || v === "no"))
      answers[k.slice(2)] = v as NicheAnswer;
  }
  return answers;
}

export async function createBrandAction(formData: FormData) {
  await run("/niche/brands/new", async (s) => {
    const brand = await createBrand(getDb(), s, {
      name: str(formData, "name"),
      customerReference: str(formData, "customerReference"),
      website: str(formData, "website"),
      notes: str(formData, "notes"),
    });
    return { to: `/niche/brands/${brand.id}`, ok: "Brand created." };
  });
}

export async function updateBrandAction(formData: FormData) {
  const id = str(formData, "brandId");
  await run(`/niche/brands/${id}`, async (s) => {
    await updateBrand(getDb(), s, id, {
      name: str(formData, "name"),
      customerReference: str(formData, "customerReference"),
      website: str(formData, "website"),
      notes: str(formData, "notes"),
    });
    return { ok: "Brand updated." };
  });
}

export async function setBrandActiveAction(formData: FormData) {
  const id = str(formData, "brandId");
  const active = str(formData, "active") === "true";
  await run(`/niche/brands/${id}`, async (s) => {
    await setBrandActive(getDb(), s, id, active);
    return { ok: active ? "Brand reactivated." : "Brand deactivated." };
  });
}

export async function mergeBrandAction(formData: FormData) {
  const duplicateId = str(formData, "brandId");
  const survivorId = str(formData, "survivorId");
  await run(`/niche/brands/${duplicateId}`, async (s) => {
    if (!survivorId) throw new ValidationError("Choose the brand to keep.");
    await mergeBrands(getDb(), s, { duplicateId, survivorId });
    return { to: `/niche/brands/${survivorId}`, ok: "Brands merged." };
  });
}

export async function startAssessmentAction(formData: FormData) {
  const brandId = str(formData, "brandId");
  await run(`/niche/assessments/new?brandId=${brandId}`, async (s) => {
    const a = await createAssessmentDraft(getDb(), s, { brandId });
    return { to: `/niche/assessments/${a.id}`, ok: "Draft started." };
  });
}

function draftInput(formData: FormData) {
  return {
    answers: readAnswers(formData),
    reviewerComment: str(formData, "reviewerComment"),
    assessmentDate: str(formData, "assessmentDate") || undefined,
  };
}

export async function saveDraftAction(formData: FormData) {
  const id = str(formData, "assessmentId");
  await run(`/niche/assessments/${id}`, async (s) => {
    await saveAssessmentDraft(getDb(), s, id, draftInput(formData));
    return { ok: "Draft saved." };
  });
}

export async function submitAssessmentAction(formData: FormData) {
  const id = str(formData, "assessmentId");
  await run(`/niche/assessments/${id}`, async (s) => {
    await submitAssessment(getDb(), s, id, draftInput(formData));
    return { ok: "Submitted for review." };
  });
}

export async function withdrawAssessmentAction(formData: FormData) {
  const id = str(formData, "assessmentId");
  await run(`/niche/assessments/${id}`, async (s) => {
    await withdrawAssessment(getDb(), s, id);
    return { ok: "Assessment withdrawn." };
  });
}

export async function reviewAssessmentAction(formData: FormData) {
  const id = str(formData, "assessmentId");
  const decision = str(formData, "decision") === "approve" ? "approve" : "reject";
  await run(`/niche/assessments/${id}`, async (s) => {
    await reviewAssessment(getDb(), s, id, {
      decision,
      comment: str(formData, "comment"),
    });
    return {
      to: "/niche/review",
      ok: decision === "approve" ? "Assessment approved." : "Assessment rejected.",
    };
  });
}
