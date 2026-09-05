"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeStageA, computeStageB } from "../../../engine/decision.js";
import type { RuleSetPayload } from "../../../engine/scoring.js";

const TIERS = ["A/T", "B", "C", "D"];
const NEW_REWORK = ["New", "Rework (Of Selling)", "Rework (Non-Selling)"];
const BRIEF_TYPES = ["Exclusive", "Competitive", "ProActive"];
const CUSTOMER_APPROVALS = ["Direct", "Deferred/Unknown"];
const CREATIVE_APPROACHES = ["Library Only", "Starting Point", "Creation/Unknown"];

const ROLE_LABELS: Record<string, string> = {
  development_director: "Development Director",
  divisional_head_marketing: "Divisional Head of Marketing",
  ppd_manager: "PPD Manager",
  analytical_manager: "Analytical Manager",
  commercial_director: "Commercial Director",
};

const REQUIREMENT_LABELS: Record<string, string> = {
  short_deadline: "Short deadline",
  creative_creation: "Creative approach (Creation)",
  creative_starting_point: "Creative approach (Starting Point)",
  marketing_resource: "Marketing resource",
  ppd_resource: "PPD resource",
  gcms_resource: "GCMS / analytical resource",
};

interface FormState {
  customerReference: string;
  tier: string;
  valuePotentialGbp: string;
  newRework: string;
  briefType: string;
  customerApproval: string;
  nicheFfPreApproved: boolean;
  nicheFfRationale: string;
  strategicPriority: boolean;
  strategicPriorityRationale: string;
  creativeApproach: string;
  marketingFlag: boolean;
  ppdFlag: boolean;
  gcmsFlag: boolean;
  deadline: string;
  pvReference: string;
}

const initialState: FormState = {
  customerReference: "",
  tier: TIERS[0]!,
  valuePotentialGbp: "0",
  newRework: NEW_REWORK[0]!,
  briefType: BRIEF_TYPES[0]!,
  customerApproval: CUSTOMER_APPROVALS[0]!,
  nicheFfPreApproved: false,
  nicheFfRationale: "",
  strategicPriority: false,
  strategicPriorityRationale: "",
  creativeApproach: CREATIVE_APPROACHES[0]!,
  marketingFlag: false,
  ppdFlag: false,
  gcmsFlag: false,
  deadline: "",
  pvReference: "",
};

type SubmitResult =
  | {
      kind: "success";
      data: {
        commercialDecision: string;
        finalStatus: string;
        score: number;
        approvalCode: string | null;
        requirementCount: number;
      };
    }
  | { kind: "error"; message: string };

const DECISION_LABEL: Record<string, string> = {
  auto_approved: "Auto-Approved",
  pending: "Pending Approval",
  declined: "Declined",
};

