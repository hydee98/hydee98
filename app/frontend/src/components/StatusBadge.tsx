import type { AssetStatus } from "../types";

const STYLES: Record<AssetStatus, string> = {
  PendingReview: "badge badge-neutral",
  Active: "badge badge-status-active",
  FullyFunded: "badge badge-status-funded",
  Frozen: "badge badge-status-frozen",
  Rejected: "badge badge-status-rejected",
};

const LABELS: Record<AssetStatus, string> = {
  PendingReview: "Pending review",
  Active: "Active",
  FullyFunded: "Fully funded",
  Frozen: "Frozen",
  Rejected: "Rejected",
};

export function StatusBadge({ status }: { status: AssetStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>;
}
