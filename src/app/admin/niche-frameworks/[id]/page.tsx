import { notFound } from "next/navigation";
import { canManageNicheFrameworks } from "../../../../auth/authz.js";
import {
  getFramework,
  listApprovalAuthorityRoleKeys,
  replayFramework,
} from "../../../../services/niche-framework-editor.js";
import { AppShell } from "../../../components/app-shell.js";
import { getDb } from "../../../../lib/db.js";
import { Notice, currentSession } from "../../../niche/gate.js";
import { NICHE_BAND_LABELS } from "../../../components/labels.js";
import { FrameworkEditor } from "./editor.js";
import {
  discardFrameworkAction,
  publishFrameworkAction,
  replayFrameworkAction,
  saveFrameworkAction,
} from "../actions.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NicheFrameworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ ok?: string; error?: string; replay?: string }>;
}) {
  const session = await currentSession();
  if (!session || !canManageNicheFrameworks(session)) {
    return (
      <AppShell session={session}>
        <div className="container">
          <div className="card" style={{ marginTop: "3rem" }}>
            <p style={{ margin: 0 }}>
              {session ? "Requires the Admin role." : "Sign in first."}
            </p>
          </div>
        </div>
      </AppShell>
    );
  }
  const { id } = await params;
  const { ok, error, replay } = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const db = getDb();
  const fw = await getFramework(db, id);
  if (!fw) notFound();
  const roles = await listApprovalAuthorityRoleKeys(db);
  const isDraft = fw.status === "draft";
  const result = replay && isDraft ? await replayFramework(db, id) : null;
  const band = (k: string | null) => (k ? (NICHE_BAND_LABELS[k] ?? k) : "Incomplete");

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="eyebrow">
          <a href="/admin/niche-frameworks">NICHE FRAMEWORKS</a> / v{fw.version}
        </div>
        <div className="page-header">
          <h1>
            Framework v{fw.version} <span className="helptext">({fw.status})</span>
          </h1>
        </div>
        <Notice ok={ok} error={error} />
        {!isDraft && (
          <p className="helptext">
            Published and superseded frameworks are read only. To change the framework,
            create a new draft.
          </p>
        )}
        <FrameworkEditor
          id={fw.id}
          initial={fw.payload}
          readOnly={!isDraft}
          roles={roles}
          saveAction={saveFrameworkAction}
        />

        {isDraft && (
          <>
            <div className="card" style={{ marginTop: "1.25rem" }}>
              <h2>Replay against existing assessments</h2>
              <p className="helptext">
                Re-scores every submitted assessment with this draft. Read only: nothing
                is recalculated or changed. Criteria new in this draft count as
                &ldquo;No&rdquo;.
              </p>
              <form action={replayFrameworkAction}>
                <input type="hidden" name="id" value={fw.id} />
                <button type="submit" className="btn">
                  Run replay
                </button>
              </form>
              {result && (
                <div style={{ marginTop: "1rem" }}>
                  <p>
                    {result.totalEvaluated} assessments evaluated;{" "}
                    <strong>{result.changes.length}</strong> would change.
                  </p>
                  {result.warnings.map((w) => (
                    <p key={w} className="helptext">
                      Warning: {w}
                    </p>
                  ))}
                  {result.changes.length > 0 && (
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Reference</th>
                          <th>Brand</th>
                          <th>Status</th>
                          <th>Was</th>
                          <th>Would be</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.changes.map((c) => (
                          <tr key={c.assessmentId}>
                            <td>
                              <a href={`/niche/assessments/${c.assessmentId}`}>
                                {c.reference}
                              </a>
                            </td>
                            <td>{c.brandName}</td>
                            <td>{c.status}</td>
                            <td>
                              {band(c.fromBand)} ({c.fromScore})
                            </td>
                            <td>
                              {band(c.toBand)} ({c.toScore})
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
            <div
              className="card"
              style={{
                marginTop: "1.25rem",
                display: "flex",
                gap: "0.75rem",
                flexWrap: "wrap",
              }}
            >
              <form action={publishFrameworkAction}>
                <input type="hidden" name="id" value={fw.id} />
                <button type="submit" className="btn btn-primary">
                  Publish this version
                </button>
              </form>
              <form action={discardFrameworkAction}>
                <input type="hidden" name="id" value={fw.id} />
                <button type="submit" className="btn">
                  Discard draft
                </button>
              </form>
              <p className="helptext" style={{ margin: 0, alignSelf: "center" }}>
                Publishing supersedes the current version for new assessments. Existing
                assessments keep the version they were scored with.
              </p>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
