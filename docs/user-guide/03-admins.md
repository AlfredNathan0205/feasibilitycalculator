# Guide for Admins

Admins look after **people and roles**, the **scoring rules**, **escalated sign-offs** and **vetoes**.
It is a deliberately small group (currently Alfred Muthunathan, Simon Roper and Tia O'Neil).
Admins can see every brief, the audit trail and the dashboard, but can only **submit briefs** if they are also given
the Account Manager role. Simon and Tia hold both. Add the role on **People and roles**; it applies the next
time they sign in. A sign-off on a brief an Admin submitted goes to another Admin, never back to them.

Your menu: **Briefs**, **Approvals**, **Dashboard**, **Rule sets**, **People and roles**, **Verify a code**.

## 1. People and roles

Open **People and roles**. Every person is listed with their roles, whether they have signed in yet, and
whether they are active.

**Add a person.** Enter their **name** and **work email** (their Microsoft sign-in address) and press
**Add person**. They have no access until you give them a role. When they first sign in with Microsoft, their
account is matched to this entry by email address (capitals don't matter).

**Give a role.** In their row, choose a role from **Add a role** and press **Add**. Roles are of two kinds:

| Kind           | Roles                                                                                                                            | Purpose                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Access roles   | Account Manager, Sales Coordinator, Approver, Auditor, Admin                                                                     | What the person can do in the app. |
| Approval roles | PPD Manager, Analytical Manager, Development Director, Divisional Head of Marketing, Commercial Director, General Manager (veto) | Which sign-offs they handle.       |

An **approver needs both**: the _Approver_ access role **and** the specific approval role(s). Someone can hold several
(Jo Lambert holds Approver, Development Director, PPD Manager and Analytical Manager).

**End a role.** Press the **×** on the role. It ends immediately for new sign-ins, and the history is kept.

**Deactivate / Reactivate.** Use this when someone leaves. A deactivated person cannot sign in. Their past
decisions stay in the record.

Rules the screen enforces:

- You cannot remove or deactivate the **last active Admin**.
- A role can't be given twice.
- Every change is written to the **audit trail**.

> **Role changes apply when the person next signs in.** They are fixed at sign-in, so someone already signed in keeps
> their old roles until they sign out and in again (and a deactivated person who is already signed in stays signed in until
> their session ends). For urgent removals, also ask CPL IT to disable the person's Microsoft account.

**Cover for leave.** Roles can have more than one holder. Add the second person to the same approval role.
A sign-off goes to the role, so any holder can decide it.

## 2. Scoring rules (Rule sets)

The score, the thresholds and the routing table live in a versioned **rule set**. Only Admins can change them.

- A **published** rule set is **immutable** and is the one used for every new brief. Every brief records which version scored it.
- To change anything you create a **new draft**, edit it, **replay** it, then **publish**.

**Workflow**

1. **Rule sets → New draft.** The draft starts as a copy of the published set.
2. Edit: **tier weights**, the **auto-approve and decline thresholds**, the **multipliers and scores**
   (new/rework, brief type, customer approval, creative approach), the **strategic priority bonus**, the **short
   deadline window (days)**, and the **routing table** (which role approves each sign-off, and whether it is enabled).
3. **Save draft.**
4. **Run replay.** Every past brief is re-scored with the draft, and you are shown how many commercial decisions
   would change, grouped by move (for example "declined → pending: 7"), with the briefs listed. **Read this before
   publishing:** it tells you what the change really does.
5. **Publish.** Publishing is only offered after a replay of the _current saved_ draft. It replaces the previous rule
   set (which is kept for history). Past briefs keep their original decision; only new briefs use the new rules.

Current settings (v1): auto-approve above **115**, decline at or below **30**, short-deadline window **14 days**.

**Adding Tier T.** Tier T (Target account: always Commercial Director approval) is a separate tier from A. The
tier list itself cannot be edited on screen. CPL IT runs a one-off job that creates a draft with Tier T added
(deployment guide, section 10); you then replay and publish it like any other draft. The Tier T weight is
assumed to be **100** (same as A): confirm or change it in the draft before publishing.

## 3. Escalated sign-offs

If the only people who hold an approval role are the person who submitted the brief (or the Account Manager it was
submitted for), they cannot approve their own brief. The sign-off is **escalated to Admin**: it appears in
**Approvals** with an _Escalated to Admin_ tag and the reason, and the event is in the audit trail. Approve or reject it as
you would any other. (You never see escalated items for briefs you submitted yourself.)

If a sign-off has **no holder at all** it is not escalated; it just waits. Fix it by giving someone the role.

## 4. Vetoes

When the General Manager vetoes a brief, the brief page shows a red **Vetoed by the General Manager** box with the
name, time and reason. Only an Admin can reverse it:

1. Open the brief (**Briefs** → customer).
2. Type a **reason for reversing** (required) and press **Reverse veto**.

The vetoed sign-off returns to the approver's queue, the brief goes back to **Pending**, the submitter is emailed, and
both the veto and its reversal stay in the audit trail.

## 5. Looking things up

- **Briefs:** every brief, searchable by customer or PV reference, filterable by status, tier and **Account Manager**.
  Pick a name in the **Account Manager** box and press **Filter** to see just that person's briefs, including any a Sales
  Coordinator raised on their behalf. Opening a brief shows the full **audit trail** (submission, each decision,
  escalations, vetoes, role-related events).
- **Dashboard:** a **month-by-month table** (briefs, value potential, and how many Marketing, PPD, GCMS and Creative
  sign-offs they raised, plus short-deadline briefs), a **By Account Manager** table (briefs, approved, pending,
  declined, sign-offs still waiting, value, with links to that person's dashboard and briefs), volume by tier and
  requirement type, outcome mix by month, approval rates and decision times by role, score distribution and
  pre-approval usage. Use the **Account Manager** box at the top to narrow every brief panel to one person (for
  example to review a team member's work); approval rates by role always show the whole team. **Export CSV / XLSX**
  respects the same selection and includes an Account Manager column.
  The General Manager can also open the dashboard (without exports).
- **Verify a code:** paste an Approval Code to open the brief it belongs to.

## 6. Housekeeping checklist

| When                | What                                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------------- |
| Someone joins       | Add them, give roles, tell them to sign in.                                                       |
| Someone leaves      | Deactivate them; reassign any approval role they alone held.                                      |
| Someone is on leave | Add a second holder to their approval role.                                                       |
| Rules change        | New draft → replay → publish; tell approvers and submitters.                                      |
| Each quarter        | Review who holds Admin and each approval role. Check the dashboard for roles with slow decisions. |

## 7. Things to know

- Nothing is ever deleted. Briefs, decisions and audit events are a permanent record.
- **Emails:** approvers are emailed when a sign-off is raised for their role, and submitters when their brief is approved or a
  sign-off is rejected (full list in the quick reference). When a sign-off has escalated to Admins, **you** are
  the people emailed. There are no reminders for sign-offs left waiting; check **Approvals** now and then.
- Technical problems (sign-in failures, errors, missing emails): contact CPL IT.
