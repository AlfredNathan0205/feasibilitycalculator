/**
 * Generates the version 1 rule set payload by reading the workbook's
 * Reference sheet DIRECTLY — no hand-transcribed values — per Build Prompt
 * §10 item 1: "Read the lookup tables directly from the workbook's Reference
 * sheet and generate the version 1 rule set seed from them. No transcription
 * by hand."
 *
 * Everything NOT present as a lookup table in the workbook (the deadline
 * window, the routing table, the disabled routing rules) is confirmed
 * separately in writing (see the Simon Roper correspondence) and is set
 * here as an explicit, commented default — these are NOT read from the
 * spreadsheet, because the spreadsheet doesn't encode them at all (routing
 * is hardcoded names in formulas, which is the defect this rebuild fixes)
 * or because the spec deliberately overrides the workbook's stale value
 * (deadline window: workbook says 21 days, spec confirms 14 — see
 * Build Prompt §11 item 1).
 *
 * Usage:
 *   npm run seed:generate-ruleset -- /path/to/Project-Feasibility-Calculator.xlsx
 *
 * Output: writes src/db/seed/ruleset-v1.generated.json and also prints it,
 * so it can be inspected/diffed before being loaded by apply-seed.ts.
 */

// The xlsx package's ESM build only puts the full API on the default export;
// named imports (e.g. `import { readFile }`) resolve to undefined under
// Node's ESM loader with this package version.
import XLSX from "xlsx";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const workbookPath =
  process.argv[2] ??
  "/mnt/user-data/uploads/Project-Feasibility-Calculator.xlsx";

const workbook = XLSX.readFile(workbookPath);

const referenceSheetMaybe = workbook.Sheets["Reference"];
if (!referenceSheetMaybe) {
  throw new Error(
    `Expected a "Reference" sheet in ${workbookPath}, found: ${workbook.SheetNames.join(", ")}`,
  );
}
const referenceSheet: XLSX.WorkSheet = referenceSheetMaybe;

/** Read a single cell's value by address, e.g. "B2". Throws if missing —
 * a missing cell means the workbook's shape has changed and this script
 * must not silently substitute a guessed value. */
function cell(addr: string): string | number {
  const c = referenceSheet[addr];
  if (c === undefined) {
    throw new Error(
      `Reference!${addr} is empty — workbook shape has changed, refusing to guess a value`,
    );
  }
  return c.v;
}

// --- Customer tier weights: Reference!A2:B5 ---------------------------------
const tierWeights = {
  [cell("A2") as string]: cell("B2") as number, // A/T
  [cell("A3") as string]: cell("B3") as number, // B
  [cell("A4") as string]: cell("B4") as number, // C
  [cell("A5") as string]: cell("B5") as number, // D
};

// --- New/Rework multipliers: Reference!D2:E4 --------------------------------
const newReworkMultipliers = {
  [cell("D2") as string]: cell("E2") as number, // New
  [cell("D3") as string]: cell("E3") as number, // Rework (Of Selling)
  [cell("D4") as string]: cell("E4") as number, // Rework (Non-Selling)
};

// --- Brief type multipliers: Reference!G2:H4 --------------------------------
const briefTypeMultipliers = {
  [cell("G2") as string]: cell("H2") as number, // Exclusive
  [cell("G3") as string]: cell("H3") as number, // Competitive
  [cell("G4") as string]: cell("H4") as number, // ProActive
};

// --- Customer approval multipliers: Reference!J2:K3 -------------------------
const customerApprovalMultipliers = {
  [cell("J2") as string]: cell("K2") as number, // Direct
  [cell("J3") as string]: cell("K3") as number, // Deferred/Unknown
};

