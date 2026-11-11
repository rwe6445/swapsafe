import type { Order, OrderLine, Prefs } from "@/lib/types";
import { bySku } from "@/lib/catalog";
export const prefs = (o: Partial<Prefs> = {}): Prefs => ({ avoidAllergens: [], diet: null, allowSubstitutions: true, ...o });
export const line = (id: string, sku: string, qty = 1, status: OrderLine["status"] = "pending"): OrderLine => {
  const p = bySku(sku)!; return { id, sku, name: p.name, size: p.size, qty, unitPriceCents: p.priceCents, status };
};
export const order = (lines: OrderLine[], o: Partial<Order> = {}): Order => {
  const total = lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0);
  return { id: "ord_test", createdAt: "2026-11-11T00:00:00Z", shopName: "Test Shop", shopperName: "Sam", shopperToken: "tok", prefs: prefs(), lines,
    status: "HELD", currency: "USD", paypal: { orderId: "O1", authorizationId: "A1", authorizedCents: total, refunds: [] },
    approvals: [], timeline: [], ledger: [], issues: [], ...o };
};
