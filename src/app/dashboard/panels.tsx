import type { DashboardSummary } from "../../services/reporting.js";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function SimpleTable({
  columns,
  rows,
}: {
  columns: { key: string; label: string; format?: (v: unknown) => string }[];
  rows: Record<string, unknown>[];
}) {
  if (rows.length === 0) {
    return (
      <p className="helptext" style={{ margin: 0 }}>
        No data yet.
      </p>
    );
  }
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}>
      <thead>
        <tr>
          {columns.map((c) => (
            <th
              key={c.key}
              style={{
                textAlign: "left",
                padding: "0.4em 0.6em 0.4em 0",
                color: "var(--cpl-ink-soft)",
                fontWeight: 600,
                borderBottom: "1px solid var(--cpl-border)",
              }}
            >
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, i) => (
          <tr key={i} style={{ borderTop: "1px solid var(--cpl-border)" }}>
            {columns.map((c) => (
              <td key={c.key} style={{ padding: "0.4em 0.6em 0.4em 0" }}>
                {c.format ? c.format(row[c.key]) : String(row[c.key] ?? "")}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Plain horizontal bar built from divs — matches the app's existing
 * restrained styling rather than pulling in a charting library for a
 * handful of simple distributions. */
function BarRow({ label, count, max }: { label: string; count: number; max: number }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "140px 1fr 40px",
        alignItems: "center",
        gap: "0.6rem",
        fontSize: "0.8125rem",
        marginBottom: "0.35rem",
      }}
    >
      <span>{label}</span>
      <div
        style={{
          background: "var(--cpl-border)",
          borderRadius: 3,
          overflow: "hidden",
          height: 10,
        }}
      >
        <div
          style={{ width: `${pct}%`, background: "var(--cpl-indigo)", height: "100%" }}
        />
      </div>
      <span style={{ textAlign: "right", fontFamily: "var(--font-mono)" }}>{count}</span>
    </div>
  );
}

export function DashboardPanels({ summary }: { summary: DashboardSummary }) {
  const tierMax = Math.max(1, ...summary.volumeByTier.map((r) => r.count));
  const reqTypeMax = Math.max(1, ...summary.volumeByRequirementType.map((r) => r.count));
  const scoreMax = Math.max(1, ...summary.scoreDistribution.map((b) => b.count));
  const deadlineMax = Math.max(
    1,
    ...summary.shortDeadlineVolumeByMonth.map((r) => r.count),
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
      <Panel title="Volume by customer tier">
        {summary.volumeByTier.map((r) => (
          <BarRow key={r.dimension} label={r.dimension} count={r.count} max={tierMax} />
        ))}
      </Panel>

      <Panel title="Volume by requirement type">
        {summary.volumeByRequirementType.map((r) => (
          <BarRow
            key={r.dimension}
            label={r.dimension.replace(/_/g, " ")}
            count={r.count}
            max={reqTypeMax}
          />
        ))}
      </Panel>

      <Panel title="Outcome mix by month">
        <SimpleTable
          columns={[
            { key: "month", label: "Month" },
            { key: "finalStatus", label: "Status" },
            { key: "count", label: "Count" },
          ]}
          rows={summary.volumeOutcomeMixByMonth as unknown as Record<string, unknown>[]}
        />
      </Panel>

      <Panel title="Approval rate & time-to-decision by role">
        <SimpleTable
          columns={[
            { key: "requiredRoleKey", label: "Role" },
            { key: "approvedCount", label: "Approved" },
            { key: "rejectedCount", label: "Rejected" },
            {
              key: "approvalRate",
              label: "Approval rate",
              format: (v) => (v === null ? "—" : `${(Number(v) * 100).toFixed(0)}%`),
            },
            {
              key: "medianHoursToDecision",
              label: "Median time",
              format: (v) => (v === null ? "—" : `${Number(v).toFixed(1)}h`),
            },
          ]}
          rows={summary.approvalRateByRole as unknown as Record<string, unknown>[]}
        />
      </Panel>

      <Panel title="Score distribution vs. current thresholds">
        {summary.scoreDistribution.map((b) => (
          <BarRow
            key={b.bucketLabel}
            label={b.bucketLabel}
            count={b.count}
            max={scoreMax}
          />
        ))}
        <p className="helptext" style={{ marginTop: "0.6rem", marginBottom: 0 }}>
          Current thresholds: decline ≤30, auto-approve &gt;115.
        </p>
      </Panel>

      <Panel title="Short-deadline volume over time">
        <p className="helptext" style={{ marginTop: 0 }}>
          The metric that motivated this whole project.
        </p>
        {summary.shortDeadlineVolumeByMonth.length === 0 ? (
          <p style={{ margin: 0 }}>None yet.</p>
        ) : (
          summary.shortDeadlineVolumeByMonth.map((r) => (
            <BarRow key={r.month} label={r.month} count={r.count} max={deadlineMax} />
          ))
        )}
      </Panel>

      <div style={{ gridColumn: "1 / -1" }}>
        <Panel title="Pre-approval usage by submitter (revocations highlighted)">
          <SimpleTable
            columns={[
              { key: "submitterName", label: "Submitter" },
              { key: "preApprovalCount", label: "Pre-approvals declared" },
              {
                key: "revokedCount",
                label: "Revoked",
                format: (v) => (Number(v) > 0 ? `⚠ ${v}` : "0"),
              },
            ]}
            rows={summary.preApprovalUsage as unknown as Record<string, unknown>[]}
          />
        </Panel>
      </div>
    </div>
  );
}
