import { notFound } from "next/navigation";
import { auth } from "../../../auth.js";
import { briefScopeFor, getBriefDetail } from "../../../services/brief-queries.js";
import { AppShell } from "../../components/app-shell.js";
import { StatusPill } from "../../components/status-pill.js";
import {
  COMMERCIAL_LABELS,
  REQUIREMENT_LABELS,
  REQUIREMENT_STATE_LABELS,
} from "../../components/labels.js";
import { getDb } from "../../../lib/db.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fmtDateTime(d: Date | string | null) {
  return d ? new Date(d).toLocaleString("en-GB") : "—";
}

function yesNo(v: boolean) {
  return v ? "Yes" : "No";
}

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session) {
    return (
      <AppShell session={null}>
        <div className="container">
          <p style={{ marginTop: "3rem" }}>
            <a href="/">Sign in</a> first.
          </p>
        </div>
      </AppShell>
    );
  }

  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();

  const detail = await getBriefDetail(getDb(), briefScopeFor(session), id);
  if (!detail) notFound();

  const { brief, decision } = detail;
  const breakdown = (decision.scoreBreakdown ?? {}) as Record<string, number>;

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">
          <a href="/briefs">BRIEFS</a> / DETAIL
        </div>
        <div className="page-header">
          <div>
            <h1 style={{ marginBottom: "0.2em" }}>{brief.customerReference}</h1>
            <p className="helptext" style={{ margin: 0 }}>
              Submitted {fmtDateTime(brief.submittedAt)} by {detail.submitterName ?? "—"}
              {detail.onBehalfOfName ? ` on behalf of ${detail.onBehalfOfName}` : ""}
            </p>
          </div>
          <StatusPill status={decision.finalStatus} />
        </div>

        <div className="kpi-strip">
          <div className="kpi-card">
            <div className="kpi-label">Score</div>
            <div className="kpi-value">{Number(decision.computedScore).toFixed(1)}</div>
            <div className="kpi-caption">Rule set v{detail.ruleSetVersion ?? "?"}</div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Commercial decision</div>
            <div className="kpi-value" style={{ fontSize: "1.1rem" }}>
              {COMMERCIAL_LABELS[decision.commercialDecision] ??
                decision.commercialDecision}
            </div>
          </div>
          <div className="kpi-card">
            <div className="kpi-label">Approval Code</div>
            <div className="kpi-value" style={{ fontSize: "1.1rem" }}>
              {decision.approvalCode ?? "Not issued"}
            </div>
            <div className="kpi-caption">
              {decision.codeIssuedAt
                ? `Issued ${fmtDateTime(decision.codeIssuedAt)}`
                : "Issued once every requirement clears"}
            </div>
          </div>
        </div>

        <div className="panel-grid">
          <div className="card">
            <h2>Brief inputs</h2>
            <dl className="detail-list">
              <dt>Tier</dt>
              <dd>{brief.tier}</dd>
              <dt>Value potential</dt>
              <dd>£{Number(brief.valuePotentialGbp).toLocaleString("en-GB")}</dd>
              <dt>New / rework</dt>
              <dd>{brief.newRework}</dd>
              <dt>Brief type</dt>
              <dd>{brief.briefType}</dd>
              <dt>Customer approval</dt>
              <dd>{brief.customerApproval}</dd>
              <dt>Creative approach</dt>
              <dd>{brief.creativeApproach}</dd>
              <dt>Deadline</dt>
              <dd>{new Date(brief.deadline).toLocaleDateString("en-GB")}</dd>
              <dt>Niche / FF pre-approved</dt>
              <dd>
                {yesNo(brief.nicheFfPreApproved)}
                {brief.nicheFfRationale ? ` — ${brief.nicheFfRationale}` : ""}
              </dd>
              <dt>Strategic priority</dt>
              <dd>
                {yesNo(brief.strategicPriority)}
                {brief.strategicPriorityRationale
                  ? ` — ${brief.strategicPriorityRationale}`
                  : ""}
              </dd>
              <dt>Resources</dt>
              <dd>
                Marketing {yesNo(brief.marketingFlag)} · PPD {yesNo(brief.ppdFlag)} · GCMS{" "}
                {yesNo(brief.gcmsFlag)}
              </dd>
              {brief.pvReference && (
                <>
                  <dt>PV reference</dt>
                  <dd>{brief.pvReference}</dd>
                </>
              )}
            </dl>
          </div>

          <div className="card">
            <h2>Score breakdown</h2>
            {Object.keys(breakdown).length === 0 ? (
              <p className="helptext" style={{ margin: 0 }}>
                No breakdown recorded.
              </p>
            ) : (
              <table className="data-table">
                <tbody>
                  {Object.entries(breakdown).map(([k, v]) => (
                    <tr key={k}>
                      <td>
                        {k
                          .replace(/([A-Z])/g, " $1")
                          .replace(/^./, (c) => c.toUpperCase())}
                      </td>
                      <td className="num">{Number(v).toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="card" style={{ marginTop: "1.25rem" }}>
          <h2>Approval requirements</h2>
          {detail.requirements.length === 0 ? (
            <p className="helptext" style={{ margin: 0 }}>
              No additional approvals were required.
            </p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Requirement</th>
                  <th>Role</th>
                  <th>State</th>
                  <th>Decided by</th>
                  <th>When</th>
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                {detail.requirements.map((r) => (
                  <tr key={r.id}>
                    <td>{REQUIREMENT_LABELS[r.requirementType] ?? r.requirementType}</td>
                    <td>{r.requiredRoleKey.replace(/_/g, " ")}</td>
                    <td>{REQUIREMENT_STATE_LABELS[r.state] ?? r.state}</td>
                    <td>
                      {r.state === "pre_approved"
                        ? (r.preApprovalNominatedManagerName ?? "—")
                        : (r.decidedByName ?? "—")}
                    </td>
                    <td>{fmtDateTime(r.decidedAt)}</td>
                    <td>{r.comment ?? r.preApprovalSubmitterComment ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {session.accessRoles.some((r) => r === "admin" || r === "auditor") && (
          <div className="card" style={{ marginTop: "1.25rem" }}>
            <h2>Audit trail</h2>
            {detail.auditEvents.length === 0 ? (
              <p className="helptext" style={{ margin: 0 }}>
                No audit events recorded.
              </p>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Event</th>
                    <th>Entity</th>
                    <th>Actor</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.auditEvents.map((e) => (
                    <tr key={e.id}>
                      <td>{fmtDateTime(e.occurredAt)}</td>
                      <td
                        style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}
                      >
                        {e.action}
                      </td>
                      <td>{e.entityType.replace(/_/g, " ")}</td>
                      <td>{e.actorName ?? "System"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
