# Project Feasibility Calculator — User guide

For everyone at CPL Aromas who submits, approves, administers or audits fragrance project briefs.
(Version 1.0, November 2026.)

## What is this?

The Project Feasibility Calculator replaces the old Excel workbook. You enter the facts about
a customer's brief; the calculator scores it, tells you whether it can go ahead commercially,
works out which colleagues must sign off resources, and issues an **Approval Code** once
everything is cleared. Every step is recorded so it can be checked later.

## Which guide is for me?

| If you…                                                                        | Read                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| submit briefs (Account Manager, Sales Coordinator)                             | [Account Managers and Sales Coordinators](01-account-managers.md)  |
| are asked to approve resources (Jo Lambert, Selena Wagstaff, Claire Holland …) | [Approvers](02-approvers.md)                                       |
| are the General Manager (veto)                                                 | [Approvers](02-approvers.md), section "The General Manager's veto" |
| look after people, roles and scoring rules (Admins)                            | [Admins](03-admins.md)                                             |
| need to check a brief or a code after the fact (Auditors, Admins)              | [Auditors](04-auditors.md)                                         |
| just want the one-page summary                                                 | [Quick reference](05-quick-reference.md)                           |

## The idea in one minute

```
Submit brief ──▶ Score and commercial decision ──▶ Resource sign-offs ──▶ Approval Code
 (you)           (automatic, instant)                (approvers)            (when all clear)
```

1. **Commercial decision** (automatic). The score decides one of three outcomes:
   **Auto-approved**, **Pending** or **Declined**. (Rework of a selling fragrance, or a
   niche/fine-fragrance pre-approval, is always auto-approved.)
2. **Sign-offs** (people). Independently of the commercial decision, a brief can need approval
   from named colleagues, for example for a short deadline, a creative approach, or a PPD,
   GCMS or marketing resource. A brief can be _commercially_ auto-approved and still be waiting
   for a sign-off. The screen always shows both.
3. **Approval Code.** When every sign-off is cleared (and the brief isn't declined) the brief is
   **Approved** and receives a code like `FC-2609-4X7K2-B`. No code, no go-ahead.

## Signing in

Open the address CPL IT gives you and choose **Sign in with Microsoft**, using your CPL
account. What you see depends on the roles an Admin has given you. If you sign in and see
very little, you probably have no role yet. Ask an Admin (see the [Admin guide](03-admins.md)).
Role changes take effect **the next time you sign in**, so sign out and in again after one.

## Roles at a glance

| Role                                           | Can do                                                                                                                                  |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Account Manager** / **Sales Coordinator**    | Submit briefs; see their own briefs and outcomes. (Currently the two roles behave identically in the screens.)                          |
| **Approver** (plus one or more approval roles) | Approve or reject the sign-offs assigned to their role.                                                                                 |
| **General Manager (veto)**                     | See every brief and the dashboard; veto any open sign-off.                                                                              |
| **Auditor**                                    | Read-only access to all briefs, decisions, audit trail and the dashboard.                                                               |
| **Admin**                                      | Everything an Auditor sees, plus people and roles, scoring rules and veto reversals. Submits briefs only if also given Account Manager. |

The sign-offs and who holds them (CPL's current setup):

| Sign-off                                      | Raised when                                                                     | Approved by                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------- | -------------------------------------------- |
| Short deadline                                | The deadline is 14 days or fewer away (the short-deadline window)               | Development Director (Jo Lambert)            |
| Creative approach (creation / starting point) | Creation/Unknown for tiers other than A and T; Starting Point for tiers C and D | Development Director (Jo Lambert)            |
| Marketing resource                            | The brief needs marketing resource                                              | Divisional Head, Marketing (Selena Wagstaff) |
| PPD resource                                  | The brief needs PPD resource                                                    | PPD Manager (Jo Lambert)                     |
| GCMS / analytical resource                    | The brief needs GCMS                                                            | Analytical Manager (Jo Lambert)              |
| Tier T (Target account)                       | The brief's tier is T (once Tier T is switched on)                              | Commercial Director (Claire Holland)         |

Admins can change who holds each role. Pauline Holmes (General Manager) may veto any open
sign-off but is not asked to approve any.

## Glossary

| Term                       | Meaning                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Brief**                  | A customer's request for a fragrance project, as entered here.                                                                        |
| **Score**                  | A number calculated from the brief's facts using the current rule set.                                                                |
| **Commercial decision**    | Auto-approved, Pending or Declined, from the score and a few exceptions.                                                              |
| **Requirement / sign-off** | A named colleague must approve something (a resource, a deadline).                                                                    |
| **Approval Code**          | The reference issued when a brief is fully cleared.                                                                                   |
| **Rule set**               | The scoring weights, thresholds and routing table. Versioned; the version used is recorded on every brief.                            |
| **Pre-approval**           | A submitter declares a manager has already agreed a sign-off (see the Account Manager guide). The manager can revoke it for 72 hours. |
| **Escalated**              | A sign-off that would go to the submitter themselves goes to an Admin instead.                                                        |
| **Veto**                   | The General Manager blocks an open sign-off and declines the brief until an Admin reverses it.                                        |

## Getting help

Questions about a brief, a score or who should approve: ask an Admin (Simon Roper, Tia O'Neil
or Alfred Muthunathan). Technical problems (can't sign in, page errors): CPL IT.
