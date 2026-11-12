import { notFound } from "next/navigation";
import { canEditNiche, canManageNicheBrands } from "../../../../auth/authz.js";
import { getDb } from "../../../../lib/db.js";
import { getBrandDetail, listNicheBrands } from "../../../../services/niche-queries.js";
import { AppShell } from "../../../components/app-shell.js";
import { NICHE_ROUTE_LABELS, NICHE_STATUS_LABELS } from "../../../components/labels.js";
import { NichePill } from "../../../components/niche-pill.js";
import { StatusPill } from "../../../components/status-pill.js";
import {
  mergeBrandAction,
  setBrandActiveAction,
  updateBrandAction,
} from "../../actions.js";
import { Notice, fmtDate, nicheGate } from "../../gate.js";

export const dynamic = "force-dynamic";

export default async function BrandPage({
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
  const detail = await getBrandDetail(db, id);
  if (!detail) notFound();
  const { brand, history, current, briefs } = detail;
  const canEdit = canEditNiche(session);
  const admin = canManageNicheBrands(session);
  const others = admin
    ? (await listNicheBrands(db, {})).filter((b) => b.id !== brand.id)
    : [];
  const open = history.find((h) => h.a.status === "draft" || h.a.status === "submitted");

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">NICHE BRAND</div>
        <div className="page-header">
          <div>
            <h1 style={{ marginBottom: "0.2em" }}>{brand.name}</h1>
            <p className="helptext" style={{ margin: 0 }}>
              {brand.customerReference
                ? `Customer reference: ${brand.customerReference}. `
                : ""}
              {brand.mergedIntoId
                ? "Merged into another brand."
                : brand.active
                  ? ""
                  : "Deactivated."}
            </p>
          </div>
          {canEdit && brand.active && !open && (
            <a
              href={`/niche/assessments/new?brandId=${brand.id}`}
              className="btn btn-primary"
            >
              {current ? "Reassess" : "Start assessment"}
            </a>
          )}
          {open && (
            <a href={`/niche/assessments/${open.a.id}`} className="btn btn-secondary">
              Open {open.a.reference} ({NICHE_STATUS_LABELS[open.a.status]})
            </a>
          )}
        </div>
        <Notice ok={p.ok} error={p.error} />

        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2 style={{ marginTop: 0 }}>Current assessment</h2>
          {current ? (
            <p style={{ marginBottom: 0 }}>
              <NichePill band={current.a.band} /> score {current.a.score} / 100,{" "}
              <a href={`/niche/assessments/${current.a.id}`}>{current.a.reference}</a>,
              valid until {fmtDate(current.a.validUntil)}. Approved by{" "}
              {current.reviewerName}.
            </p>
          ) : (
            <p style={{ marginBottom: 0 }}>
              No current approved assessment. Briefs for this brand are scored as standard
              briefs until one is approved.
            </p>
          )}
        </div>

        <div
          className="card"
          style={{ padding: 0, overflow: "hidden", marginBottom: "1.25rem" }}
        >
          <h2 style={{ margin: "1rem 1.25rem 0" }}>Assessment history</h2>
          {history.length === 0 ? (
            <p style={{ margin: "1rem 1.25rem" }}>No assessments yet.</p>
          ) : (
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Reference</th>
                  <th>Date</th>
                  <th>Assessor</th>
                  <th>Outcome</th>
                  <th className="num">Score</th>
                  <th>Status</th>
                  <th>Valid until</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.a.id}>
                    <td>
                      <a href={`/niche/assessments/${h.a.id}`}>{h.a.reference}</a>
                    </td>
                    <td>{fmtDate(h.a.assessmentDate)}</td>
                    <td>{h.assessorName}</td>
                    <td>{h.a.band ? <NichePill band={h.a.band} /> : "—"}</td>
                    <td className="num">{h.a.score ?? "—"}</td>
                    <td>{NICHE_STATUS_LABELS[h.a.status]}</td>
                    <td>{fmtDate(h.a.validUntil)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div
          className="card"
          style={{ padding: 0, overflow: "hidden", marginBottom: "1.25rem" }}
        >
          <h2 style={{ margin: "1rem 1.25rem 0" }}>Briefs for this brand</h2>
          {briefs.length === 0 ? (
            <p style={{ margin: "1rem 1.25rem" }}>No briefs yet.</p>
          ) : (
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Brief</th>
                  <th>Submitted</th>
                  <th>Assessment used</th>
                  <th>Route</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {briefs.map((b) => {
                  const snap = b.snapshot as { reference?: string; band?: string } | null;
                  return (
                    <tr key={b.id}>
                      <td>
                        <a href={`/briefs/${b.id}`}>{b.customerReference}</a>
                      </td>
                      <td>{fmtDate(b.submittedAt)}</td>
                      <td>{snap?.reference ?? "None current"}</td>
                      <td>{b.route ? NICHE_ROUTE_LABELS[b.route] : "—"}</td>
                      <td>
                        <StatusPill status={b.finalStatus} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {canEdit && !brand.mergedIntoId && (
          <form
            action={updateBrandAction}
            className="card"
            style={{ marginBottom: "1.25rem" }}
          >
            <h2 style={{ marginTop: 0 }}>Brand details</h2>
            <input type="hidden" name="brandId" value={brand.id} />
            <div className="field-row field-row-2">
              <div className="field-group">
                <label htmlFor="name">Brand name</label>
                <input id="name" name="name" required defaultValue={brand.name} />
              </div>
              <div className="field-group">
                <label htmlFor="customerReference">Customer reference</label>
                <input
                  id="customerReference"
                  name="customerReference"
                  defaultValue={brand.customerReference ?? ""}
                />
              </div>
            </div>
            <div className="field-group">
              <label htmlFor="website">Website</label>
              <input id="website" name="website" defaultValue={brand.website ?? ""} />
            </div>
            <div className="field-group">
              <label htmlFor="notes">Notes</label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                defaultValue={brand.notes ?? ""}
              />
            </div>
            <button type="submit" className="btn btn-secondary">
              Save details
            </button>
          </form>
        )}

        {admin && !brand.mergedIntoId && (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Admin</h2>
            <form action={setBrandActiveAction} style={{ marginBottom: "1rem" }}>
              <input type="hidden" name="brandId" value={brand.id} />
              <input
                type="hidden"
                name="active"
                value={brand.active ? "false" : "true"}
              />
              <button type="submit" className="btn btn-secondary">
                {brand.active ? "Deactivate brand" : "Reactivate brand"}
              </button>
            </form>
            <form action={mergeBrandAction}>
              <input type="hidden" name="brandId" value={brand.id} />
              <label htmlFor="survivorId">
                Merge this brand into another (this one is the duplicate)
              </label>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <select id="survivorId" name="survivorId" defaultValue="">
                  <option value="">Choose the brand to keep</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
                <button type="submit" className="btn btn-danger">
                  Merge
                </button>
              </div>
              <p className="helptext">
                Moves this brand&apos;s assessments and briefs to the brand you keep and
                deactivates this one. Existing decisions keep their stored assessment
                details.
              </p>
            </form>
          </div>
        )}
      </div>
    </AppShell>
  );
}
