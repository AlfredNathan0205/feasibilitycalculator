"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { computeStageA, computeStageB } from "../../../engine/decision.js";
import type { RuleSetPayload } from "../../../engine/scoring.js";
import {
  deriveNicheForBrief,
  type CurrentAssessmentFacts,
} from "../../../engine/niche-brief.js";
import type {
  NicheBand,
  NicheFrameworkPayload,
  NicheRoute,
} from "../../../engine/niche-assessment.js";

// Shown until the published rule set loads; the real list comes from its tierWeights.
const FALLBACK_TIERS = ["A", "B", "C", "D"];
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
  niche_growth_partner: "Niche Tier 2 sign-off",
  niche_development_route: "Niche development route",
  niche_charging_model: "Niche charging model",
};

const ROUTE_LABELS: Record<string, string> = {
  standard: "Standard",
  charging_model: "Charging model",
  junior_perfumer_development: "Junior perfumer development",
  perfumer_passion_project: "Perfumer passion project",
  decline: "Decline",
};

/** Always paired with the band name, never a bare "Tier 1" (customer tiers are A, T, B, C, D). */
const BAND_LABELS: Record<string, string> = {
  strategic_partner: "Niche Tier 1 · Strategic Partner",
  growth_partner: "Niche Tier 2 · Growth Partner",
  development_opportunity: "Development Opportunity",
  charge_or_decline: "Charge or Decline",
};

interface NicheOptions {
  brands: Array<{
    id: string;
    name: string;
    customerReference: string | null;
    current: {
      id: string;
      reference: string;
      band: NicheBand;
      score: number;
      validUntil: string;
      frameworkId: string;
      assessor: string;
      reviewer: string;
    } | null;
  }>;
  frameworks: Record<string, { version: number; payload: NicheFrameworkPayload }>;
}

interface FormState {
  customerReference: string;
  tier: string;
  valuePotentialGbp: string;
  newRework: string;
  briefType: string;
  customerApproval: string;
  /** Is this brief for a niche brand? */
  nicheBrand: boolean;
  nicheBrandText: string;
  nicheRoute: string;
  nicheRouteRationale: string;
  /** "Fine Fragrance pre-approved (not a niche brand)", with nicheFfRationale. */
  fineFragranceManual: boolean;
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
  tier: FALLBACK_TIERS[0]!,
  valuePotentialGbp: "0",
  newRework: NEW_REWORK[0]!,
  briefType: BRIEF_TYPES[0]!,
  customerApproval: CUSTOMER_APPROVALS[0]!,
  nicheBrand: false,
  nicheBrandText: "",
  nicheRoute: "",
  nicheRouteRationale: "",
  fineFragranceManual: false,
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
        nicheWarning?: string | null;
      };
    }
  | { kind: "error"; message: string };

const DECISION_LABEL: Record<string, string> = {
  auto_approved: "Auto-Approved",
  pending: "Pending Approval",
  declined: "Declined",
};

/** Drops the form's niche UI-only fields before they are spread into the request body. */
function stripNicheUiState(f: FormState) {
  const {
    nicheBrand,
    nicheBrandText,
    nicheRoute,
    nicheRouteRationale,
    fineFragranceManual,
    nicheFfRationale,
    ...rest
  } = f;
  void nicheBrand;
  void nicheBrandText;
  void nicheRoute;
  void nicheRouteRationale;
  void fineFragranceManual;
  void nicheFfRationale;
  return rest;
}

