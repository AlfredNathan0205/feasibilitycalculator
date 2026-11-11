# Guide for Auditors

Auditors have **read-only** access to everything: every brief, every decision, the full audit trail and the
dashboard. Nothing you do here changes any data.

Your menu: **Briefs**, **Dashboard**, **Verify a code**.

## 1. Look up a brief from an Approval Code

Someone quotes a code (for example `FC-2609-4X7K2-B`). Open **Verify a code**, paste it and press verify. You are shown
the brief it belongs to, the **rule set version** that scored it, the score, the commercial decision and the sign-offs.
If the code is unknown or was withdrawn (for example after a revoked pre-approval or a veto) you are told so. A code that
is withdrawn means the brief is **not** approved.

## 2. Search for briefs

**Briefs** lists every brief. Search by customer reference or PV reference, filter by **status** (Pending, Approved,
Declined) and **tier**, and page through. Each row shows the score, commercial decision, how many sign-offs are still
outstanding, and the Approval Code if issued.

## 3. Read a brief and its audit trail

Open a brief to see:

- the **inputs** exactly as submitted, and who submitted it (and on whose behalf),
- the **score breakdown**, component by component, and the **rule set version**,
- each **sign-off**: which role, its state (Pending, Approved, Rejected, Pre-approved, Revoked), who decided it, when, and their comment,
- any **veto** (who, when, why) and any pre-approval declaration,
- the **audit trail**: a time-ordered list of events (for example `brief.submitted`, `requirement.approved`,
  `requirement.escalated_to_admin`, `brief.vetoed`, `brief.veto_reversed`).

The audit trail is **append-only**: the database prevents any event from being edited or deleted.

## 4. Dashboard

A month-by-month table of briefs, value and the Marketing, PPD, GCMS and Creative sign-offs they raised; a table of briefs
by Account Manager; volumes and outcomes by month, approval rate and time-to-decision by role, the score distribution,
how often pre-approval is used (and revoked) by submitter, and short-deadline volume. The **Account Manager** box at the
top narrows the brief panels to one person. On the **Briefs** list the same box filters by Account Manager. Use it to spot bottlenecks and unusual behaviour,
for example one submitter pre-approving a lot, or a role with a long median time to decide.

## 5. Questions an audit might ask, and where to look

| Question                                           | Where                                                                                                 |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Was this brief properly approved?                  | **Verify a code** → check each sign-off is Approved or Pre-approved and the code is present.          |
| Which rules scored it?                             | Brief page → rule set version (versions are immutable).                                               |
| Who approved it, and did they have the right role? | Brief page → sign-off decided by; roles are in the audit trail and with an Admin.                     |
| Did anyone approve their own brief?                | Not possible: such sign-offs are escalated to an Admin and logged (`requirement.escalated_to_admin`). |
| Was a sign-off overridden?                         | Look for pre-approval declarations, revocations, vetoes and reversals on the brief and in the trail.  |
| Has anyone changed who holds a role?               | An Admin can show role changes (`user.*` and `role.*` events).                                        |

## 6. Limits

- Auditors can't see the people list or change anything.
- There is no export yet; the data is in the database, and CPL IT can run a query on request.
