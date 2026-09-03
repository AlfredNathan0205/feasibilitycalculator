/**
 * States that count as "satisfied" for Stage D's "any requirement not
 * satisfied -> PENDING" check (§5). Shared between createBrief (checks at
 * submission time, accounting for pre-approvals declared inline) and
 * decideRequirement (checks after a later approve/reject/revoke) so the
 * two can never define "satisfied" differently.
 *
 * "revoked" is deliberately NOT satisfied, even though the spec's prose
 * for the revoke path says the requirement "returns to pending" (§5) —
 * the schema has a distinct `revoked` state (vs plain `pending`) so the
 * audit trail can show "this was pre-approved, then revoked" rather than
 * erasing that history back to indistinguishable-from-never-declared.
 * Functionally, for Stage D purposes, `revoked` behaves exactly like
 * `pending` (not satisfied, needs a human decision) — it just isn't
 * literally written back as the string "pending".
 */
export const SATISFIED_REQUIREMENT_STATES = new Set(["approved", "pre_approved"]);
