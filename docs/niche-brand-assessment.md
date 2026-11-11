# Niche Brand Assessment

The Niche Brand Assessment (V5.1, agreed by Nick, Pauline and Claire) now lives inside the
Feasibility Calculator. A current approved assessment is what makes a brief for a niche brand
pre-approved. It replaces the old "Niche/FF pre-approved" tick box.

## How it works

1. **Brand register.** Any Account Manager or Sales Coordinator can add a brand (**Niche brands**
   in the menu). Names are matched ignoring case and spacing, and similar existing names are
   suggested. Admins can deactivate and merge brands.
2. **Assessment.** The assessor answers 14 Yes/No questions across four sections. The score and
   outcome update live. The assessment can be saved as a draft, and every question must be
   answered before submitting. There is one comment box for the reviewer.
3. **Review.** The Commercial Director approves or rejects (a rejection needs a comment). The
   assessor can never review their own assessment. If the assessor is the only holder of the
   reviewer role, the review is escalated to an Admin.
4. **Validity.** An approved assessment is valid for 12 months. A reminder email goes out 30 days
   before expiry. A newer approved assessment supersedes the old one.
5. **Briefs.** In the brief form, answer "Is this brief for a niche brand?". The server looks up
   the brand's current assessment itself (the form cannot assert one). The outcome decides the
   brief:

| Outcome (score)                        | Effect on the brief                                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Niche Tier 1 · Strategic Partner (80+) | Pre-approved. No extra sign-off.                                                                                                 |
| Niche Tier 2 · Growth Partner (55-79)  | Commercial Director sign-off (`niche_growth_partner`).                                                                           |
| Development Opportunity (35-54)        | Submitter picks a route and gives a rationale. The Development Director signs off (`niche_development_route`).                   |
| Charge or Decline (under 35)           | Submitter picks the charging model (Commercial Director signs off, `niche_charging_model`) or Decline, which declines the brief. |

If the brand has no current assessment, the form warns and the brief is scored as a standard brief.
The assessment reference, score, band, framework version and route are stored on the decision as
a snapshot, so the history never changes later.

The manual path stays, labelled **Fine Fragrance pre-approved (not a niche brand)**, with a
required rationale. An Admin can turn it off in the rule set (`nicheAssessment.allowManualFineFragrance`).

## Decisions made (D1-D10)

| #   | Decision                                                                                                                                       |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Commercial Director reviews assessments and owns growth-partner and charging-model sign-offs. Development Director owns the development route. |
| D2  | Manual fine fragrance path stays, relabelled, rationale required, switchable.                                                                  |
| D3  | A Rework (Of Selling) brief is still auto-approved even for a niche Decline.                                                                   |
| D4  | The two revenue criteria are cumulative.                                                                                                       |
| D5  | Valid 12 months; reminder 30 days before expiry.                                                                                               |
| D6  | The General Manager veto applies to brief requirements, not to assessments.                                                                    |
| D7  | Band 2 needs Commercial Director sign-off only.                                                                                                |
| D8  | Route rationale only; no structured commercial terms block.                                                                                    |
| D9  | One comment box on the assessment.                                                                                                             |
| D10 | Anyone with Account Manager or Sales Coordinator can create a brand. Admin deactivates and merges.                                             |

## Frameworks (Admin)

**Admin > Niche frameworks.** The questions, weights, band thresholds, labels, allowed routes,
validity, reminder period and reviewer role are versioned data. A published version is immutable:
create a draft, edit it, run the replay (which shows which existing assessments would change
band, without changing anything), then publish. Existing assessments keep the version they were
scored with and are never recalculated. Criterion keys cannot be reused for a different question.
The total of all weights must be 100.

## Rolling it out on an existing deployment

1. Apply migration `0005_niche_brand_assessment.sql`.
2. `npm run seed:niche` to load framework v1 (the V5.1 content).
3. `tsx src/db/seed/add-niche-routing-draft.ts <admin-upn>` creates a **draft** rule set with the
   three new requirement types. Open it in **Admin > Rule sets**, run the replay (no historical
   brief carries niche inputs, so nothing changes) and publish it.
4. Make sure the Commercial Director and Development Director roles have holders.

## Reporting

The dashboard has a **Niche brands** panel (brands by outcome, awaiting review, expiring within 30
days, brief outcomes by niche path). The brief export gains niche columns, and
`/api/reports/export/niche-assessments/csv|xlsx` has one row per assessment with a column per
question. Emails: review request, outcome, and expiry reminder.

## Verification

`src/engine/niche-parity.test.ts` scores all 16,384 Yes/No combinations of the original V5.1 HTML
tool and the new engine and requires identical scores and outcomes. The original file is kept
under `parity/niche/`.
