import { notFound } from "next/navigation";
import {
  canEditNiche,
  canReviewNicheAssessment,
  hasAccessRole,
} from "../../../../auth/authz.js";
import { todayLondon, type NicheAnswers } from "../../../../engine/niche-assessment.js";
import { getDb } from "../../../../lib/db.js";
import {
  getAssessmentAudit,
  getAssessmentDetail,
} from "../../../../services/niche-queries.js";
import { AppShell } from "../../../components/app-shell.js";
import { NICHE_AUDIT_LABELS, NICHE_STATUS_LABELS } from "../../../components/labels.js";
import { NichePill } from "../../../components/niche-pill.js";
import { reviewAssessmentAction, withdrawAssessmentAction } from "../../actions.js";
import { Notice, fmtDate, nicheGate } from "../../gate.js";
import { AssessmentForm } from "./assessment-form.js";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  const { session } = gate;
  const { id } = await params;
  const p = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const db = getDb();
  const d = await getAssessmentDetail(db, id);
  if (!d) notFound();
  const { a, brand, framework } = d;
  const isAssessor = a.assessorId === session.userId;
  const editing = a.status === "draft" && isAssessor && canEditNiche(session);
  const canReview =
    a.status === "submitted" &&
    canReviewNicheAssessment(
      session,
      { assessorId: a.assessorId, escalated: a.escalatedAt !== null },
      framework.reviewerRoleKey,
    );
  const showAudit = hasAccessRole(session, "admin") || hasAccessRole(session, "auditor");
  const audit = showAudit ? await getAssessmentAudit(db, id) : [];
  const answers = a.answers as NicheAnswers;

  const header = (
    <>
      <div className="eyebrow">NICHE BRAND ASSESSMENT</div>
      <div className="page-header">
        <div>
          <h1 style={{ marginBottom: "0.2em" }}>
            {brand.name} <span className="niche-weight">{a.reference}</span>
          </h1>
          <p className="helptext" style={{ margin: 0 }}>
            {NICHE_STATUS_LABELS[a.status]}.{" "}
            <a href={`/niche/brands/${brand.id}`}>Brand page</a>
          </p>
        </div>
        {a.band && <NichePill band={a.band} />}
      </div>
      <Notice ok={p.ok} error={p.error} />
    </>
  );

  if (editing) {
    return (
      <AppShell session={session}>
        <div className="container-wide">
          {header}
          <AssessmentForm
            assessmentId={a.id}
            framework={framework}
            initialAnswers={answers}
            initialComment={a.reviewerComment ?? ""}
            assessmentDate={a.assessmentDate}
            today={todayLondon()}
            brandName={brand.name}
            assessorName={d.assessorName}
            frameworkVersion={d.frameworkVersion}
          />
          <form action={withdrawAssessmentAction} style={{ marginTop: "1rem" }}>
            <input type="hidden" name="assessmentId" value={a.id} />
            <button type="submit" className="btn btn-secondary">
              Discard this draft
            </button>
          </form>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell session={session}>
      <div className="container-wide">
        {header}
        <div className="niche-layout">
          <div>
            {framework.sections.map((s) => (
              <div
                key={s.key}
                className="card niche-section"
                style={{ marginBottom: "1rem" }}
              >
                <h2 style={{ margin: 0, fontSize: "1.0625rem" }}>
                  {s.title}{" "}
                  <span className="niche-weight">
                    {(
                      a.sectionScores as Record<
                        string,
                        { score: number; max: number }
                      > | null
                    )?.[s.key]?.score ?? 0}
                    /{s.criteria.reduce((n, c) => n + c.weight, 0)}
                  </span>
                </h2>
                {s.criteria.map((c) => (
                  <div key={c.key} className="niche-criterion">
                    <div className="niche-criterion-text">
                      {c.text}
                      <span className="niche-weight">{c.weight} pts</span>
                    </div>
                    <span className="niche-yesno-readonly">
                      {answers[c.key] === "yes"
                        ? "Yes"
                        : answers[c.key] === "no"
                          ? "No"
                          : "Not answered"}
                    </span>
                  </div>
                ))}
              </div>
            ))}
            <div className="card">
              <h2 style={{ marginTop: 0, fontSize: "1.0625rem" }}>
                Comments for reviewers
              </h2>
              <p style={{ marginBottom: 0, whiteSpace: "pre-wrap" }}>
                {a.reviewerComment || "None."}
              </p>
            </div>
          </div>

          <aside className="niche-summary">
            <div className="card" style={{ marginBottom: "1rem" }}>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "1.75rem",
                  fontWeight: 600,
                }}
              >
                {a.score ?? "—"} / {framework.maxScore}
              </div>
              <dl className="detail-list">
                <dt>Assessor</dt>
                <dd>{d.assessorName}</dd>
                <dt>Assessment date</dt>
                <dd>{fmtDate(a.assessmentDate)}</dd>
                <dt>Framework</dt>
                <dd>Version {d.frameworkVersion}</dd>
                {a.reviewedAt && (
                  <>
                    <dt>Reviewed by</dt>
                    <dd>
                      {d.reviewerName} on {fmtDate(a.reviewedAt)}
                    </dd>
                  </>
                )}
                {a.validUntil && (
                  <>
                    <dt>Valid until</dt>
                    <dd>{fmtDate(a.validUntil)}</dd>
                  </>
                )}
              </dl>
              {a.escalatedAt && (
                <p className="helptext">Escalated to Admin: {a.escalationReason}</p>
              )}
              {a.reviewComment && (
                <p>
                  <strong>Review comment:</strong> {a.reviewComment}
                </p>
              )}
              <a href={`/niche/assessments/${a.id}/print`} className="btn btn-secondary">
                Print
              </a>
            </div>

            {canReview && (
              <form
                action={reviewAssessmentAction}
                className="card"
                style={{ marginBottom: "1rem" }}
              >
                <h2 style={{ marginTop: 0, fontSize: "1rem" }}>
                  {a.escalatedAt ? "Review (escalated to Admin)" : "Review"}
                </h2>
                <input type="hidden" name="assessmentId" value={a.id} />
                <label htmlFor="comment">Comment (required to reject)</label>
                <textarea id="comment" name="comment" rows={3} />
                <p className="helptext">
                  Approving makes this assessment current for {framework.validityMonths}{" "}
                  months.
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="submit"
                    name="decision"
                    value="approve"
                    className="btn btn-primary"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    name="decision"
                    value="reject"
                    className="btn btn-danger"
                  >
                    Reject
                  </button>
                </div>
              </form>
            )}

            {isAssessor && a.status === "submitted" && (
              <form action={withdrawAssessmentAction} className="card">
                <input type="hidden" name="assessmentId" value={a.id} />
                <button type="submit" className="btn btn-secondary">
                  Withdraw
                </button>
              </form>
            )}
          </aside>
        </div>

        {showAudit && audit.length > 0 && (
          <div className="card" style={{ marginTop: "1.25rem" }}>
            <h2 style={{ marginTop: 0, fontSize: "1.0625rem" }}>Audit trail</h2>
            <table className="data-table">
              <tbody>
                {audit.map((e) => (
                  <tr key={e.id}>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.occurredAt).toLocaleString("en-GB")}
                    </td>
                    <td>{NICHE_AUDIT_LABELS[e.action] ?? e.action}</td>
                    <td>{e.actorName ?? "System"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