export function BriefForm() {
  const [ruleSet, setRuleSet] = useState<RuleSetPayload | null>(null);
  const [roleHolders, setRoleHolders] = useState<
    { roleKey: string; userId: string; displayName: string }[]
  >([]);
  const [form, setForm] = useState<FormState>(initialState);
  const [nicheOptions, setNicheOptions] = useState<NicheOptions | null>(null);
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
  const tiers = ruleSet ? Object.keys(ruleSet.tierWeights) : FALLBACK_TIERS;

  useEffect(() => {
    fetch("/api/rule-set/current")
      .then((r) => r.json())
      .then((data) => {
        const payload = data.payload as RuleSetPayload;
        setRuleSet(payload);
        // Keep the selected tier valid for this rule set (e.g. a rule set that
        // has A and T but not the legacy merged A/T).
        const keys = Object.keys(payload.tierWeights);
        setForm((f) => (keys.includes(f.tier) ? f : { ...f, tier: keys[0] ?? f.tier }));
      })
      .catch(() => setRuleSet(null));
    fetch("/api/niche/brief-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setNicheOptions(data))
      .catch(() => setNicheOptions(null));
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

  const nicheBrandChoice = useMemo(
    () =>
      form.nicheBrand
        ? (nicheOptions?.brands.find(
            (b) => b.name.toLowerCase() === form.nicheBrandText.trim().toLowerCase(),
          ) ?? null)
        : null,
    [form.nicheBrand, form.nicheBrandText, nicheOptions],
  );

  // Mirrors the server's derivation (same pure function); the server re-derives
  // from its own lookup at submission and never trusts the band shown here.
  const niche = useMemo(() => {
    let current: CurrentAssessmentFacts | null = null;
    const c = nicheBrandChoice?.current;
    const fw = c ? nicheOptions?.frameworks[c.frameworkId] : undefined;
    if (c && fw) {
      current = {
        id: c.id,
        reference: c.reference,
        band: c.band,
        score: c.score,
        validUntil: c.validUntil,
        frameworkVersion: fw.version,
        framework: fw.payload,
      };
    }
    const derived = deriveNicheForBrief({
      nicheBrandSelected: form.nicheBrand && !!nicheBrandChoice,
      current,
      clientAssessmentId: current?.id ?? null,
      route: (form.nicheRoute as NicheRoute) || null,
      routeRationale: form.nicheRouteRationale,
      manualFineFragrance: !form.nicheBrand && form.fineFragranceManual,
      manualRationale: form.nicheFfRationale,
      allowManualFineFragrance:
        ruleSet?.nicheAssessment?.allowManualFineFragrance ?? true,
      clientNicheFfPreApproved: false,
    });
    const band = current
      ? current.framework.bands.find((b) => b.key === current.band)
      : null;
    return { derived, current, band };
  }, [form, nicheBrandChoice, nicheOptions, ruleSet]);

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
          nicheFfPreApproved: niche.derived.ok && niche.derived.nicheFfPreApproved,
          nicheBand: niche.derived.ok ? niche.derived.nicheBand : null,
          nicheRoute: niche.derived.ok ? niche.derived.nicheRoute : null,
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
          nicheFfPreApproved: niche.derived.ok && niche.derived.nicheFfPreApproved,
          nicheBand: niche.derived.ok ? niche.derived.nicheBand : null,
          nicheRoute: niche.derived.ok ? niche.derived.nicheRoute : null,
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
  }, [ruleSet, form, daysUntilDeadline, niche]);

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
          ...stripNicheUiState(form),
          valuePotentialGbp: Number(form.valuePotentialGbp) || 0,
          nicheFfPreApproved: false, // derived by the server from the assessment or the manual path
          nicheBrandId: form.nicheBrand ? (nicheBrandChoice?.id ?? null) : null,
          nicheAssessmentId: form.nicheBrand
            ? (nicheBrandChoice?.current?.id ?? null)
            : null,
          nicheRoute: form.nicheBrand ? form.nicheRoute || null : null,
          nicheRouteRationale: form.nicheBrand ? form.nicheRouteRationale || null : null,
          fineFragranceManualFlag: !form.nicheBrand && form.fineFragranceManual,
          nicheFfRationale:
            !form.nicheBrand && form.fineFragranceManual
              ? form.nicheFfRationale || null
              : null,
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
    if (step === 1 && !niche.derived.ok) return; // the reason is shown beside the niche fields
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
              <span style={{ color: "var(--cpl-pending-text)", fontWeight: 600 }}>
                {data.requirementCount} pending
              </span>
            )}
          </div>
        </div>

        {data.nicheWarning && (
          <p className="helptext" role="status">
            This niche brand had no current approved assessment, so the brief was scored
            as a standard brief.
          </p>
        )}

        {data.approvalCode ? (
          <div
            style={{
              background: "var(--cpl-purple-tint)",
              border: "1px solid var(--cpl-purple-border)",
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
                  color: "var(--cpl-purple-ink)",
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
                      {tiers.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {form.tier === "T" && (
                      <p className="helptext" style={{ margin: "0.35rem 0 0" }}>
                        Target account: this brief always needs Commercial Director
                        approval.
                      </p>
                    )}
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
                  <div className="field-group-label" id="niche-q">
                    Is this brief for a niche brand?
                  </div>
                  <div
                    role="radiogroup"
                    aria-labelledby="niche-q"
                    style={{ display: "flex", gap: "1rem" }}
                  >
                    {[
                      { v: true, t: "Yes" },
                      { v: false, t: "No" },
                    ].map((o) => (
                      <label key={o.t}>
                        <input
                          type="radio"
                          name="nicheBrand"
                          checked={form.nicheBrand === o.v}
                          onChange={() => set("nicheBrand", o.v)}
                        />{" "}
                        {o.t}
                      </label>
                    ))}
                  </div>

                  {form.nicheBrand && (
                    <div style={{ marginTop: "0.5em" }}>
                      <label htmlFor="nicheBrandText">Niche brand</label>
                      <input
                        id="nicheBrandText"
                        list="niche-brand-list"
                        required
                        autoComplete="off"
                        value={form.nicheBrandText}
                        onChange={(e) => set("nicheBrandText", e.target.value)}
                      />
                      <datalist id="niche-brand-list">
                        {nicheOptions?.brands.map((b) => (
                          <option key={b.id} value={b.name} />
                        ))}
                      </datalist>
                      <p className="helptext" style={{ marginBottom: 0 }}>
                        Not listed?{" "}
                        <a href="/niche/brands/new" target="_blank" rel="noreferrer">
                          Create brand
                        </a>
                        , then come back and pick it.
                      </p>
                      {form.nicheBrandText.trim() && !nicheBrandChoice && (
                        <p className="field-error" role="alert">
                          Choose a brand from the list.
                        </p>
                      )}

                      {nicheBrandChoice &&
                        (niche.current ? (
                          <div
                            className="card"
                            style={{
                              marginTop: "0.6em",
                              background: "var(--cpl-purple-tint)",
                            }}
                          >
                            <span className={`status-pill niche-${niche.current.band}`}>
                              {BAND_LABELS[niche.current.band]}
                            </span>{" "}
                            score {niche.current.score} /{" "}
                            {niche.current.framework.maxScore}
                            <div className="helptext" style={{ margin: "0.4em 0 0" }}>
                              {niche.current.reference}, valid until{" "}
                              {niche.current.validUntil}. Assessed by{" "}
                              {nicheBrandChoice.current?.assessor}, reviewed by{" "}
                              {nicheBrandChoice.current?.reviewer}.
                            </div>
                          </div>
                        ) : (
                          <p
                            className="field-error"
                            role="alert"
                            style={{ marginTop: "0.6em" }}
                          >
                            No current Niche Brand Assessment for {nicheBrandChoice.name}.
                            This brief will be scored as a standard brief.{" "}
                            <a
                              href={`/niche/assessments/new?brandId=${nicheBrandChoice.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Start one
                            </a>
                          </p>
                        ))}

                      {niche.band && niche.band.allowedRoutes.length > 1 && (
                        <div style={{ marginTop: "0.6em" }}>
                          <label htmlFor="nicheRoute">
                            Route for this brand (required)
                          </label>
                          <select
                            id="nicheRoute"
                            required
                            value={form.nicheRoute}
                            onChange={(e) => set("nicheRoute", e.target.value)}
                          >
                            <option value="">Choose a route</option>
                            {niche.band.allowedRoutes.map((r) => (
                              <option key={r} value={r}>
                                {ROUTE_LABELS[r]}
                              </option>
                            ))}
                          </select>
                          <label
                            htmlFor="nicheRouteRationale"
                            style={{ marginTop: "0.5em" }}
                          >
                            Rationale for the route (required)
                          </label>
                          <textarea
                            id="nicheRouteRationale"
                            required
                            rows={2}
                            value={form.nicheRouteRationale}
                            onChange={(e) => set("nicheRouteRationale", e.target.value)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {!form.nicheBrand &&
                    (ruleSet?.nicheAssessment?.allowManualFineFragrance ?? true) && (
                      <div style={{ marginTop: "0.5em" }}>
                        <label>
                          <input
                            type="checkbox"
                            checked={form.fineFragranceManual}
                            onChange={(e) => set("fineFragranceManual", e.target.checked)}
                          />
                          Fine Fragrance pre-approved (not a niche brand)
                        </label>
                        {form.fineFragranceManual && (
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
                    )}
                  {!niche.derived.ok &&
                    form.nicheBrand &&
                    form.nicheBrandText.trim() &&
                    nicheBrandChoice && (
                      <p className="field-error" role="alert">
                        {niche.derived.error}
                      </p>
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
            {niche.derived.ok && niche.derived.snapshot && niche.band && (
              <div className="helptext" style={{ margin: "0.4em 0 0" }}>
                Niche outcome: {BAND_LABELS[niche.derived.snapshot.band]} (
                {niche.derived.snapshot.reference})
                {niche.derived.nicheFfPreApproved
                  ? ", so the commercial decision is auto-approved"
                  : `, route: ${ROUTE_LABELS[niche.derived.snapshot.route]}`}
                .
              </div>
            )}
            {niche.derived.ok && niche.derived.fineFragranceManualFlag && (
              <div className="helptext" style={{ margin: "0.4em 0 0" }}>
                Fine Fragrance pre-approved (not a niche brand).
              </div>
            )}
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
                        border: "1px solid var(--cpl-purple-border)",
                        background: "var(--cpl-purple-tint)",
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
            {niche.derived.ok && niche.derived.snapshot && niche.band && (
              <div className="helptext" style={{ margin: "0.4em 0 0" }}>
                Niche outcome: {BAND_LABELS[niche.derived.snapshot.band]} (
                {niche.derived.snapshot.reference})
                {niche.derived.nicheFfPreApproved
                  ? ", so the commercial decision is auto-approved"
                  : `, route: ${ROUTE_LABELS[niche.derived.snapshot.route]}`}
                .
              </div>
            )}
            {niche.derived.ok && niche.derived.fineFragranceManualFlag && (
              <div className="helptext" style={{ margin: "0.4em 0 0" }}>
                Fine Fragrance pre-approved (not a niche brand).
              </div>
            )}
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
