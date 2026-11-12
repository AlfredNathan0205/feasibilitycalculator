/** Shown straight away while a page's data loads, so a menu click gives feedback. */
export default function Loading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <div className="page-loading-bar" />
      <p className="muted">Loading…</p>
    </div>
  );
}
