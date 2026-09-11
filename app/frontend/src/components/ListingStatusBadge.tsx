import type { ListingStatus } from "../types";

const STYLES: Record<ListingStatus, string> = {
  PendingReview: "badge badge-neutral",
  Active: "badge badge-status-active",
  Flagged: "badge badge-status-rejected",
  UnderOffer: "badge badge-status-funded",
  Sold: "badge badge-status-frozen",
  Removed: "badge badge-status-rejected",
};

const LABELS: Record<ListingStatus, string> = {
  PendingReview: "Pending review",
  Active: "Active",
  Flagged: "Flagged for review",
  UnderOffer: "Under offer",
  Sold: "Sold",
  Removed: "Removed",
};

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>;
}