export function BriefForm() {
  const [ruleSet, setRuleSet] = useState<RuleSetPayload | null>(null);
  const [roleHolders, setRoleHolders] = useState<
    { roleKey: string; userId: string; displayName: string }[]
  >([]);
  const [form, setForm] = useState<FormState>(initialState);
  const [preApprovals, setPreApprovals] = useState<
    Record<string, { enabled: boolean; nominatedManagerId: string; comment: string }>
  >({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  // §9's 3-step wizard: (1) brief details + flags — everything the
  // decision engine needs to compute requirements, (2) the resulting
  // score preview and per-requirement pre-approval declarations, (3) a
  // read-only review before the real submit. Purely presentational: form
  // state lives in `form`/`preApprovals` above regardless of which step
  // is visible, and handleSubmit reads directly from that state rather
  // than from native form serialization — so hiding a step's fields
  // doesn't affect what gets submitted, and a required field only blocks
  // advancing past the step it's actually rendered on.
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    fetch("/api/rule-set/current")
      .then((r) => r.json())
      .then((data) => setRuleSet(data.payload))
      .catch(() => setRuleSet(null));
    fetch("/api/role-holders/current")
      .then((r) => r.json())
      .then((data) => setRoleHolders(data.holders ?? []))
      .catch(() => setRoleHolders([]));
  }, []);

  const daysUntilDeadline = useMemo(() => {
    if (!form.deadline) return null;
    const deadline = new Date(form.deadline + "T00:00:00Z");
    const today = new Date();
    const todayUtc = Date.UTC(
      today.getUTCFullYear(),
      today.getUTCMonth(),
      today.getUTCDate(),
    );
    return Math.round((deadline.getTime() - todayUtc) / (24 * 60 * 60 * 1000));
  }, [form.deadline]);

  const preview = useMemo(() => {
    if (!ruleSet) return null;
    const value = Number(form.valuePotentialGbp) || 0;
    try {
      const stageA = computeStageA(
        {
          customerTier: form.tier,
          valuePotentialGbp: value,
          newRework: form.newRework,
          briefType: form.briefType,
          customerApproval: form.customerApproval,
          strategicPriority: form.strategicPriority,
          creativeApproach: form.creativeApproach,
          nicheFfPreApproved: form.nicheFfPreApproved,
          marketingFlag: form.marketingFlag,
          ppdFlag: form.ppdFlag,
          gcmsFlag: form.gcmsFlag,
          daysUntilDeadline: daysUntilDeadline ?? 9999,
        },
        ruleSet,
      );
      const requirements = computeStageB(
        {
          customerTier: form.tier,
          valuePotentialGbp: value,
          newRework: form.newRework,
          briefType: form.briefType,
          customerApproval: form.customerApproval,
          strategicPriority: form.strategicPriority,
          creativeApproach: form.creativeApproach,
          nicheFfPreApproved: form.nicheFfPreApproved,
          marketingFlag: form.marketingFlag,
          ppdFlag: form.ppdFlag,
          gcmsFlag: form.gcmsFlag,
          daysUntilDeadline: daysUntilDeadline ?? 9999,
        },
        ruleSet,
      );
      return { stageA, requirements };
    } catch {
      return null;
    }
  }, [ruleSet, form, daysUntilDeadline]);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/briefs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          valuePotentialGbp: Number(form.valuePotentialGbp) || 0,
          nicheFfRationale: form.nicheFfRationale || null,
          strategicPriorityRationale: form.strategicPriorityRationale || null,
          pvReference: form.pvReference || null,
          preApprovals: Object.fromEntries(
            Object.entries(preApprovals)
              .filter(([, v]) => v.enabled && v.nominatedManagerId && v.comment.trim())
              .map(([type, v]) => [
                type,
                { nominatedManagerId: v.nominatedManagerId, comment: v.comment },
              ]),
          ),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ kind: "error", message: data.error ?? "Submission failed" });
      } else {
        setResult({ kind: "success", data });
      }
    } catch {
      setResult({ kind: "error", message: "Network error — please try again" });
    } finally {
      setSubmitting(false);
    }
  }

  function goNext() {
    if (formRef.current && !formRef.current.reportValidity()) return;
    setStep((s) => (s === 1 ? 2 : s === 2 ? 3 : s));
  }
  function goBack() {
    setStep((s) => (s === 3 ? 2 : s === 2 ? 1 : s));
  }

  if (result?.kind === "success") {
    const { data } = result;
    const commercialStatus =
      data.commercialDecision === "declined"
        ? "declined"
        : data.commercialDecision === "auto_approved"
          ? "approved"
          : "pending";
    return (
      <div className="card">
        <h2>Outcome</h2>

        {/* Two-part outcome display, per spec §9: commercial decision and
            outstanding approvals are always shown as separate facts, never
            collapsed into one status. */}
        <div style={{ display: "grid", gap: "0.75rem", marginBottom: "1.25rem" }}>
          <div>
            <div className="helptext" style={{ marginBottom: "0.25em" }}>
              Commercial decision
            </div>
            <span className={`status-pill status-${commercialStatus}`}>
              {DECISION_LABEL[data.commercialDecision]}
            </span>
          </div>
          <div>
            <div className="helptext" style={{ marginBottom: "0.25em" }}>
              Outstanding approvals
            </div>
            {data.requirementCount === 0 ? (
              <span style={{ color: "var(--cpl-ink-soft)" }}>None</span>
            ) : (
              <span style={{ color: "var(--cpl-amber)", fontWeight: 600 }}>
                {data.requirementCount} pending
              </span>
            )}
          </div>
        </div>

        {data.approvalCode ? (
          <div
            style={{
              background: "var(--cpl-indigo-tint)",
              border: "1px solid var(--cpl-indigo-border)",
              borderRadius: 6,
              padding: "1rem 1.25rem",
            }}
          >
            <div className="helptext" style={{ marginBottom: "0.35em" }}>
              Approval Code
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <code
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "1.25rem",
                  fontWeight: 700,
                  color: "var(--cpl-indigo-ink)",
                }}
              >
                {data.approvalCode}
              </code>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => navigator.clipboard.writeText(data.approvalCode!)}
              >
                Copy
              </button>
            </div>
            <p className="helptext" style={{ marginTop: "0.6em", marginBottom: 0 }}>
              Paste this at the top of your PV notes for traceability.
            </p>
          </div>
        ) : (
          <p className="helptext">
            {data.commercialDecision === "declined"
              ? "This brief is declined and will not receive an Approval Code."
              : "This brief is not yet fully clear — no Approval Code has been issued. It will be issued once every outstanding approval is resolved."}
          </p>
        )}

        <div style={{ marginTop: "1.5rem" }}>
          <a href="/" className="btn btn-secondary">
            Back to your briefs
          </a>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit}>
      <div className="wizard-steps">
        {(["Brief details", "Approvals", "Review & submit"] as const).map((label, i) => {
          const n = (i + 1) as 1 | 2 | 3;
          return (
            <div
              key={label}
              className={`wizard-step ${n === step ? "wizard-step-active" : n < step ? "wizard-step-done" : ""}`}
            >
              <span className="wizard-step-num">{n}</span>
              {label}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <>
          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="field-group">
              <div className="field-group-label">Commercial details</div>
              <div className="field-row">
                <div>
                  <label htmlFor="customerReference">Customer reference</label>
                  <input
                    id="customerReference"
                    required
                    value={form.customerReference}
                    onChange={(e) => set("customerReference", e.target.value)}
                  />
                </div>

                <div className="field-row-2">
                  <div>
                    <label htmlFor="tier">Customer tier</label>
                    <select
                      id="tier"
                      value={form.tier}
                      onChange={(e) => set("tier", e.target.value)}
                    >
                      {TIERS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="valuePotentialGbp">Value potential (£)</label>
                    <input
                      id="valuePotentialGbp"
                      type="number"
                      min="0"
                      step="1"
                      value={form.valuePotentialGbp}
                      onChange={(e) => set("valuePotentialGbp", e.target.value)}
                    />
                  </div>
                </div>

                <div className="field-row-2">
                  <div>
                    <label htmlFor="newRework">New / Rework</label>
                    <select
                      id="newRework"
                      value={form.newRework}
                      onChange={(e) => set("newRework", e.target.value)}
                    >
                      {NEW_REWORK.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="briefType">Brief type</label>
                    <select
                      id="briefType"
                      value={form.briefType}
                      onChange={(e) => set("briefType", e.target.value)}
                    >
                      {BRIEF_TYPES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="field-row-2">
                  <div>
                    <label htmlFor="customerApproval">Customer approval</label>
                    <select
                      id="customerApproval"
                      value={form.customerApproval}
                      onChange={(e) => set("customerApproval", e.target.value)}
                    >
                      {CUSTOMER_APPROVALS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="creativeApproach">Creative approach</label>
                    <select
                      id="creativeApproach"
                      value={form.creativeApproach}
                      onChange={(e) => set("creativeApproach", e.target.value)}
                    >
                      {CREATIVE_APPROACHES.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="field-group">
              <div className="field-group-label">Timing &amp; reference</div>
              <div className="field-row-2">
                <div>
                  <label htmlFor="deadline">Deadline</label>
                  <input
                    id="deadline"
                    type="date"
                    required
                    value={form.deadline}
                    onChange={(e) => set("deadline", e.target.value)}
                  />
                  {daysUntilDeadline !== null && daysUntilDeadline <= 0 && (
                    <div className="field-error">check this date</div>
                  )}
                </div>
                <div>
                  <label htmlFor="pvReference">PV reference (optional)</label>
                  <input
                    id="pvReference"
                    value={form.pvReference}
                    onChange={(e) => set("pvReference", e.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: "1.25rem" }}>
            <div className="field-group">
              <div className="field-group-label">Flags &amp; exceptions</div>
              <div className="field-row">
                <div>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.nicheFfPreApproved}
                      onChange={(e) => set("nicheFfPreApproved", e.target.checked)}
                    />
                    Niche / Fine Fragrance pre-approved
                  </label>
                  {form.nicheFfPreApproved && (
                    <div style={{ marginTop: "0.5em" }}>
                      <label htmlFor="nicheFfRationale">Rationale (required)</label>
                      <textarea
                        id="nicheFfRationale"
                        required
                        rows={2}
                        value={form.nicheFfRationale}
                        onChange={(e) => set("nicheFfRationale", e.target.value)}
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label>
                    <input
                      type="checkbox"
                      checked={form.strategicPriority}
                      onChange={(e) => set("strategicPriority", e.target.checked)}
                    />
                    Strategic priority
                  </label>
                  {form.strategicPriority && (
                    <div style={{ marginTop: "0.5em" }}>
                      <label htmlFor="strategicPriorityRationale">
                        Rationale (required)
                      </label>
                      <textarea
                        id="strategicPriorityRationale"
                        required
                        rows={2}
                        value={form.strategicPriorityRationale}
                        onChange={(e) =>
                          set("strategicPriorityRationale", e.target.value)
                        }
                      />
                    </div>
                  )}
                </div>

                <div style={{ display: "flex", gap: "1.75rem", flexWrap: "wrap" }}>
                  {(
                    [
                      ["marketingFlag", "Marketing resource"],
                      ["ppdFlag", "PPD resource"],
                      ["gcmsFlag", "GCMS / analytical resource"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} style={{ width: "auto" }}>
                      <input
                        type="checkbox"
                        checked={form[key]}
                        onChange={(e) => set(key, e.target.checked)}
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button type="button" className="btn btn-primary" onClick={goNext}>
              Next: Approvals
            </button>
          </div>
        </>
      )}

      {/* Live score preview — computed client-side with the exact same
          pure engine the server uses, per §9 "a live score preview updates
          as fields change, showing the running total and each component's
          contribution." */}
      {step === 2 && !preview && <p className="helptext">Loading rule set…</p>}

      {step === 2 && preview && (
        <div className="readout" style={{ marginBottom: "1.25rem" }}>
          <div className="helptext" style={{ marginBottom: "0.5em" }}>
            Live score preview
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.85rem",
              marginBottom: "1.25rem",
            }}
          >
            <span className="readout-score">{preview.stageA.score.toFixed(1)}</span>
            <span
              className={`status-pill status-${
                preview.stageA.commercialDecision === "declined"
                  ? "declined"
                  : preview.stageA.commercialDecision === "auto_approved"
                    ? "approved"
                    : "pending"
              }`}
            >
              {DECISION_LABEL[preview.stageA.commercialDecision]}
            </span>
          </div>

          <div>
            {(() => {
              const breakdown = Object.entries(preview.stageA.scoreBreakdown) as [
                string,
                number,
              ][];
              const maxAbs = Math.max(1, ...breakdown.map(([, v]) => Math.abs(v)));
              return breakdown.map(([k, v]) => (
                <div className="readout-breakdown-row" key={k}>
                  <span style={{ color: "var(--cpl-ink-soft)" }}>
                    {k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase())}
                  </span>
                  <span className="readout-bar-track">
                    <span
                      className="readout-bar-fill"
                      style={{ width: `${(Math.abs(v) / maxAbs) * 100}%` }}
                    />
                  </span>
                  <span className="readout-value">{v.toFixed(1)}</span>
                </div>
              ));
            })()}
          </div>

          {preview.requirements.length > 0 && (
            <div style={{ marginTop: "1rem" }}>
              <div className="helptext" style={{ marginBottom: "0.4em" }}>
                Will require approval from
              </div>
              <div style={{ display: "grid", gap: "0.75rem" }}>
                {preview.requirements.map((r) => {
                  const decl = preApprovals[r.requirementType] ?? {
                    enabled: false,
                    nominatedManagerId: "",
                    comment: "",
                  };
                  const eligibleManagers = roleHolders.filter(
                    (h) => h.roleKey === r.role,
                  );
                  return (
                    <div
                      key={r.requirementType}
                      style={{
                        border: "1px solid var(--cpl-indigo-border)",
                        background: "var(--cpl-indigo-tint)",
                        borderRadius: 6,
                        padding: "0.85rem 1rem",
                      }}
                    >
                      <div style={{ fontSize: "0.875rem", marginBottom: "0.5em" }}>
                        <strong>
                          {REQUIREMENT_LABELS[r.requirementType] ?? r.requirementType}
                        </strong>
                        {" — "}
                        <span style={{ color: "var(--cpl-ink-soft)" }}>
                          {ROLE_LABELS[r.role] ?? r.role}
                        </span>
                      </div>
                      <label style={{ fontSize: "0.875rem" }}>
                        <input
                          type="checkbox"
                          checked={decl.enabled}
                          onChange={(e) =>
                            setPreApprovals((prev) => ({
                              ...prev,
                              [r.requirementType]: { ...decl, enabled: e.target.checked },
                            }))
                          }
                        />
                        Already approved by a manager
                      </label>
                      {decl.enabled && (
                        <div
                          style={{ marginTop: "0.5em", display: "grid", gap: "0.5em" }}
                        >
                          <select
                            value={decl.nominatedManagerId}
                            onChange={(e) =>
                              setPreApprovals((prev) => ({
                                ...prev,
                                [r.requirementType]: {
                                  ...decl,
                                  nominatedManagerId: e.target.value,
                                },
                              }))
                            }
                          >
                            <option value="">Select the manager who approved this</option>
                            {eligibleManagers.map((m) => (
                              <option key={m.userId} value={m.userId}>
                                {m.displayName}
                              </option>
                            ))}
                          </select>
                          {eligibleManagers.length === 0 && (
                            <div className="field-error">
                              No one currently holds {ROLE_LABELS[r.role] ?? r.role} —
                              pre-approval isn&apos;t available for this requirement.
                            </div>
                          )}
                          <textarea
                            placeholder="Comment explaining the circumstances (required)"
                            rows={2}
                            value={decl.comment}
                            onChange={(e) =>
                              setPreApprovals((prev) => ({
                                ...prev,
                                [r.requirementType]: { ...decl, comment: e.target.value },
                              }))
                            }
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {preview.requirements.length === 0 && (
            <p className="helptext" style={{ marginTop: "1rem", marginBottom: 0 }}>
              No approvals required for this brief.
            </p>
          )}
        </div>
      )}

      {step === 2 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "1.25rem",
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Back
          </button>
          <button type="button" className="btn btn-primary" onClick={goNext}>
            Next: Review &amp; submit
          </button>
        </div>
      )}

      {step === 3 && preview && (
        <div className="card" style={{ marginBottom: "1.25rem" }}>
          <h2>Review</h2>
          <dl className="detail-list" style={{ marginBottom: "1.25rem" }}>
            <dt>Customer reference</dt>
            <dd>{form.customerReference}</dd>
            <dt>Tier</dt>
            <dd>{form.tier}</dd>
            <dt>Value potential</dt>
            <dd>£{(Number(form.valuePotentialGbp) || 0).toLocaleString("en-GB")}</dd>
            <dt>New/Rework</dt>
            <dd>{form.newRework}</dd>
            <dt>Brief type</dt>
            <dd>{form.briefType}</dd>
            <dt>Customer approval</dt>
            <dd>{form.customerApproval}</dd>
            <dt>Creative approach</dt>
            <dd>{form.creativeApproach}</dd>
            <dt>Deadline</dt>
            <dd>{form.deadline}</dd>
            {form.pvReference && (
              <>
                <dt>PV reference</dt>
                <dd>{form.pvReference}</dd>
              </>
            )}
          </dl>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "0.85rem",
              marginBottom: "1rem",
            }}
          >
            <span className="readout-score">{preview.stageA.score.toFixed(1)}</span>
            <span
              className={`status-pill status-${
                preview.stageA.commercialDecision === "declined"
                  ? "declined"
                  : preview.stageA.commercialDecision === "auto_approved"
                    ? "approved"
                    : "pending"
              }`}
            >
              {DECISION_LABEL[preview.stageA.commercialDecision]}
            </span>
          </div>

          {Object.entries(preApprovals).filter(([, v]) => v.enabled).length > 0 && (
            <div className="helptext" style={{ marginBottom: 0 }}>
              {Object.entries(preApprovals).filter(([, v]) => v.enabled).length}{" "}
              pre-approval declaration(s) will be recorded on submit.
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "1.25rem",
          }}
        >
          <button type="button" className="btn btn-secondary" onClick={goBack}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={submitting}>
            {submitting ? "Submitting…" : "Submit brief"}
          </button>
        </div>
      )}

      {result?.kind === "error" && (
        <div className="field-error" style={{ marginBottom: "1rem" }}>
          {result.message}
        </div>
      )}
    </form>
  );
}
