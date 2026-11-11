import { redirect } from "next/navigation";
import {
  canReviewNicheAssessment,
  hasAccessRole,
  holdsNicheReviewerRole,
} from "../../../auth/authz.js";
import { getDb } from "../../../lib/db.js";
import { listReviewQueue } from "../../../services/niche-queries.js";
import { AppShell } from "../../components/app-shell.js";
import { NichePill } from "../../components/niche-pill.js";
import { Notice, fmtDate, nicheGate } from "../gate.js";

export const dynamic = "force-dynamic";

export default async function ReviewQueuePage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string }>;
}) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  const { session } = gate;
  if (!holdsNicheReviewerRole(session) && !hasAccessRole(session, "admin")) {
    redirect("/niche?error=The+review+queue+is+for+the+reviewer+role+and+Admins.");
  }
  const p = await searchParams;
  const rows = await listReviewQueue(getDb());

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">NICHE BRANDS</div>
        <div className="page-header">
          <h1>Assessments awaiting review</h1>
        </div>
        <Notice ok={p.ok} error={p.error} />
        {rows.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>Nothing is waiting for review.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Brand</th>
                  <th>Assessor</th>
                  <th>Submitted</th>
                  <th>Outcome</th>
                  <th className="num">Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ a, brandName, assessorName }) => {
                  const mine = canReviewNicheAssessment(session, {
                    assessorId: a.assessorId,
                    escalated: a.escalatedAt !== null,
                  });
                  return (
                    <tr key={a.id}>
                      <td>
                        <a href={`/niche/assessments/${a.id}`}>{a.reference}</a>
                      </td>
                      <td>{brandName}</td>
                      <td>{assessorName}</td>
                      <td>{fmtDate(a.submittedAt)}</td>
                      <td>
                        <NichePill band={a.band} />
                      </td>
                      <td className="num">{a.score}</td>
                      <td>
                        {a.escalatedAt && (
                          <span className="helptext">Escalated to Admin. </span>
                        )}
                        {mine ? "Needs your review" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
