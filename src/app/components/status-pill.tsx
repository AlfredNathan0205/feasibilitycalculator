export type FinalStatus = "approved" | "pending" | "declined";

export function StatusPill({ status }: { status: FinalStatus }) {
  const label =
    status === "approved" ? "Approved" : status === "declined" ? "Declined" : "Pending";
  return <span className={`status-pill status-${status}`}>{label}</span>;
}
