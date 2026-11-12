import { auth } from "../../auth.js";
import {
  briefScopeFor,
  listBriefs,
  type BriefListFilters,
} from "../../services/brief-queries.js";
import { AppShell } from "../components/app-shell.js";
import { StatusPill } from "../components/status-pill.js";
import { getDb } from "../../lib/db.js";
import { listAccountManagersWithBriefs } from "../../services/reporting.js";

const STATUSES = ["pending", "approved", "declined"] as const;
// "A/T" is the legacy merged value on briefs submitted before A and T were split.
const TIERS = ["A", "T", "A/T", "B", "C", "D"];

type SearchParams = {
  q?: string;
  status?: string;
  tier?: string;
  am?: string;
  page?: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function pageHref(params: SearchParams, page: number) {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (params.status) usp.set("status", params.status);
  if (params.tier) usp.set("tier", params.tier);
  if (params.am) usp.set("am", params.am);
  usp.set("page", String(page));
  return `/briefs?${usp.toString()}`;
}

function filterHref(params: SearchParams, status: string | undefined) {
  const usp = new URLSearchParams();
  if (params.q) usp.set("q", params.q);
  if (status) usp.set("status", status);
  if (params.tier) usp.set("tier", params.tier);
  if (params.am) usp.set("am", params.am);
  const qs = usp.toString();
  return qs ? `/briefs?${qs}` : "/briefs";
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const isPastDue = (d: Date | string) => new Date(d).getTime() < Date.now();
const personName = (n: string | null | undefined) =>
  n ? n.replace(/\s*\([^)]*\)\s*$/, "") : "—";

export default async function BriefsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
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

  const params = await searchParams;
  const filters: BriefListFilters = {
    q: params.q,
    status: STATUSES.find((s) => s === params.status),
    tier: TIERS.find((t) => t === params.tier),
    accountManagerId: params.am && UUID.test(params.am) ? params.am : undefined,
    page: Math.max(Number.parseInt(params.page ?? "1", 10) || 1, 1),
  };

  const scope = briefScopeFor(session);
  const result = await listBriefs(getDb(), scope, filters);
  // The Account Manager filter is for people who can see every brief
  // (Admin, Auditor, General Manager); everyone else only sees their own.
  const accountManagers =
    scope.kind === "all" ? await listAccountManagersWithBriefs(getDb()) : [];
  const totalPages = Math.max(Math.ceil(result.total / result.pageSize), 1);
  const seesAll =
    session.accessRoles.includes("admin") || session.accessRoles.includes("auditor");

  return (
    <AppShell session={session}>
      <div className="container-wide">
        <div className="page-header">
          <div>
            <h1 style={{ marginBottom: "0.2em" }}>Briefs</h1>
            <p className="helptext" style={{ margin: 0 }}>
              {result.total} {result.total === 1 ? "brief" : "briefs"}
              {seesAll
                ? ""
                : " you submitted, or that need a decision from a role you hold"}
            </p>
          </div>
        </div>

        <div className="chips" role="group" aria-label="Status">
          {[
            { v: undefined, t: "All" },
            { v: "pending", t: "Pending" },
            { v: "approved", t: "Approved" },
            { v: "declined", t: "Declined" },
          ].map((c) => (
            <a
              key={c.t}
              href={filterHref(params, c.v)}
              className={`chip${filters.status === c.v ? " chip-active" : ""}`}
              aria-current={filters.status === c.v ? "true" : undefined}
            >
              {c.t}
            </a>
          ))}
        </div>

        <form
          method="get"
          className="card filter-bar"
          style={{ marginBottom: "1.25rem" }}
        >
          {filters.status && <input type="hidden" name="status" value={filters.status} />}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              flexWrap: "wrap",
              alignItems: "end",
            }}
          >
            <div style={{ flex: "1 1 220px" }}>
              <label htmlFor="q">Customer or PV reference</label>
              <input id="q" name="q" type="search" defaultValue={params.q ?? ""} />
            </div>
            {accountManagers.length > 0 && (
              <div>
                <label htmlFor="am">Account Manager</label>
                <select id="am" name="am" defaultValue={filters.accountManagerId ?? ""}>
                  <option value="">Anyone</option>
                  {accountManagers.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label htmlFor="tier">Tier</label>
              <select id="tier" name="tier" defaultValue={filters.tier ?? ""}>
                <option value="">Any</option>
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit" className="btn btn-primary">
              Filter
            </button>
            <a href="/briefs" className="btn btn-secondary">
              Reset
            </a>
          </div>
        </form>

        {result.rows.length === 0 ? (
          <div className="card">
            <p style={{ margin: 0 }}>
              No briefs match these filters. <a href="/briefs">Clear filters</a>
            </p>
          </div>
        ) : (
          <div className="card" style={{ padding: 0, overflowX: "auto" }}>
            <table className="data-table data-table-flush">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Tier</th>
                  <th className="num">Value</th>
                  <th>Account Manager</th>
                  <th>Submitted</th>
                  <th>Deadline</th>
                  <th className="num">Score</th>
                  <th>Status</th>
                  <th>Approval Code</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((b) => (
                  <tr key={b.id}>
                    <td style={{ fontWeight: 500 }}>
                      <a href={`/briefs/${b.id}`}>{b.customerReference}</a>
                    </td>
                    <td>
                      <span className="tier-badge">{b.tier}</span>
                    </td>
                    <td className="num">
                      £{Number(b.valuePotentialGbp).toLocaleString("en-GB")}
                    </td>
                    <td>
                      {personName(b.onBehalfOfName ?? b.submitterName)}
                      {b.onBehalfOfName && (
                        <span className="cell-sub">by {personName(b.submitterName)}</span>
                      )}
                    </td>
                    <td style={{ color: "var(--cpl-ink-soft)" }}>
                      {DATE.format(new Date(b.submittedAt))}
                    </td>
                    <td
                      style={{
                        color:
                          b.finalStatus === "pending" && isPastDue(b.deadline)
                            ? "var(--cpl-red)"
                            : "var(--cpl-ink-soft)",
                      }}
                    >
                      {DATE.format(new Date(b.deadline))}
                    </td>
                    <td className="num">
                      {Number(b.computedScore).toLocaleString("en-GB", {
                        maximumFractionDigits: 1,
                      })}
                    </td>
                    <td>
                      <StatusPill status={b.finalStatus} />
                      {b.outstandingRequirements > 0 && (
                        <span className="cell-sub">
                          {b.outstandingRequirements} sign-off
                          {b.outstandingRequirements === 1 ? "" : "s"} outstanding
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {b.approvalCode ? (
                        <code className="code-chip">{b.approvalCode}</code>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              alignItems: "center",
              marginTop: "1rem",
            }}
          >
            {result.page > 1 && (
              <a className="btn" href={pageHref(params, result.page - 1)}>
                Previous
              </a>
            )}
            <span className="helptext">
              Showing {(result.page - 1) * result.pageSize + 1}–
              {Math.min(result.page * result.pageSize, result.total)} of {result.total} ·
              Page {result.page} of {totalPages}
            </span>
            {result.page < totalPages && (
              <a className="btn" href={pageHref(params, result.page + 1)}>
                Next
              </a>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
