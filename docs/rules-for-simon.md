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
| Customer tier      | A/T scores 100, B scores 50, C scores 25, D scores 10                                                                                                           |
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

| Trigger                    | Condition                                                 | Who signs off                |
| -------------------------- | --------------------------------------------------------- | ---------------------------- |
| Short deadline             | Deadline is within 14 days of submission                  | Development Director*        |
| Creative — creation        | Creative approach is Creation/Unknown, and tier isn't A/T | Development Director*        |
| Creative — starting point  | Creative approach is Starting Point, and tier is C or D   | Development Director*        |
| Marketing resource         | Marketing flagged                                         | Divisional Head of Marketing |
| PPD resource               | PPD flagged                                               | PPD Manager                  |
| GCMS / analytical resource | GCMS flagged                                              | Analytical Manager           |

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

## Still needs your input

- **Pauline's routing guidance.** Exactly what the Commercial Director and
  Development Director each sign off on is still provisional (see the
  table above). Changing this is a data change, not a rebuild, whenever
  she's confirmed it.
- **Tier T.** An old note in the spreadsheet suggested tier T should be
  treated differently from tier A, with its own automatic sign-off. But
  the actual dropdown in the live spreadsheet only ever offers a combined
  "A/T" option — there's no way for someone to select "T" specifically. If
  tier T is meant to come back as its own distinct option, that's a change
  to what Account Managers see on the form, and needs a decision on what
  actually distinguishes a T-tier customer from an A-tier one.
- **Who gets reassigned when there's a conflict of interest.** If an
  approver is asked to sign off on a brief they submitted themselves (or
  submitted on behalf of), the system correctly blocks it — but it doesn't
  yet know who to hand it to instead, because "who is this person's line
  manager" isn't tracked anywhere yet. Worth deciding whether that's a new
  piece of data to capture, or whether it should just escalate to you/Admin
  directly each time.
- **Who actually holds Admin.** Deliberately meant to be a small, named
  group rather than everyone with access — worth confirming who that is in
  practice before this goes anywhere near production use.
