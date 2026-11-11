/**
 * Reference implementation of the V5.1 tool, extracted from the original HTML.
 * Criteria and weights are read from the HTML source itself (not retyped);
 * calc() band logic is reproduced verbatim from the file.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface V51Criterion {
  text: string;
  weight: number;
}
export interface V51Reference {
  criteria: V51Criterion[]; // in on-screen order
  calc(ticked: boolean[]): { score: number; label: string };
}

export function loadV51Reference(): V51Reference {
  const html = readFileSync(
    join(__dirname, "CPL_Niche_Brand_Assessment_V5_1.html"),
    "utf8",
  );
  const m = /const data=(\[\[.*?\]\]);/s.exec(html);
  if (!m) throw new Error("Could not find the criteria data array in the V5.1 HTML");
  const data = new Function(`return ${m[1]}`)() as Array<[string, string, string[]]>;
  const criteria = data.flatMap((s) =>
    s[2].map((q) => {
      const [text, w] = q.split("|");
      return { text: text!, weight: Number(w) };
    }),
  );
  return {
    criteria,
    calc(ticked) {
      let t = 0;
      criteria.forEach((c, i) => {
        if (ticked[i]) t += c.weight;
      });
      // Verbatim ladder from calc() in the V5.1 HTML.
      let msg: string;
      if (t >= 80) msg = "Tier 1 - Strategic Niche Partner | APPROVE";
      else if (t >= 55) msg = "Tier 2 - Growth Niche Partner";
      else if (t >= 35)
        msg =
          "Charging Model / Junior Perfumer Development Opportunity / Perfumer Passion Project";
      else msg = "Charging Model / Decline";
      return { score: t, label: msg };
    },
  };
}
