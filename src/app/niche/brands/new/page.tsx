import { redirect } from "next/navigation";
import { canEditNiche } from "../../../../auth/authz.js";
import { getDb } from "../../../../lib/db.js";
import { findSimilarBrands } from "../../../../services/niche-assessments.js";
import { AppShell } from "../../../components/app-shell.js";
import { createBrandAction } from "../../actions.js";
import { Notice, nicheGate } from "../../gate.js";

export const dynamic = "force-dynamic";

export default async function NewBrandPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; error?: string }>;
}) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  if (!canEditNiche(gate.session)) redirect("/niche?error=You+cannot+create+brands.");
  const p = await searchParams;
  // Duplicate warning: shown when the name typed so far resembles an existing brand.
  const similar = p.name ? await findSimilarBrands(getDb(), p.name) : [];

  return (
    <AppShell session={gate.session}>
      <div className="container">
        <div className="eyebrow">NICHE BRANDS</div>
        <h1>New brand</h1>
        <Notice error={p.error} />
        <form method="get" className="card" style={{ marginBottom: "1rem" }}>
          <label htmlFor="check">Check the name first</label>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input id="check" name="name" defaultValue={p.name ?? ""} />
            <button className="btn btn-secondary" type="submit">
              Check for duplicates
            </button>
          </div>
          {p.name && similar.length > 0 && (
            <div role="alert" style={{ marginTop: "0.75rem" }}>
              <strong>Similar brands already exist:</strong>
              <ul>
                {similar.map((b) => (
                  <li key={b.id}>
                    <a href={`/niche/brands/${b.id}`}>{b.name}</a>
                  </li>
                ))}
              </ul>
              <span className="helptext">
                Use the existing brand if it is the same one.
              </span>
            </div>
          )}
          {p.name && similar.length === 0 && (
            <p className="helptext" style={{ marginBottom: 0 }}>
              No similar brand found.
            </p>
          )}
        </form>
        <form action={createBrandAction} className="card">
          <div className="field-group">
            <label htmlFor="name">Brand name</label>
            <input id="name" name="name" required defaultValue={p.name ?? ""} />
          </div>
          <div className="field-group">
            <label htmlFor="customerReference">Customer reference (optional)</label>
            <input id="customerReference" name="customerReference" />
            <p className="helptext">
              The name Account Managers type on briefs for this customer.
            </p>
          </div>
          <div className="field-group">
            <label htmlFor="website">Website (optional)</label>
            <input id="website" name="website" />
          </div>
          <div className="field-group">
            <label htmlFor="notes">Notes (optional)</label>
            <textarea id="notes" name="notes" rows={3} />
          </div>
          <button type="submit" className="btn btn-primary">
            Create brand
          </button>
        </form>
      </div>
    </AppShell>
  );
}
