"use client";

import { useState } from "react";
import type {
  NicheFrameworkPayload,
  NicheRoute,
} from "../../../../engine/niche-assessment.js";

const ROUTES: NicheRoute[] = [
  "standard",
  "charging_model",
  "junior_perfumer_development",
  "perfumer_passion_project",
  "decline",
];

export function FrameworkEditor({
  id,
  initial,
  readOnly,
  roles,
  saveAction,
}: {
  id: string;
  initial: NicheFrameworkPayload;
  readOnly: boolean;
  roles: Array<{ key: string; displayName: string }>;
  saveAction: (fd: FormData) => void | Promise<void>;
}) {
  const [fw, setFw] = useState<NicheFrameworkPayload>(initial);
  const max = fw.sections.reduce(
    (n, s) => n + s.criteria.reduce((m, c) => m + (Number(c.weight) || 0), 0),
    0,
  );

  const setSection = (
    i: number,
    patch: Partial<NicheFrameworkPayload["sections"][number]>,
  ) =>
    setFw({
      ...fw,
      sections: fw.sections.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const setCriterion = (
    i: number,
    k: number,
    patch: Partial<NicheFrameworkPayload["sections"][number]["criteria"][number]>,
  ) =>
    setSection(i, {
      criteria: fw.sections[i]!.criteria.map((c, j) =>
        j === k ? { ...c, ...patch } : c,
      ),
    });
  const setBand = (i: number, patch: Partial<NicheFrameworkPayload["bands"][number]>) =>
    setFw({ ...fw, bands: fw.bands.map((b, j) => (j === i ? { ...b, ...patch } : b)) });
  const addCriterion = (i: number) => {
    const n = fw.sections[i]!.criteria.length + 1;
    setSection(i, {
      criteria: [
        ...fw.sections[i]!.criteria,
        {
          key: `${fw.sections[i]!.key}_new_${Date.now().toString(36)}_${n}`,
          text: "New criterion",
          weight: 0,
        },
      ],
    });
  };

  return (
    <form action={saveAction}>
      <input type="hidden" name="id" value={id} />
      <input
        type="hidden"
        name="payload"
        value={JSON.stringify({ ...fw, maxScore: max })}
      />
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="card">
          <h2>Settings</h2>
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
            <label>
              Valid for (months)
              <input
                type="number"
                min={1}
                value={fw.validityMonths}
                onChange={(e) => setFw({ ...fw, validityMonths: Number(e.target.value) })}
              />
            </label>
            <label>
              Reminder (days before expiry)
              <input
                type="number"
                min={0}
                value={fw.expiryReminderDays}
                onChange={(e) =>
                  setFw({ ...fw, expiryReminderDays: Number(e.target.value) })
                }
              />
            </label>
            <label>
              Reviewer role
              <select
                value={fw.reviewerRoleKey}
                onChange={(e) => setFw({ ...fw, reviewerRoleKey: e.target.value })}
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.displayName}
                  </option>
                ))}
              </select>
            </label>
            <div>
              Maximum score
              <div className="kpi-value">{max}</div>
              <div className="helptext">Sum of all weights; it must be 100.</div>
            </div>
          </div>
        </div>

        <div className="card" style={{ marginTop: "1.25rem" }}>
          <h2>Bands</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Band</th>
                <th>Label</th>
                <th>Short label</th>
                <th>Min score</th>
                <th>Colour</th>
                <th>Allowed routes</th>
              </tr>
            </thead>
            <tbody>
              {fw.bands.map((b, i) => (
                <tr key={b.key}>
                  <td>{b.key.replace(/_/g, " ")}</td>
                  <td>
                    <input
                      value={b.label}
                      onChange={(e) => setBand(i, { label: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      value={b.shortLabel}
                      onChange={(e) => setBand(i, { shortLabel: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      style={{ width: "5rem" }}
                      value={b.minScore}
                      onChange={(e) => setBand(i, { minScore: Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      value={b.colour}
                      onChange={(e) => setBand(i, { colour: e.target.value })}
                    />
                  </td>
                  <td>
                    {ROUTES.map((r) => (
                      <label key={r} style={{ display: "block", fontSize: "0.8125rem" }}>
                        <input
                          type="checkbox"
                          checked={b.allowedRoutes.includes(r)}
                          onChange={(e) => {
                            const allowedRoutes = e.target.checked
                              ? [...b.allowedRoutes, r]
                              : b.allowedRoutes.filter((x) => x !== r);
                            setBand(i, {
                              allowedRoutes,
                              defaultRoute:
                                b.defaultRoute && allowedRoutes.includes(b.defaultRoute)
                                  ? b.defaultRoute
                                  : null,
                            });
                          }}
                        />{" "}
                        {r.replace(/_/g, " ")}
                      </label>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {fw.sections.map((s, i) => (
          <div className="card" key={s.key} style={{ marginTop: "1.25rem" }}>
            <h2>
              <input
                value={s.title}
                onChange={(e) => setSection(i, { title: e.target.value })}
              />
            </h2>
            <textarea
              rows={2}
              value={s.description}
              onChange={(e) => setSection(i, { description: e.target.value })}
              style={{ width: "100%" }}
            />
            <table className="data-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Question</th>
                  <th>Help text</th>
                  <th>Weight</th>
                </tr>
              </thead>
              <tbody>
                {s.criteria.map((c, k) => (
                  <tr key={c.key}>
                    <td style={{ fontFamily: "var(--font-mono)", fontSize: "0.75rem" }}>
                      {c.key}
                    </td>
                    <td>
                      <input
                        style={{ width: "100%" }}
                        value={c.text}
                        onChange={(e) => setCriterion(i, k, { text: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        style={{ width: "100%" }}
                        value={c.helpText ?? ""}
                        onChange={(e) =>
                          setCriterion(i, k, { helpText: e.target.value || undefined })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        min={0}
                        style={{ width: "4.5rem" }}
                        value={c.weight}
                        onChange={(e) =>
                          setCriterion(i, k, { weight: Number(e.target.value) })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button type="button" className="btn" onClick={() => addCriterion(i)}>
              Add criterion
            </button>
          </div>
        ))}
        {!readOnly && (
          <div style={{ marginTop: "1rem" }}>
            <button type="submit" className="btn btn-primary">
              Save draft
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
