import { describe, expect, it } from "vitest";
import { assertExecutable, computeSettlement, LockError, proposalHash } from "@/lib/settlement";
import { decideSubstitution, EMPTY_READING } from "@/lib/policy";
import { bySku } from "@/lib/catalog";
import type { Order, Substitution } from "@/lib/types";
import { line, order, prefs } from "./helpers";

function withSwap(o: Order, lineId: string, sku: string, status: Substitution["status"]) {
  const l = o.lines.find((x) => x.id === lineId)!; l.status = "out_of_stock";
  const sub = bySku(sku)!; const photo = { id: "ph1", url: "/labels/x.svg", sha256: "abc" };
  const decision = decideSubstitution({ original: bySku(l.sku)!, substitute: sub, prefs: prefs(), reading: { ...EMPTY_READING, source: "ai" }, hasPhoto: true });
  const ph = proposalHash(l, { sku, photo, chargeCentsPerUnit: decision.chargeCentsPerUnit });
  l.substitution = { id: "s1", sku, name: sub.name, size: sub.size, listPriceCents: sub.priceCents, photo, reading: { ...EMPTY_READING, source: "ai" }, decision, proposalHash: ph, status,
    consent: status === "accepted" || status === "declined" ? { decision: status, at: "t", proposalHash: ph } : undefined };
  return o;
}
const approve = (o: Order) => { const s = computeSettlement(o); o.approvals.push({ id: "ap1", by: "shop", at: "t", settlementHash: s.hash, totalCents: s.totalCents }); return s; };
const code = (fn: () => unknown) => { try { fn(); return "none"; } catch (e) { return (e as LockError).code; } };

describe("settlement", () => {
  it("captures picked lines and the accepted swap at the lower price, never above the authorization", () => {
    const o = withSwap(order([line("l1", "pasta-penne-500", 2, "picked"), line("l2", "oat-milk-1l", 1)]), "l2", "almond-milk-1l", "accepted");
    const s = computeSettlement(o);
    expect(s.ready).toBe(true); expect(s.totalCents).toBe(2 * 189 + 399); expect(s.totalCents).toBeLessThanOrEqual(s.authorizedCents); expect(s.action).toBe("capture");
  });
  it("does not charge a declined swap and releases the difference", () => {
    const o = withSwap(order([line("l1", "pasta-penne-500", 1, "picked"), line("l2", "oat-milk-1l", 1)]), "l2", "soy-milk-1l", "declined");
    const s = computeSettlement(o); expect(s.totalCents).toBe(189); expect(s.releaseCents).toBe(399);
  });
  it("voids when nothing is fulfilled", () => {
    const o = order([line("l1", "oat-milk-1l", 1, "out_of_stock")]); expect(computeSettlement(o).action).toBe("void");
  });
  it("is not ready while a swap waits for the shopper", () => {
    const o = withSwap(order([line("l1", "oat-milk-1l", 1)]), "l1", "soy-milk-1l", "proposed"); expect(computeSettlement(o).ready).toBe(false);
  });
  it("rejects a swap that was changed after consent", () => {
    const o = withSwap(order([line("l1", "oat-milk-1l", 1)]), "l1", "soy-milk-1l", "accepted");
    o.lines[0].substitution!.sku = "almond-milk-1l";
    expect(computeSettlement(o).ready).toBe(false);
  });
});

describe("double lock", () => {
  const base = () => withSwap(order([line("l1", "pasta-penne-500", 1, "picked"), line("l2", "oat-milk-1l", 1)]), "l2", "soy-milk-1l", "accepted");
  it("refuses to execute without a recorded approval", () => { const o = base(); expect(code(() => assertExecutable(o, "ap1", computeSettlement(o).totalCents))).toBe("NO_APPROVAL"); });
  it("refuses an amount different from the approved settlement", () => { const o = base(); const s = approve(o); expect(code(() => assertExecutable(o, "ap1", s.totalCents + 100))).toBe("AMOUNT_MISMATCH"); });
  it("refuses when the order changed after approval", () => { const o = base(); approve(o); o.lines[0].status = "out_of_stock"; expect(code(() => assertExecutable(o, "ap1", 0))).toBe("APPROVAL_STALE"); });
  it("passes when approval, hash and amount agree", () => { const o = base(); const s = approve(o); expect(assertExecutable(o, "ap1", s.totalCents).settlement.hash).toBe(s.hash); });
  it("refuses once the order is no longer held", () => { const o = base(); const s = approve(o); o.status = "SETTLED"; expect(code(() => assertExecutable(o, "ap1", s.totalCents))).toBe("NOT_HELD"); });
});
