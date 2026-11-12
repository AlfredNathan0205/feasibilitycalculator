"use client";

import { useState } from "react";
import type {
  NicheAnswers,
  NicheFrameworkPayload,
} from "../../../../engine/niche-assessment.js";
import { scoreNicheAssessment } from "../../../../engine/niche-assessment.js";
import { NichePill } from "../../../components/niche-pill.js";
import { saveDraftAction, submitAssessmentAction } from "../../actions.js";

/** Assessment form: Yes/No per criterion with no default, and a sticky live summary. */
export function AssessmentForm({
  assessmentId,
  framework,
  initialAnswers,
  initialComment,
  assessmentDate,
  today,
  brandName,
  assessorName,
  frameworkVersion,
}: {
  assessmentId: string;
  framework: NicheFrameworkPayload;
  initialAnswers: NicheAnswers;
  initialComment: string;
  assessmentDate: string;
  today: string;
  brandName: string;
  assessorName: string;
  frameworkVersion: number;
}) {
  const [answers, setAnswers] = useState<NicheAnswers>(initialAnswers);
  const result = scoreNicheAssessment(answers, framework);
  const pct = Math.round((result.answeredCount / result.totalCount) * 100);

  return (
    <form className="niche-layout" action={saveDraftAction}>
      <input type="hidden" name="assessmentId" value={assessmentId} />
      <div>
        <div className="card" style={{ marginBottom: "1rem" }}>
          <div className="field-row field-row-2">
            <div className="field-group">
              <label>Brand</label>
              <div>{brandName}</div>
            </div>
            <div className="field-group">
              <label>Assessor</label>
              <div>{assessorName}</div>
            </div>
          </div>
          <div className="field-row field-row-2">
            <div className="field-group">
              <label htmlFor="assessmentDate">Assessment date</label>
              <input
                id="assessmentDate"
                name="assessmentDate"
                type="date"
                max={today}
                defaultValue={assessmentDate}
                required
              />
            </div>
            <div className="field-group">
              <label>Framework</label>
              <div className="helptext" style={{ margin: 0 }}>
                Version {frameworkVersion}
              </div>
            </div>
          </div>
        </div>

        {framework.sections.map((section) => (
          <fieldset
            key={section.key}
            className="card niche-section"
            style={{ marginBottom: "1rem", minInlineSize: 0 }}
          >
            <legend
              style={{ fontWeight: 600, fontSize: "1.0625rem", padding: "0 0.4em" }}
            >
              {section.title}
            </legend>
            <p className="niche-section-desc">{section.description}</p>
            {section.criteria.map((c) => {
              const name = `a_${c.key}`;
              return (
                <div
                  key={c.key}
                  className="niche-criterion"
                  role="group"
                  aria-labelledby={`t_${c.key}`}
                >
                  <div className="niche-criterion-text">
                    <span id={`t_${c.key}`}>{c.text}</span>
                    <span className="niche-weight">{c.weight} pts</span>
                    {c.helpText && <div className="helptext">{c.helpText}</div>}
                  </div>
                  <div className="niche-yesno">
                    {(["yes", "no"] as const).map((v) => (
                      <label key={v}>
                        <input
                          type="radio"
                          name={name}
                          value={v}
                          checked={answers[c.key] === v}
                          onChange={() => setAnswers((a) => ({ ...a, [c.key]: v }))}
                        />
                        {v === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
          </fieldset>
        ))}

        <div className="card">
          <label htmlFor="reviewerComment">Comments for reviewers</label>
          <textarea
            id="reviewerComment"
            name="reviewerComment"
            rows={5}
            defaultValue={initialComment}
            placeholder="Optional comments for future reviewers"
          />
        </div>
      </div>

      <aside className="card niche-summary" aria-live="polite">
        <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Assessment</h2>
        <div>
          {result.answeredCount} of {result.totalCount} answered
        </div>
        <div
          className="niche-progress"
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div style={{ width: `${pct}%` }} />
        </div>
        <div
          style={{ fontFamily: "var(--font-mono)", fontSize: "1.75rem", fontWeight: 600 }}
        >
          {result.score} / {framework.maxScore}
        </div>
        <ul style={{ listStyle: "none", padding: 0, margin: "0.5rem 0 1rem" }}>
          {framework.sections.map((s) => (
            <li key={s.key} className="helptext" style={{ margin: 0 }}>
              {s.title} {result.sectionScores[s.key]!.score}/
              {result.sectionScores[s.key]!.max}
            </li>
          ))}
        </ul>
        <div style={{ marginBottom: "1rem" }}>
          <NichePill band={result.band} />
        </div>
        <div style={{ display: "grid", gap: "0.5rem" }}>
          <button type="submit" className="btn btn-secondary">
            Save draft
          </button>
          <button
            type="submit"
            formAction={submitAssessmentAction}
            className="btn btn-primary"
            disabled={!result.complete}
          >
            Submit for review
          </button>
          <a
            href={`/niche/assessments/${assessmentId}/print`}
            className="btn btn-secondary"
          >
            Print
          </a>
        </div>
        {!result.complete && (
          <p className="helptext" style={{ marginBottom: 0 }}>
            Answer every criterion to submit.
          </p>
        )}
      </aside>
    </form>
  );
}