// --- Creative approach scores: Reference!M2:N4 ------------------------------
// N4 (Creation/Unknown) is the formula ="" in the workbook, which Excel
// evaluates as an empty string, not a number. The spec (§3) is explicit that
// this component scores 0, so we coerce blank/non-numeric to 0 rather than
// propagate the workbook's formula artefact.
function asScore(v: string | number): number {
  return typeof v === "number" ? v : 0;
}
const creativeApproachScores = {
  [cell("M2") as string]: asScore(cell("N2")), // Library Only -> 100
  [cell("M3") as string]: asScore(cell("N3")), // Starting Point -> 65
  [cell("M4") as string]: asScore(cell("N4")), // Creation/Unknown -> 0
};

// --- Strategic priority flat bonus -----------------------------------------
// Not a Reference-sheet lookup (it's the Calculator!D8 formula IF(B8=TRUE,100)),
// but it IS a fixed, confirmed constant, so it's recorded here rather than
// buried in application code, per the "no invented / hardcoded values"
// discipline the spec asks for everywhere else.
const strategicPriorityBonus = 100;

// --- Thresholds: Calculator!G2:G4 -------------------------------------------
const calculatorSheetMaybe = workbook.Sheets["Calculator"];
if (!calculatorSheetMaybe) {
  throw new Error(`Expected a "Calculator" sheet in ${workbookPath}`);
}
const calculatorSheet: XLSX.WorkSheet = calculatorSheetMaybe;
function calcCell(addr: string): number {
  const c = calculatorSheet[addr];
  if (c === undefined) {
    throw new Error(`Calculator!${addr} is empty — cannot read threshold`);
  }
  return c.v as number;
}
const thresholds = {
  autoApproveAbove: calcCell("G2"), // 115 — score > this => Auto-Approved
  declineAtOrBelow: calcCell("G4"), // 30 — score <= this => Declined (exactly 30 IS a decline, §3)
};

// --- Deadline window ---------------------------------------------------------
// INTENTIONAL DEVIATION from the workbook (Build Prompt §11 item 1): the
// live formula in Calculator!E13 still reads TODAY()+21. Simon confirmed in
// writing (see correspondence) that the real window is 14 days and the
// workbook was simply never updated. Do NOT read this value from the sheet.
const deadlineWindowDays = 14;

// --- Routing table -----------------------------------------------------------
// Not present in the workbook as data at all — it's hardcoded names inside
// formulas (Jo, Claire, Selena, Nathalia, Damian), which is the defect this
// rebuild fixes (§2, §11 item 5). Requirement -> approval-authority role key.
// Commercial Director / Development Director assignments are provisional
// pending Pauline Holmes's guidance (§2, §12 item 1) — represented as data so
// they can be repointed without a code change or redeploy.
const routingTable = {
  short_deadline: { role: "development_director", enabled: true },
  creative_creation: { role: "development_director", enabled: true },
  creative_starting_point: { role: "development_director", enabled: true },
  marketing_resource: { role: "divisional_head_marketing", enabled: true },
  ppd_resource: { role: "ppd_manager", enabled: true },
  gcms_resource: { role: "analytical_manager", enabled: true },
  // Disabled-by-default alternates documented in §11 items 2 and 3 — kept
  // available so they can be turned on without a schema or code change if
  // Simon's guidance changes.
  tier_auto_approval: { role: "commercial_director", enabled: false },
  strategic_priority_deferral: { role: "commercial_director", enabled: false },
};

export const ruleSetV1Payload = {
  sourceWorkbook: {
    fileName: path.basename(workbookPath),
    referenceSheetRead: true,
    generatedAt: new Date().toISOString(),
  },
  tierWeights,
  newReworkMultipliers,
  briefTypeMultipliers,
  customerApprovalMultipliers,
  creativeApproachScores,
  strategicPriorityBonus,
  thresholds,
  deadlineWindowDays,
  routingTable,
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const outPath = path.join(__dirname, "ruleset-v1.generated.json");
  writeFileSync(outPath, JSON.stringify(ruleSetV1Payload, null, 2));
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(ruleSetV1Payload, null, 2));
}
