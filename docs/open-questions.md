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
