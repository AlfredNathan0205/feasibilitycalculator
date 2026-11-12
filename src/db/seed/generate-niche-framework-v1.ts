/**
 * Writes niche-framework-v1.generated.json from the engine's v1 constant so a
 * human can diff what will be seeded (mirrors generate-ruleset-v1.ts).
 * Usage: tsx src/db/seed/generate-niche-framework-v1.ts
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  NICHE_FRAMEWORK_V1,
  NICHE_FRAMEWORK_V1_SOURCE_NOTE,
} from "../../engine/niche-framework-v1.js";
import { validateNicheFramework } from "../../engine/niche-assessment.js";

const errors = validateNicheFramework(NICHE_FRAMEWORK_V1);
if (errors.length) throw new Error(`Framework v1 is invalid: ${errors.join("; ")}`);

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "niche-framework-v1.generated.json",
);
writeFileSync(
  out,
  JSON.stringify(
    { sourceNote: NICHE_FRAMEWORK_V1_SOURCE_NOTE, payload: NICHE_FRAMEWORK_V1 },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${out}`);
