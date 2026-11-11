import { notFound } from "next/navigation";
import Image from "next/image";
import type { NicheAnswers } from "../../../../../engine/niche-assessment.js";
import { getDb } from "../../../../../lib/db.js";
import { getAssessmentDetail } from "../../../../../services/niche-queries.js";
import { NICHE_BAND_LABELS, NICHE_STATUS_LABELS } from "../../../../components/labels.js";
import { fmtDate, nicheGate } from "../../../gate.js";

export const dynamic = "force-dynamic";

/** Branded printable page (server rendered; use the browser's Print / Save as PDF). */
export default async function PrintPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await nicheGate();
  if (!gate.ok) return gate.view;
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await getAssessmentDetail(getDb(), id);
  if (!d) notFound();
  const { a, brand, framework } = d;
  const answers = a.answers as NicheAnswers;
  const sectionScores = (a.sectionScores ?? {}) as Record<
    string,
    { score: number; max: number }
  >;
  const generated = new Date().toLocaleDateString("en-GB");

  return (
    <div
      style={{ maxWidth: 820, margin: "0 auto", padding: "1.5rem", background: "#fff" }}
    >
      <div
        className="no-print"
        style={{ marginBottom: "1rem", display: "flex", gap: "0.5rem" }}
      >
        <a href={`/niche/assessments/${a.id}`} className="btn btn-secondary">
          Back
        </a>
        <span className="helptext" style={{ alignSelf: "center" }}>
          Use your browser&apos;s Print and choose Save as PDF.
        </span>
      </div>
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.75rem",
          borderBottom: "3px solid var(--cpl-purple)",
          paddingBottom: "0.75rem",
        }}
      >
        <Image src="/cpl-logo-muted.png" alt="CPL Aromas" width={40} height={40} />
        <div>
          <div className="eyebrow" style={{ margin: 0 }}>
            CPL AROMAS
          </div>
          <h1 style={{ margin: 0, fontSize: "1.375rem" }}>Niche Brand Assessment</h1>
        </div>
      </header>

      <dl className="detail-list" style={{ marginTop: "1rem" }}>
        <dt>Brand</dt>
        <dd>{brand.name}</dd>
        <dt>Reference</dt>
        <dd>{a.reference}</dd>
        <dt>Assessor</dt>
        <dd>{d.assessorName}</dd>
        <dt>Assessment date</dt>
        <dd>{fmtDate(a.assessmentDate)}</dd>
        <dt>Reviewer</dt>
        <dd>
          {d.reviewerName
            ? `${d.reviewerName}, ${fmtDate(a.reviewedAt)}`
            : "Not yet reviewed"}
        </dd>
        <dt>Framework version</dt>
        <dd>{d.frameworkVersion}</dd>
        <dt>Status</dt>
        <dd>
          {NICHE_STATUS_LABELS[a.status]}
          {a.validUntil ? `, valid until ${fmtDate(a.validUntil)}` : ""}
        </dd>
      </dl>

      {framework.sections.map((s) => (
        <section key={s.key} style={{ marginTop: "1.25rem", breakInside: "avoid" }}>
          <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
            {s.title}{" "}
            <span className="niche-weight">
              {sectionScores[s.key]?.score ?? 0} /{" "}
              {s.criteria.reduce((n, c) => n + c.weight, 0)}
            </span>
          </h2>
          <table className="data-table">
            <tbody>
              {s.criteria.map((c) => (
                <tr key={c.key}>
                  <td>{c.text}</td>
                  <td className="num" style={{ width: 70 }}>
                    {c.weight} pts
                  </td>
                  <td style={{ width: 110, fontWeight: 600 }}>
                    {answers[c.key] === "yes"
                      ? "Yes"
                      : answers[c.key] === "no"
                        ? "No"
                        : "Not answered"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      <section style={{ marginTop: "1.25rem" }}>
        <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>Outcome</h2>
        <p style={{ margin: 0 }}>
          <strong>
            {a.score ?? "—"} / {framework.maxScore}
          </strong>
          {a.band ? `, ${NICHE_BAND_LABELS[a.band]}` : ", not yet scored"}
        </p>
      </section>
      <section style={{ marginTop: "1rem" }}>
        <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
          Comments for reviewers
        </h2>
        <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>
          {a.reviewerComment || "None."}
        </p>
      </section>
      {a.reviewComment && (
        <section style={{ marginTop: "1rem" }}>
          <h2 style={{ fontSize: "1.0625rem", marginBottom: "0.25rem" }}>
            Review comment
          </h2>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{a.reviewComment}</p>
        </section>
      )}
      <footer
        className="helptext"
        style={{
          marginTop: "2rem",
          borderTop: "1px solid var(--cpl-border)",
          paddingTop: "0.5rem",
        }}
      >
        Generated from the CPL Feasibility Calculator on {generated}.
      </footer>
    </div>
  );
}
