import { getPool, isDbEnabled } from "../db/pool.js";
import type { DisputeMessage, Order } from "../types.js";
import { seedOrders } from "./seedData.js";

/**
 * Order (escrow) store - mirrors the pattern in data/listings.ts:
 * Postgres-backed when DATABASE_URL is set, in-memory otherwise.
 */

const memoryStore = new Map<string, Order>(seedOrders.map((o) => [o.id, o]));

export async function listOrders(filter?: { listingId?: string }): Promise<Order[]> {
  let all: Order[];
  if (isDbEnabled()) {
    const { rows } = await getPool().query<{ data: Order }>(
      "SELECT data FROM orders ORDER BY created_at"
    );
    all = rows.map((r) => r.data);
  } else {
    all = Array.from(memoryStore.values());
  }
  return filter?.listingId ? all.filter((o) => o.listingId === filter.listingId) : all;
}

export async function getOrder(id: string): Promise<Order | undefined> {
  if (isDbEnabled()) {
    const { rows } = await getPool().query<{ data: Order }>(
      "SELECT data FROM orders WHERE id = $1",
      [id]
    );
    return rows[0]?.data;
  }
  return memoryStore.get(id);
}

export async function createOrder(input: {
  listingId: string;
  buyerWallet: string;
  amountUsd: number;
  paymentCurrency: Order["paymentCurrency"];
  paymentAmount: number;
  feeUsd: number;
}): Promise<Order> {
  const id = `order-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const order: Order = {
    id,
    onChainOrderId: null,
    listingId: input.listingId,
    buyerWallet: input.buyerWallet,
    amountUsd: input.amountUsd,
    paymentCurrency: input.paymentCurrency,
    paymentAmount: input.paymentAmount,
    feeUsd: input.feeUsd,
    status: "Funded",
    disputeReasonUri: null,
    disputeMessages: [],
    createdAt: new Date().toISOString(),
  };

  if (isDbEnabled()) {
    await getPool().query(
      "INSERT INTO orders (id, listing_id, data, created_at) VALUES ($1, $2, $3, $4)",
      [id, order.listingId, order, order.createdAt]
    );
  } else {
    memoryStore.set(id, order);
  }
  return order;
}

export async function updateOrder(id: string, patch: Partial<Order>): Promise<Order | undefined> {
  const existing = await getOrder(id);
  if (!existing) return undefined;
  const updated = { ...existing, ...patch };

  if (isDbEnabled()) {
    await getPool().query("UPDATE orders SET data = $2 WHERE id = $1", [id, updated]);
  } else {
    memoryStore.set(id, updated);
  }
  return updated;
}

export async function addDisputeMessage(
  id: string,
  message: DisputeMessage
): Promise<Order | undefined> {
  const existing = await getOrder(id);
  if (!existing) return undefined;
  return updateOrder(id, { disputeMessages: [...existing.disputeMessages, message] });
}
