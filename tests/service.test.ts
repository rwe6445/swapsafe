import { beforeEach, describe, expect, it } from "vitest";
import { approveSettlement, authorizeOrder, createOrder, executeSettlement, pickLine, proposeSwap, recordConsent, refundIssue, reportIssue, applyWebhook, ServiceError } from "@/lib/service";
import { getStore } from "@/lib/store";
import type { PayPalGateway } from "@/lib/paypal";

/** Test double that behaves like PayPal for idempotency: the same PayPal-Request-Id returns the same result once. */
function fakeGateway() {
  const calls: string[] = []; const seen = new Map<string, unknown>(); let n = Math.floor(Math.random() * 1e9);
  const once = <T>(requestId: string, name: string, make: () => T): T => { if (seen.has(requestId)) return seen.get(requestId) as T; calls.push(name); const v = make(); seen.set(requestId, v); return v; };
  let authorized = 0;
  const gw: PayPalGateway = {
    async createAuthorizeOrder(i) { authorized = i.totalCents; return once(i.requestId, "create", () => ({ orderId: `ORD${++n}` })); },
    async authorizeOrder(_o, r) { return once(r, "authorize", () => ({ authorizationId: `AUTH${++n}`, amountCents: authorized, status: "CREATED" })); },
    async capture(_a, cents, r) { return once(r, `capture:${cents}`, () => ({ captureId: `CAP${++n}`, status: "COMPLETED" })); },
    async voidAuthorization(_a, r) { return once(r, "void", () => ({ status: "VOIDED" })); },
    async refund(_c, cents, r) { return once(r, `refund:${cents}`, () => ({ refundId: `REF${++n}`, status: "COMPLETED", via: "rest" as const })); },
    async getAuthorization() { return { status: "CREATED", amountCents: authorized }; },
  };
  return { gw, calls };
}
const png = () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const errCode = async (p: Promise<unknown>) => { try { await p; return "none"; } catch (e) { return e instanceof ServiceError ? e.code : String(e); } };

describe("order flow against a fake gateway (no AI key: rules pipeline)", () => {
  const store = getStore();
  let f: ReturnType<typeof fakeGateway>; let id: string; let token: string;
  beforeEach(async () => {
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY; f = fakeGateway();
    const c = await createOrder(store, f.gw, { shopperName: "Sam", prefs: { avoidAllergens: ["peanuts"] }, items: [{ sku: "pasta-penne-500", qty: 2 }, { sku: "oat-milk-1l", qty: 1 }, { sku: "nope", qty: 1 }] });
    id = c.id; token = c.shopperToken; expect(c.totalCents).toBe(2 * 189 + 399);
    await authorizeOrder(store, f.gw, id);
  });

  it("holds first, then captures only what was picked and agreed, once", async () => {
    await pickLine(store, id, "l1", "picked"); await pickLine(store, id, "l2", "out_of_stock");
    const { result: sub } = await proposeSwap(store, id, "l2", "soy-milk-1l", { bytes: png(), url: "/labels/soy-milk-1l.png" });
    expect(sub.status).toBe("blocked"); // no AI key and no cached reading for this test image: no evidence, no offer
    expect(sub.decision.reasons.map((r) => r.code)).toContain("NO_LABEL_EVIDENCE");
    const { result: ap } = await approveSettlement(store, id, "owner");
    expect(ap.totalCents).toBe(378);
    await executeSettlement(store, f.gw, id, ap.id, 378);
    await executeSettlement(store, f.gw, id, ap.id, 378); // retry
    expect(f.calls.filter((c) => c.startsWith("capture"))).toEqual(["capture:378"]);
    const o = (await store.getOrder(id))!.order; expect(o.status).toBe("SETTLED"); expect(o.paypal.capturedCents).toBe(378);
  });

  it("refuses to execute without approval, with a changed amount, or after the order changed", async () => {
    await pickLine(store, id, "l1", "picked"); await pickLine(store, id, "l2", "picked");
    expect(await errCode(executeSettlement(store, f.gw, id, "ap_missing", 777))).toBe("NO_APPROVAL");
    const { result: ap } = await approveSettlement(store, id, "owner");
    expect(await errCode(executeSettlement(store, f.gw, id, ap.id, ap.totalCents - 1))).toBe("AMOUNT_MISMATCH");
    await pickLine(store, id, "l2", "out_of_stock"); // change after approval clears approvals
    expect(await errCode(executeSettlement(store, f.gw, id, ap.id, ap.totalCents))).toBe("NO_APPROVAL");
    expect(f.calls.some((c) => c.startsWith("capture"))).toBe(false);
    const o = (await store.getOrder(id))!.order; expect(o.ledger.filter((l) => l.type.startsWith("SETTLEMENT_REFUSED")).length).toBe(3);
  });

  it("voids when nothing could be fulfilled", async () => {
    await pickLine(store, id, "l1", "out_of_stock"); await pickLine(store, id, "l2", "out_of_stock");
    const { result: ap } = await approveSettlement(store, id, "owner");
    await executeSettlement(store, f.gw, id, ap.id, 0);
    expect(f.calls).toContain("void"); expect((await store.getOrder(id))!.order.status).toBe("VOIDED");
  });

  it("only the shopper's link can answer a swap, and photos must be real images", async () => {
    await pickLine(store, id, "l2", "out_of_stock");
    expect(await errCode(proposeSwap(store, id, "l2", "soy-milk-1l", { bytes: new Uint8Array([1, 2, 3]), url: "x" }))).toBe("PHOTO_TYPE");
    await proposeSwap(store, id, "l2", "soy-milk-1l", { bytes: png(), url: "x" });
    expect(await errCode(recordConsent(store, id, "wrong-token", "l2", "accepted"))).toBe("FORBIDDEN");
    expect(await errCode(recordConsent(store, id, token, "l2", "accepted"))).toBe("NO_PROPOSAL"); // blocked swaps cannot be accepted
  });

  it("refunds a reported line once and never above the capture", async () => {
    await pickLine(store, id, "l1", "picked"); await pickLine(store, id, "l2", "picked");
    const { result: ap } = await approveSettlement(store, id, "owner"); await executeSettlement(store, f.gw, id, ap.id, ap.totalCents);
    await reportIssue(store, id, token, "l2", "carton arrived leaking");
    const issue = (await store.getOrder(id))!.order.issues[0]; expect(issue.cents).toBe(399);
    await refundIssue(store, f.gw, id, issue.id, "owner"); await refundIssue(store, f.gw, id, issue.id, "owner");
    expect(f.calls.filter((c) => c.startsWith("refund"))).toEqual(["refund:399"]);
    expect(await errCode(reportIssue(store, id, token, "l2", "again"))).toBe("ALREADY_REPORTED");
  });

  it("stores a webhook once and attaches its verification result to the order", async () => {
    const o = (await store.getOrder(id))!.order;
    const ev = { id: "WH-1", event_type: "PAYMENT.AUTHORIZATION.CREATED", resource: { id: o.paypal.authorizationId } };
    expect((await applyWebhook(store, ev, "SUCCESS")).fresh).toBe(true);
    expect((await applyWebhook(store, ev, "SUCCESS")).fresh).toBe(false);
    const after = (await store.getOrder(id))!.order; expect(after.ledger.filter((l) => l.type.startsWith("WEBHOOK")).length).toBe(1);
    expect(after.ledger.find((l) => l.type.startsWith("WEBHOOK"))!.verified).toBe("SUCCESS");
  });
});
