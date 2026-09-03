# Open questions

Per Build Prompt §15: where the workbook or spec leaves something genuinely
ambiguous, this documents the cell reference and the candidate
interpretations, rather than the implementer silently picking one.

## 1. "Tier T" has no distinguishable input in the live workbook

**Where:** `Calculator!E21` ("T = A (100)"); Build Prompt §11 item 2.

**The ambiguity:** §11 item 2 says the discarded draft sheet treated tier T
as an automatic deferral to the Commercial Director, and asks for "tier
raises an automatic approval requirement" to be built as an available,
currently-disabled routing rule — implying a tier T distinct from tier A
exists as an input.

But the live workbook's actual data validation for the tier dropdown
(`Calculator!B2`) is an x14 list validation against `Reference!$A$2:$A$5`,
whose four values are literally `"A/T"`, `"B"`, `"C"`, `"D"` — confirmed by
inspecting the workbook's XML directly. There is no separate "T" option
anywhere in the live input model. `E21`'s note is a leftover from whatever
earlier version of the sheet did distinguish them.

**Candidate interpretations:**
1. Treat "A/T" as satisfying "tier T" for the disabled rule, i.e. the
   disabled `tier_auto_approval` requirement would fire for every A/T-tier
   brief if enabled.
2. Treat the disabled rule as currently unimplementable/inert until tier T
   becomes a real, separate input — which would likely require splitting the
   `A/T` dropdown option into `A` and `T`, a change to the live model that
   hasn't been requested or confirmed anywhere.

**What's implemented:** Option 2 — the `tier_auto_approval` requirement type
and its (disabled) routing-table row exist in the schema and the engine's
`RequirementType` union, so no schema change is needed once this is
resolved, but no code path in `computeStageB` currently raises it (see the
comment at that point in `src/engine/decision.ts`). A skipped test
documenting this is in `src/engine/decision.test.ts`.

**Needs:** A decision from Simon (or whoever owns tier definitions) on
whether tier T is being reintroduced as a distinct input, and if so, what
distinguishes it from tier A other than the historical note.

## 2. "Reassign to their line manager role" has no line-manager relationship in the data model

**Where:** Build Prompt §2 ("An approver may not approve a brief they
themselves submitted. Reassign to their line manager role and flag it in
the audit trail.")

**The ambiguity:** The instruction assumes a resolvable "line manager"
relationship for any approver. But the schema (§8) has no field or table
capturing "who manages whom" — `role_holders` records role assignments
(who currently holds `ppd_manager`, etc.), not a reporting hierarchy. There
is no `manager_of` relationship, no `line_manager_id` on `users`, nothing.

**Candidate interpretations:**
1. Add a reporting-hierarchy concept to the schema (e.g. `users.line_manager_id`
   self-referencing FK), populated from Entra's manager field or entered
   manually.
2. Treat "line manager" loosely as "whoever holds the next role up in that
   specific approval chain" (e.g. PPD Manager's conflict reassigns to
   whoever holds a more senior role) — but no such seniority ordering is
   defined either.
3. Treat this as an escalation to Admin rather than an automatic reassignment
   — i.e. "flag it and let a human decide who acts instead," which needs no
   new schema at all.

**What's implemented:** `checkSelfApproval()` and
`requireCanDecideRequirement()` in `src/auth/authz.ts` reliably *detect*
the self-approval conflict and block the action, but deliberately do not
attempt to resolve or auto-assign a reassignment target — that part is left
for whoever answers this question. The function's docstring and error
message point back here.

**Needs:** A decision from Simon on which of the three interpretations (or
another) is intended, before the reassignment half of this rule can be
built.

