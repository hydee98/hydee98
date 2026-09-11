import type { OrderStatus } from "../types";

const STYLES: Record<OrderStatus, string> = {
  Funded: "badge badge-status-funded",
  Released: "badge badge-status-active",
  Disputed: "badge badge-status-rejected",
  Resolved: "badge badge-neutral",
  Cancelled: "badge badge-neutral",
};

const LABELS: Record<OrderStatus, string> = {
  Funded: "In escrow",
  Released: "Released to seller",
  Disputed: "Disputed",
  Resolved: "Resolved",
  Cancelled: "Cancelled",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <span className={STYLES[status]}>{LABELS[status]}</span>;
}
