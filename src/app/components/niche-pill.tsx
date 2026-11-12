import { NICHE_BAND_LABELS } from "./labels.js";

/** Band pill. Colour is never the only signal: the text is always shown. */
export function NichePill({ band }: { band: string | null | undefined }) {
  if (!band) {
    return <span className="status-pill niche-incomplete">Assessment incomplete</span>;
  }
  return (
    <span className={`status-pill niche-${band}`}>{NICHE_BAND_LABELS[band] ?? band}</span>
  );
}
