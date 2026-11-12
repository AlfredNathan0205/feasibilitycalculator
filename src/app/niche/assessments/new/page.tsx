import { notFound, redirect } from "next/navigation";
import { canEditNiche } from "../../../../auth/authz.js";
import { getDb } from "../../../../lib/db.js";
import {
  getBrandDetail,
  getPublishedFrameworkPayload,
} from "../../../../services/niche-queries.js";
import { AppShell } from "../../../components/app-shell.js";
import { NichePill } from "../../../components/niche-pill.js";
import { startAssessmentAction } from "../../actions.js";
import { Notice, fmtDate, nicheGate } from "../../gate.js";

export const dynamic = "force-dynamic";

export default async function NewAssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ brandId?: string; error?: string }>;
}) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  if (!canEditNiche(gate.session)) redirect("/niche?error=You+cannot+start+assessments.");
  const p = await searchParams;
  if (!p.brandId || !/^[0-9a-f-]{36}$/i.test(p.brandId)) redirect("/niche");
  const db = getDb();
  const [detail, fw] = await Promise.all([
    getBrandDetail(db, p.brandId),
    getPublishedFrameworkPayload(db),
  ]);
  if (!detail) notFound();

  return (
    <AppShell session={gate.session}>
      <div className="container">
        <div className="eyebrow">NICHE BRANDS</div>
        <h1>
          {detail.current ? "Reassess" : "Assess"} {detail.brand.name}
        </h1>
        <Notice error={p.error} />
        <div className="card">
          {detail.current && (
            <p>
              <NichePill band={detail.current.a.band} /> is currently approved until{" "}
              {fmtDate(detail.current.a.validUntil)}. It stays in force until a new
              assessment is approved.
            </p>
          )}
          <p>
            You will answer{" "}
            {fw ? fw.payload.sections.reduce((n, s) => n + s.criteria.length, 0) : "the"}{" "}
            Yes / No questions using framework version {fw?.version ?? "?"}. Your answers
            are saved as a draft and sent to a reviewer when you submit.
          </p>
          <form action={startAssessmentAction}>
            <input type="hidden" name="brandId" value={detail.brand.id} />
            <button type="submit" className="btn btn-primary" disabled={!fw}>
              Start assessment
            </button>{" "}
            <a href={`/niche/brands/${detail.brand.id}`} className="btn btn-secondary">
              Cancel
            </a>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
