import type { Approval, Order, OrderLine, Settlement, SettlementLine, Substitution } from "./types";
import { sha } from "./policy";

export const proposalHash = (line: Pick<OrderLine, "id" | "qty">, s: Pick<Substitution, "sku" | "photo"> & { chargeCentsPerUnit: number }) =>
  sha({ lineId: line.id, qty: line.qty, sku: s.sku, charge: s.chargeCentsPerUnit, photo: s.photo?.sha256 ?? null });

/** Pure function of the order: what would be captured right now, and why it may not be yet. */
export function computeSettlement(order: Order): Settlement {
  const blockers: string[] = [];
  const lines: SettlementLine[] = order.lines.map((l) => {
    const base = { lineId: l.id, qty: l.qty };
    if (l.status === "pending") { blockers.push(`"${l.name}" has not been picked or marked out of stock.`); return { ...base, label: l.name, chargeCents: 0, basis: "removed", note: "not picked yet" }; }
    if (l.status === "picked") return { ...base, label: l.name, chargeCents: l.qty * l.unitPriceCents, basis: "picked", note: "picked as ordered" };
    const s = l.substitution;
    if (!s) return { ...base, label: l.name, chargeCents: 0, basis: "removed", note: "out of stock, not charged" };
    if (s.status === "proposed") { blockers.push(`The shopper has not answered the swap for "${l.name}".`); return { ...base, label: l.name, chargeCents: 0, basis: "removed", note: "waiting for the shopper" }; }
    if (s.status === "accepted") {
      const current = proposalHash(l, { sku: s.sku, photo: s.photo, chargeCentsPerUnit: s.decision.chargeCentsPerUnit });
      if (s.decision.verdict !== "offer" || !s.consent || s.consent.decision !== "accepted" || s.consent.proposalHash !== current) {
        blockers.push(`The swap for "${l.name}" changed after the shopper agreed. It needs a new answer.`);
        return { ...base, label: l.name, chargeCents: 0, basis: "removed", note: "consent does not match the current proposal" };
      }
      const charge = Math.min(s.decision.chargeCentsPerUnit, l.unitPriceCents) * l.qty;
      return { ...base, label: `${s.name} (swap for ${l.name})`, chargeCents: charge, basis: "substituted", note: "swap accepted by the shopper" };
    }
    return { ...base, label: l.name, chargeCents: 0, basis: "removed", note: s.status === "declined" ? "swap declined by the shopper, not charged" : "swap blocked by the rules, not charged" };
  });
  const authorizedCents = order.paypal.authorizedCents ?? 0;
  const totalCents = lines.reduce((a, l) => a + l.chargeCents, 0);
  if (!order.paypal.authorizationId) blockers.push("No PayPal authorization on this order.");
  if (totalCents > authorizedCents) blockers.push("Total exceeds the authorized amount.");
  const core = { orderId: order.id, authorizationId: order.paypal.authorizationId ?? null, lines: lines.map((l) => [l.lineId, l.basis, l.chargeCents]), totalCents };
  return { ready: blockers.length === 0, blockers, lines, totalCents, authorizedCents, releaseCents: Math.max(authorizedCents - totalCents, 0), action: totalCents > 0 ? "capture" : "void", hash: sha(core) };
}

export class LockError extends Error { constructor(public code: string, message: string) { super(message); } }

/**
 * Second lock. Even if a caller (or a model) asks to execute, the server only proceeds when a recorded shop
 * approval matches the settlement as it is computed now, and the requested amount equals that settlement.
 */
export function assertExecutable(order: Order, approvalId: string, requestedTotalCents: number): { settlement: Settlement; approval: Approval } {
  if (order.status !== "HELD") throw new LockError("NOT_HELD", `Order is ${order.status}; nothing to settle.`);
  const settlement = computeSettlement(order);
  if (!settlement.ready) throw new LockError("NOT_READY", settlement.blockers[0]);
  const approval = order.approvals.find((a) => a.id === approvalId);
  if (!approval) throw new LockError("NO_APPROVAL", "No shop approval is recorded for this settlement.");
  if (approval.settlementHash !== settlement.hash) throw new LockError("APPROVAL_STALE", "The order changed after it was approved. Approve again.");
  if (approval.totalCents !== settlement.totalCents || requestedTotalCents !== settlement.totalCents) throw new LockError("AMOUNT_MISMATCH", "Requested amount differs from the approved settlement.");
  if (settlement.totalCents > settlement.authorizedCents) throw new LockError("OVER_AUTH", "Amount exceeds the authorization.");
  return { settlement, approval };
}
