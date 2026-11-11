# How the Feasibility Calculator decides things

Written for Simon to read and confirm — no code, no jargon beyond what's
already in normal use at CPL. If anything here doesn't match what you
intended, that's exactly what this document is for catching.

## The score

Every brief gets a single number, built from seven ingredients added
together. Six of them only count if the brief has a value potential above
£0 — a brief with no value potential attached only scores on tier and
creative approach.

| Ingredient         | How it's worked out                                                                                                                                             |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Customer tier      | A scores 100, T scores 100 (assumed), B scores 50, C scores 25, D scores 10                                                                                     |
| Value potential    | The value in thousands (a £200,000 brief contributes 200 points)                                                                                                |
| New / Rework       | Multiplies the value-potential points by 1 for New or Rework of a selling reference, by 0 for rework of a non-selling reference                                 |
| Brief type         | Multiplies the value-potential points by 1 for Exclusive, 0 for Competitive, or **minus 0.5** for ProActive — a speculative brief actively drags the score down |
| Customer approval  | Multiplies the value-potential points by 0.5 if the customer has directly approved, 0 if it's deferred or unknown                                               |
| Strategic priority | Adds a flat 100 points if flagged, regardless of anything else                                                                                                  |
| Creative approach  | Library Only adds 100, Starting Point adds 65, Creation/Unknown adds 0                                                                                          |

A worked example: a £200,000, A/T-tier, New, Exclusive brief with direct
customer approval and a Library Only creative approach scores
100 (tier) + 200 (value) + 200 (new) + 200 (exclusive) + 100 (direct) + 0
(no strategic flag) + 100 (library) = **900**.

## The commercial decision

Checked in this order, first match wins:

1. **Always auto-approved**, regardless of score: a rework of a selling
   reference, or anything flagged Niche/Fine Fragrance pre-approved.
2. **Declined**: score of 30 or below.
3. **Auto-approved**: score above 115.
4. **Pending approval**: anything in between.

Two things worth being explicit about, because they're different from how
the old spreadsheet worked:

- **A score of exactly 30 is a decline**, not a grey area. The old
  spreadsheet's formula technically let exactly-30 slip through to
  "pending," which was never anyone's actual intent — this fixes that.
- **The commercial decision and the approval requirements below are now
  two completely separate things.** A brief can be commercially
  Auto-Approved and still have a PPD sign-off outstanding. The system will
  never tell an Account Manager "Auto-Approved" without also telling them,
  in the same breath, exactly which sign-offs are still missing. This was
  the single biggest problem with the old spreadsheet — a project could
  read as "approved" while a required resource sign-off had quietly never
  happened.

## What triggers an approval requirement

These fire independently of the commercial decision and independently of
each other:

| Trigger                    | Condition                                                    | Who signs off                |
| -------------------------- | ------------------------------------------------------------ | ---------------------------- |
| Short deadline             | Deadline is within 14 days of submission                     | Development Director*        |
| Creative — creation        | Creative approach is Creation/Unknown, and tier isn't A or T | Development Director*        |
| Creative — starting point  | Creative approach is Starting Point, and tier is C or D      | Development Director*        |
| Marketing resource         | Marketing flagged                                            | Divisional Head of Marketing |
| PPD resource               | PPD flagged                                                  | PPD Manager                  |
| GCMS / analytical resource | GCMS flagged                                                 | Analytical Manager           |

*Provisional, pending Pauline's routing guidance — see "Still needs your
input" below.

Two rules that are firm and don't bend, by your own earlier instruction:

- A short deadline **always** raises a sign-off requirement, even on a
  brief that would otherwise sail through — this is specifically so a run
  of urgent projects can't quietly overload development without anyone
  noticing the pattern.
- Marketing and PPD sign-offs are required **regardless of customer
  tier**. The old spreadsheet skipped these for A/T-tier customers; that
  skip has been removed, per your instruction that resource requests
  always need sign-off.

## Niche brands

A brief for a niche brand relies on the brand's current Niche Brand Assessment (see
[niche-brand-assessment.md](niche-brand-assessment.md)). Strategic Partner is pre-approved, Growth
Partner needs the Commercial Director, Development Opportunity needs a route and the Development
Director, and Charge or Decline needs the charging model or is declined. A Rework (Of Selling) brief
still wins over a niche decline.

## Getting ahead of a sign-off ("pre-approval")

If an Account Manager has already spoken to the relevant manager and got
informal sign-off before submitting, they can declare that inline: name
the manager, add a short note on the circumstances. That immediately
satisfies the requirement — but the named manager gets an email with a
link that lets them undo it if it turns out to be wrong, valid for 72
hours and usable only once. If they revoke it, the requirement goes back
to needing a real decision, and if an Approval Code had already been
issued off the back of it, that code stops working immediately.

(Note: sending is wired up now — see the backlog for exactly what's
verified vs. not. The short version: the mechanism has been proven end to
end against the real database, but the actual outgoing email hasn't been
sent for real yet in any environment, so treat the first live send as
the point this is truly confirmed working, not this note.)

## The Approval Code

Once a brief is fully clear — commercially not declined, and every sign-off
resolved — a short code is generated (looks like `FC-2609-4X7K2-B`). This
gets pasted at the top of the PV notes so anyone can trace a project back
to exactly what was approved, when, and on what scoring. It's never issued
early — not on submission, not while anything is still outstanding.

Anyone with Auditor or Admin access can look up any code and see the full
picture — the original brief, the score breakdown, every sign-off and who
made it — without needing to know who submitted it in the first place.
That's deliberate: it's meant to work as an audit trail, not just a
convenience for the submitter.

## Tuning the model over time

Every number in the tables above — the tier weights, the multipliers, the
thresholds, who signs off on what — lives as adjustable settings, not
fixed into the system. When a change is made, the system re-checks every
historical brief against the new numbers and reports exactly which
decisions would have come out differently, grouped by what changed (for
example, "7 briefs would move from Declined to Pending"). That report has
to be run and reviewed before a change goes live — the intent is that
tuning the thresholds is never guesswork.

## Tier T, and conflicts of interest (decided)

- **Tier T is a separate tier from A.** T is a Target account: the work is
  likely to be proactive, so **every tier T brief needs the Commercial
  Director's approval**, whatever its score. Tier A brings no extra
  approval and scores exactly as the old combined "A/T" did (100). Tier T
  is also scored at 100, following the old spreadsheet's note "T = A
  (100)". That is an assumption: change it in the rule set editor if T
  should score differently. Briefs submitted before the split keep the
  old "A/T" label and are treated as tier A.
- **Conflict of interest goes to an Admin.** If everyone who holds an
  approval role is the person who submitted the brief (or the Account
  Manager it was submitted for), nobody can legitimately approve it, so
  the requirement is flagged as escalated, recorded in the audit trail, and
  appears in an Admin's Approvals queue. An Admin who is themselves the
  submitter cannot decide it either.
- **Who holds which role:** Commercial Director is Claire and Development
  Director is Jo. Admin is Simon or Alfred.

## Still needs your input

- **Pauline's routing guidance.** Who holds the Commercial and Development
  Director roles is now confirmed (above), but exactly which requirement
  types each signs off on is still provisional (see the table above).
  Only tier T to the Commercial Director has been confirmed. Changing the
  rest is a data change, not a rebuild.
- **Tier T's score.** Assumed to equal tier A (100); please confirm.
- **Roles for Selena and Pauline.** We know they approve, but not which
  approval role each holds (Marketing, PPD, Analytical, or other).
