import { canEditNiche, holdsNicheReviewerRole, hasAccessRole } from "../../auth/authz.js";
import { getDb } from "../../lib/db.js";
import { listNicheBrands, type BrandState } from "../../services/niche-queries.js";
import { AppShell } from "../components/app-shell.js";
import { NICHE_BAND_LABELS } from "../components/labels.js";
import { NichePill } from "../components/niche-pill.js";
import { Notice, fmtDate, nicheGate } from "./gate.js";

export const dynamic = "force-dynamic";

const STATES: Array<{ value: BrandState; label: string }> = [
  { value: "current", label: "Current" },
  { value: "expiring", label: "Expiring within 30 days" },
  { value: "expired", label: "Expired" },
  { value: "none", label: "Never assessed" },
];
const STATE_TEXT: Record<BrandState, string> = {
  current: "Current",
  expiring: "Expiring soon",
  expired: "Expired",
  none: "No approved assessment",
};

export default async function NichePage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    band?: string;
    state?: string;
    ok?: string;
    error?: string;
  }>;
}) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  const { session } = gate;
  const p = await searchParams;
  const state = STATES.find((s) => s.value === p.state)?.value ?? "";
  const band = p.band && p.band in NICHE_BAND_LABELS ? p.band : "";
  const brands = await listNicheBrands(getDb(), {
    q: p.q,
    band,
    state,
    includeInactive: hasAccessRole(session, "admin"),
  });
  const canEdit = canEditNiche(session);
  const reviewer = holdsNicheReviewerRole(session) || hasAccessRole(session, "admin");

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">NICHE BRANDS</div>
        <div className="page-header">
          <div>
            <h1 style={{ marginBottom: "0.2em" }}>Niche brand assessments</h1>
            <p className="helptext" style={{ margin: 0 }}>
              A brand is assessed once, reviewed and approved, and every brief for that
              brand inherits the outcome while the assessment is valid.
            </p>
          </div>
          <div className="page-header-actions">
            {reviewer && (
              <a href="/niche/review" className="btn btn-secondary">
                Review queue
              </a>
            )}
            {canEdit && (
              <a href="/niche/brands/new" className="btn btn-primary">
                New brand
              </a>
            )}
          </div>
        </div>
        <Notice ok={p.ok} error={p.error} />

        <form method="get" className="card" style={{ marginBottom: "1.25rem" }}>
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="q">Brand name or customer reference</label>
              <input id="q" name="q" type="search" defaultValue={p.q ?? ""} />
            </div>
            <div>
              <label htmlFor="band">Outcome</label>
              <select id="band" name="band" defaultValue={band}>
                <option value="">Any</option>
                {Object.entries(NICHE_BAND_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="state">Validity</label>
              <select id="state" name="state" defaultValue={state}>
                <option value="">Any</option>
                {STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              Filter
            </button>
            <a href="/niche" className="btn btn-secondary">
              Reset
            </a>
          </div>
        </form>

        {brands.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>No brands match.</p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Customer reference</th>
                  <th>Outcome</th>
                  <th className="num">Score</th>
                  <th>Valid until</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>
                      <a href={`/niche/brands/${b.id}`}>{b.name}</a>
                      {!b.active && <span className="helptext"> (deactivated)</span>}
                    </td>
                    <td style={{ color: "var(--cpl-ink-soft)" }}>
                      {b.customerReference ?? "—"}
                    </td>
                    <td>
                      {b.latest && b.state !== "expired" ? (
                        <NichePill band={b.latest.band} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="num">
                      {b.latest && b.state !== "expired" ? b.latest.score : "—"}
                    </td>
                    <td>{fmtDate(b.latest?.validUntil)}</td>
                    <td>
                      {STATE_TEXT[b.state]}
                      {b.pending && (
                        <span className="helptext" style={{ marginLeft: "0.5em" }}>
                          <a href={`/niche/assessments/${b.pending.id}`}>
                            {b.pending.reference} awaiting review
                          </a>
                        </span>
                      )}
                    </td>
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
