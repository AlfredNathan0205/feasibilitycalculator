"use client";

import { useState } from "react";
import type { RuleSetPayload } from "../../../../engine/scoring.js";

export function RuleSetEditor({
  ruleSetId,
  status,
  initialPayload,
}: {
  ruleSetId: string;
  status: string;
  initialPayload: RuleSetPayload;
}) {
  const [payload, setPayload] = useState<RuleSetPayload>(initialPayload);
  const [dirty, setDirty] = useState(false);
  const [hasReplayedCurrentSave, setHasReplayedCurrentSave] = useState(false);
  const [saving, setSaving] = useState(false);
  const [replaying, setReplaying] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [replayResult, setReplayResult] = useState<{
    totalBriefsEvaluated: number;
    transitionCounts: Record<string, number>;
    transitions: {
      briefId: string;
      customerReference: string;
      fromDecision: string;
      toDecision: string;
      fromScore: number;
      toScore: number;
    }[];
  } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isDraft = status === "draft";

  function updateNumberMap(key: keyof RuleSetPayload, innerKey: string, value: number) {
    setPayload((p) => ({
      ...p,
      [key]: { ...(p[key] as Record<string, number>), [innerKey]: value },
    }));
    setDirty(true);
    setHasReplayedCurrentSave(false);
  }

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/rule-sets/${ruleSetId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      if (!res.ok) {
        const data = await res.json();
        setMessage(data.error ?? "Save failed");
        return;
      }
      setDirty(false);
      setMessage("Saved.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReplay() {
    setReplaying(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/rule-sets/${ruleSetId}/replay`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Replay failed");
        return;
      }
      setReplayResult(data);
      if (!dirty) setHasReplayedCurrentSave(true);
    } finally {
      setReplaying(false);
    }
  }

  async function handlePublish() {
    setPublishing(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/rule-sets/${ruleSetId}/publish`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? "Publish failed");
        return;
      }
      window.location.href = "/admin/rule-sets";
    } finally {
      setPublishing(false);
    }
  }

  if (!isDraft) {
    return (
      <div className="card">
        <p style={{ margin: 0 }}>
          This rule set is <strong>{status}</strong> and immutable. Create a new draft
          from <a href="/admin/rule-sets">the rule sets list</a> to make changes.
        </p>
        <pre style={{ marginTop: "1rem", fontSize: "0.8125rem", overflow: "auto" }}>
          {JSON.stringify(payload, null, 2)}
        </pre>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1.25rem" }}>
      <div className="card">
        <h2>Tier weights</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: "0.75rem",
          }}
        >
          {Object.entries(payload.tierWeights).map(([tier, value]) => (
            <div key={tier}>
              <label>{tier}</label>
              <input
                type="number"
                value={value}
                onChange={(e) =>
                  updateNumberMap("tierWeights", tier, Number(e.target.value))
                }
              />
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Thresholds</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label>Auto-approve above</label>
            <input
              type="number"
              value={payload.thresholds.autoApproveAbove}
              onChange={(e) => {
                setPayload((p) => ({
                  ...p,
                  thresholds: {
                    ...p.thresholds,
                    autoApproveAbove: Number(e.target.value),
                  },
                }));
                setDirty(true);
                setHasReplayedCurrentSave(false);
              }}
            />
          </div>
          <div>
            <label>Decline at or below</label>
            <input
              type="number"
              value={payload.thresholds.declineAtOrBelow}
              onChange={(e) => {
                setPayload((p) => ({
                  ...p,
                  thresholds: {
                    ...p.thresholds,
                    declineAtOrBelow: Number(e.target.value),
                  },
                }));
                setDirty(true);
                setHasReplayedCurrentSave(false);
              }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Multipliers &amp; scores</h2>
        <div style={{ display: "grid", gap: "0.9rem" }}>
          {(
            [
              ["newReworkMultipliers", "New / Rework"],
              ["briefTypeMultipliers", "Brief type"],
              ["customerApprovalMultipliers", "Customer approval"],
              ["creativeApproachScores", "Creative approach"],
            ] as const
          ).map(([key, label]) => (
            <div key={key}>
              <div className="helptext" style={{ marginBottom: "0.3em" }}>
                {label}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
                  gap: "0.6rem",
                }}
              >
                {Object.entries(payload[key] as Record<string, number>).map(([k, v]) => (
                  <div key={k}>
                    <label style={{ fontWeight: 400 }}>{k}</label>
                    <input
                      type="number"
                      step="0.1"
                      value={v}
                      onChange={(e) => updateNumberMap(key, k, Number(e.target.value))}
                    />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Other</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div>
            <label>Strategic priority bonus</label>
            <input
              type="number"
              value={payload.strategicPriorityBonus}
              onChange={(e) => {
                setPayload((p) => ({
                  ...p,
                  strategicPriorityBonus: Number(e.target.value),
                }));
                setDirty(true);
                setHasReplayedCurrentSave(false);
              }}
            />
          </div>
          <div>
            <label>Short deadline window (days)</label>
            <input
              type="number"
              value={payload.deadlineWindowDays}
              onChange={(e) => {
                setPayload((p) => ({ ...p, deadlineWindowDays: Number(e.target.value) }));
                setDirty(true);
                setHasReplayedCurrentSave(false);
              }}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <h2>Routing table</h2>
        <table
          style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" }}
        >
          <thead>
            <tr>
              {["Requirement", "Role", "Enabled"].map((h) => (
                <th
                  key={h}
                  style={{
                    textAlign: "left",
                    padding: "0.4em 0",
                    color: "var(--cpl-ink-soft)",
                  }}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(payload.routingTable).map(([reqType, routing]) => (
              <tr key={reqType} style={{ borderTop: "1px solid var(--cpl-border)" }}>
                <td style={{ padding: "0.4em 0" }}>{reqType.replace(/_/g, " ")}</td>
                <td style={{ padding: "0.4em 0" }}>
                  <input
                    value={routing.role}
                    onChange={(e) => {
                      setPayload((p) => ({
                        ...p,
                        routingTable: {
                          ...p.routingTable,
                          [reqType]: { ...routing, role: e.target.value },
                        },
                      }));
                      setDirty(true);
                      setHasReplayedCurrentSave(false);
                    }}
                  />
                </td>
                <td style={{ padding: "0.4em 0" }}>
                  <input
                    type="checkbox"
                    style={{ width: "auto" }}
                    checked={routing.enabled}
                    onChange={(e) => {
                      setPayload((p) => ({
                        ...p,
                        routingTable: {
                          ...p.routingTable,
                          [reqType]: { ...routing, enabled: e.target.checked },
                        },
                      }));
                      setDirty(true);
                      setHasReplayedCurrentSave(false);
                    }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {message && <p className="helptext">{message}</p>}

      <div style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
        <button
          className="btn btn-primary"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving ? "Saving…" : "Save draft"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleReplay}
          disabled={replaying || dirty}
        >
          {replaying ? "Running…" : "Run replay"}
        </button>
        <button
          className="btn btn-primary"
          onClick={handlePublish}
          disabled={publishing || dirty || !hasReplayedCurrentSave}
          title={
            !hasReplayedCurrentSave
              ? "Save your changes and run a replay first"
              : undefined
          }
        >
          {publishing ? "Publishing…" : "Publish"}
        </button>
        {dirty && <span className="helptext">Unsaved changes</span>}
      </div>

      {replayResult && (
        <div className="card">
          <h2>Replay results</h2>
          <p className="helptext">
            {replayResult.totalBriefsEvaluated} historical briefs evaluated.
          </p>
          {Object.keys(replayResult.transitionCounts).length === 0 ? (
            <p style={{ margin: 0 }}>No decisions would change.</p>
          ) : (
            <>
              <ul style={{ marginTop: 0 }}>
                {Object.entries(replayResult.transitionCounts).map(([key, count]) => {
                  const [from, to] = key.split("->");
                  return (
                    <li key={key}>
                      <strong>{count}</strong> brief{count === 1 ? "" : "s"} move from{" "}
                      <em>{from}</em> to <em>{to}</em>
                    </li>
                  );
                })}
              </ul>
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: "0.8125rem",
                }}
              >
                <thead>
                  <tr>
                    {["Customer", "From", "To", "Score"].map((h) => (
                      <th
                        key={h}
                        style={{
                          textAlign: "left",
                          padding: "0.4em 0",
                          color: "var(--cpl-ink-soft)",
                        }}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {replayResult.transitions.map((t) => (
                    <tr
                      key={t.briefId}
                      style={{ borderTop: "1px solid var(--cpl-border)" }}
                    >
                      <td style={{ padding: "0.4em 0" }}>{t.customerReference}</td>
                      <td style={{ padding: "0.4em 0" }}>{t.fromDecision}</td>
                      <td style={{ padding: "0.4em 0" }}>{t.toDecision}</td>
                      <td style={{ padding: "0.4em 0", fontFamily: "var(--font-mono)" }}>
                        {t.fromScore.toFixed(1)} → {t.toScore.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </div>
  );
}
