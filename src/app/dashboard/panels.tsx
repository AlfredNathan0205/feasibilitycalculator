import type { DashboardSummary } from "../../services/reporting.js";
import { NICHE_BAND_LABELS } from "../components/labels.js";

function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card panel">
      <h2>{title}</h2>
      {note && <p className="panel-note">{note}</p>}
      {children}
    </section>
  );
}

function SimpleTable({
  columns,
  rows,
}: {
  columns: {
    key: string;
    label: string;
    format?: (v: unknown) => string;
    render?: (v: unknown) => React.ReactNode;
    num?: boolean;
  }[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return <p className="panel-empty">Nothing to show yet.</p>;
  }
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} className={c.num ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key} className={c.num ? "num" : undefined}>
                  {c.render
                    ? c.render(row[c.key])
                    : c.format
                      ? c.format(row[c.key])
                      : String(row[c.key] ?? "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((count / max) * 100)) : 0;
  return (
    <div className="bar-row">
      <span className="bar-row-label" title={label}>
        {label}
      </span>
      <span className="bar-track">
        <span className="bar-fill" style={{ width: `${count > 0 ? pct : 0}%` }} />
      </span>
      <span className="bar-value">{count.toLocaleString("en-GB")}</span>
    </div>
  );
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
function monthLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${MONTHS[Number(mo) - 1] ?? mo} ${String(y).slice(2)}`;
}

const STATUS_ORDER = ["approved", "pending", "declined"] as const;

/** Briefs per month, stacked by outcome. Plain divs: no charting library for four series. */
function OutcomeColumns({ rows }: { rows: DashboardSummary["volumeOutcomeMixByMonth"] }) {
  const months = [...new Set(rows.map((r) => r.month))].sort();
  if (months.length === 0) return <p className="panel-empty">Nothing to show yet.</p>;
  const data = months.map((m) => {
    const by: Record<string, number> = {};
    for (const r of rows) if (r.month === m) by[r.finalStatus] = r.count;
    const total = STATUS_ORDER.reduce((s, k) => s + (by[k] ?? 0), 0);
    return { m, by, total };
  });
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div>
      <div className="columns" role="img" aria-label="Briefs per month by outcome">
        {data.map((d) => (
          <div className="column" key={d.m}>
            <span className="column-total">{d.total.toLocaleString("en-GB")}</span>
            <div className="column-stack" style={{ height: `${(d.total / max) * 100}%` }}>
              {[...STATUS_ORDER]
                .reverse()
                .map((k) =>
                  (d.by[k] ?? 0) > 0 ? (
                    <span
                      key={k}
                      className={`seg seg-${k}`}
                      style={{ flexGrow: d.by[k] }}
                      title={`${monthLabel(d.m)}: ${d.by[k]} ${k}`}
                    />
                  ) : null,
                )}
            </div>
            <span className="column-label">{monthLabel(d.m)}</span>
          </div>
        ))}
      </div>
      <div className="legend">
        {STATUS_ORDER.map((k) => (
          <span key={k}>
            <i className={`seg-${k}`} /> {k[0]!.toUpperCase() + k.slice(1)}
          </span>
        ))}
      </div>
    </div>
  );
}

export function DashboardPanels({
  summary,
  filtered = false,
}: {
  summary: DashboardSummary;
  filtered?: boolean;
}) {
  const tierMax = Math.max(1, ...summary.volumeByTier.map((r) => r.count));
  const reqTypeMax = Math.max(1, ...summary.volumeByRequirementType.map((r) => r.count));
  const scoreMax = Math.max(1, ...summary.scoreDistribution.map((b) => b.count));
  const deadlineMax = Math.max(
    1,
    ...summary.shortDeadlineVolumeByMonth.map((r) => r.count),
  );

  const byStatus = (s: string) =>
    summary.volumeOutcomeMixByMonth
      .filter((r) => r.finalStatus === s)
      .reduce((n, r) => n + r.count, 0);
  const approved = byStatus("approved");
  const pending = byStatus("pending");
  const declined = byStatus("declined");
  const total = approved + pending + declined;
  const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const totalValue = summary.monthlyActivity.reduce(
    (n, r) => n + Number(r.valuePotentialGbp),
    0,
  );
  const gbp = (n: number) =>
    n >= 1_000_000
      ? `£${(n / 1_000_000).toFixed(1)}m`
      : n >= 1_000
        ? `£${Math.round(n / 1_000).toLocaleString("en-GB")}k`
        : `£${n}`;

  return (
    <>
      <div className="kpi-strip">
        <div className="kpi-card">
          <div className="kpi-label">Briefs</div>
          <div className="kpi-value">{total.toLocaleString("en-GB")}</div>
          <div className="kpi-caption">{gbp(totalValue)} total value potential</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Approved</div>
          <div className="kpi-value">{pct(approved)}%</div>
          <div className="kpi-caption">{approved.toLocaleString("en-GB")} briefs</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Waiting on sign-off</div>
          <div className="kpi-value">{pending.toLocaleString("en-GB")}</div>
          <div className="kpi-caption">{pct(pending)}% of briefs</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label">Declined</div>
          <div className="kpi-value">{declined.toLocaleString("en-GB")}</div>
          <div className="kpi-caption">{pct(declined)}% of briefs</div>
        </div>
      </div>

      <div className="outcome-split" aria-hidden="true">
        <span className="seg-approved" style={{ flexGrow: approved }} />
        <span className="seg-pending" style={{ flexGrow: pending }} />
        <span className="seg-declined" style={{ flexGrow: declined }} />
      </div>

      <div className="panel-grid panel-grid-2">
        <Panel title="Briefs per month" note="By outcome. Hover a bar for the split.">
          <OutcomeColumns rows={summary.volumeOutcomeMixByMonth} />
        </Panel>
        <Panel
          title="Sign-offs asked of each team"
          note="Raised in the month the brief was submitted. Creative covers both creative sign-offs."
        >
          <SimpleTable
            columns={[
              { key: "month", label: "Month", format: (v) => monthLabel(String(v)) },
              { key: "briefs", label: "Briefs", num: true },
              { key: "marketing", label: "Marketing", num: true },
              { key: "ppd", label: "PPD", num: true },
              { key: "gcms", label: "GCMS", num: true },
              { key: "creative", label: "Creative", num: true },
              { key: "shortDeadline", label: "Short deadline", num: true },
            ]}
            rows={summary.monthlyActivity as unknown as Record<string, unknown>[]}
          />
        </Panel>
      </div>

      <div className="panel-grid panel-grid-3">
        <Panel title="Customer tier">
          {summary.volumeByTier.map((r) => (
            <BarRow key={r.dimension} label={r.dimension} count={r.count} max={tierMax} />
          ))}
        </Panel>
        <Panel title="Sign-offs by type">
          {summary.volumeByRequirementType.map((r) => (
            <BarRow
              key={r.dimension}
              label={r.dimension.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase())}
              count={r.count}
              max={reqTypeMax}
            />
          ))}
        </Panel>
        <Panel
          title="Score spread"
          note="Decline at 30 or below, auto-approve above 115."
        >
          {summary.scoreDistribution.map((b) => (
            <BarRow
              key={b.bucketLabel}
              label={b.bucketLabel}
              count={b.count}
              max={scoreMax}
            />
          ))}
        </Panel>
      </div>

      <div className="panel-grid panel-grid-2">
        <Panel title="Approvers: speed and approval rate">
          <SimpleTable
            columns={[
              {
                key: "requiredRoleKey",
                label: "Role",
                format: (v) =>
                  String(v)
                    .replace(/_/g, " ")
                    .replace(/^./, (c) => c.toUpperCase()),
              },
              { key: "approvedCount", label: "Approved", num: true },
              { key: "rejectedCount", label: "Rejected", num: true },
              {
                key: "approvalRate",
                label: "Rate",
                num: true,
                format: (v) => (v === null ? "—" : `${(Number(v) * 100).toFixed(0)}%`),
              },
              {
                key: "medianHoursToDecision",
                label: "Median time",
                num: true,
                format: (v) => (v === null ? "—" : `${Number(v).toFixed(1)} h`),
              },
            ]}
            rows={summary.approvalRateByRole as unknown as Record<string, unknown>[]}
          />
        </Panel>
        <Panel
          title="Short-deadline briefs"
          note="Briefs due inside the short-deadline window, by month submitted."
        >
          {summary.shortDeadlineVolumeByMonth.length === 0 ? (
            <p className="panel-empty">None yet.</p>
          ) : (
            summary.shortDeadlineVolumeByMonth.map((r) => (
              <BarRow
                key={r.month}
                label={monthLabel(r.month)}
                count={r.count}
                max={deadlineMax}
              />
            ))
          )}
        </Panel>
      </div>

      <div className="panel-stack">
        <Panel title="Niche brands">
          <div className="kpi-strip" style={{ marginBottom: "1rem" }}>
            <div className="kpi-card">
              <div className="kpi-label">Awaiting review</div>
              <div className="kpi-value">{summary.niche.awaitingReview}</div>
              <div className="kpi-caption">
                <a href="/niche/review">review queue</a>
              </div>
            </div>
            <div className="kpi-card">
              <div className="kpi-label">Expiring in 30 days</div>
              <div className="kpi-value">{summary.niche.expiringSoon.length}</div>
              <div className="kpi-caption">current assessments</div>
            </div>
          </div>
          <h3>Brands by current assessment outcome</h3>
          <SimpleTable
            columns={[
              {
                key: "band",
                label: "Outcome",
                format: (v) => NICHE_BAND_LABELS[String(v)] ?? String(v),
              },
              { key: "count", label: "Brands", num: true },
            ]}
            rows={summary.niche.assessmentsByBand as unknown as Record<string, unknown>[]}
          />
          <h3>Expiring within 30 days</h3>
          <SimpleTable
            columns={[
              { key: "brandName", label: "Brand" },
              { key: "reference", label: "Assessment" },
              { key: "validUntil", label: "Valid until" },
            ]}
            rows={summary.niche.expiringSoon as unknown as Record<string, unknown>[]}
          />
          <h3>Brief outcomes by niche path</h3>
          <SimpleTable
            columns={[
              {
                key: "path",
                label: "Path",
                format: (v) =>
                  v === "none"
                    ? "Standard brief"
                    : v === "manual_fine_fragrance"
                      ? "Fine Fragrance pre-approved (not a niche brand)"
                      : (NICHE_BAND_LABELS[String(v)] ?? String(v)),
              },
              { key: "finalStatus", label: "Outcome" },
              { key: "count", label: "Briefs", num: true },
            ]}
            rows={
              summary.niche.briefOutcomesByNiche as unknown as Record<string, unknown>[]
            }
          />
        </Panel>
      </div>

      {!filtered && (
        <Panel
          title="By Account Manager"
          note="Counted against the Account Manager a brief was raised for."
        >
          <SimpleTable
            columns={[
              {
                key: "accountManagerName",
                label: "Account Manager",
                render: (v) => <strong>{String(v)}</strong>,
              },
              { key: "total", label: "Briefs", num: true },
              { key: "approved", label: "Approved", num: true },
              { key: "pending", label: "Pending", num: true },
              { key: "declined", label: "Declined", num: true },
              { key: "outstandingSignOffs", label: "Sign-offs waiting", num: true },
              {
                key: "valuePotentialGbp",
                label: "Value potential",
                num: true,
                format: (v) => `£${Number(v).toLocaleString("en-GB")}`,
              },
              {
                key: "accountManagerId",
                label: "",
                render: (v) => (
                  <span className="row-links">
                    <a href={`/dashboard?am=${String(v)}`}>Dashboard</a>
                    <a href={`/briefs?am=${String(v)}`}>Briefs</a>
                  </span>
                ),
              },
            ]}
            rows={summary.briefsByAccountManager as unknown as Record<string, unknown>[]}
          />
        </Panel>
      )}

      <Panel title="Pre-approvals by submitter" note="Revocations are highlighted.">
        <SimpleTable
          columns={[
            { key: "submitterName", label: "Submitter" },
            { key: "preApprovalCount", label: "Declared", num: true },
            {
              key: "revokedCount",
              label: "Revoked",
              num: true,
              render: (v) =>
                Number(v) > 0 ? (
                  <span className="status-pill status-declined">{String(v)}</span>
                ) : (
                  <span className="muted">0</span>
                ),
            },
          ]}
          rows={summary.preApprovalUsage as unknown as Record<string, unknown>[]}
        />
      </Panel>
    </>
  );
}
