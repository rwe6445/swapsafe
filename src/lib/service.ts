import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Order, OrderLine, Prefs, Substitution } from "./types";
import { ALLERGENS, DIETS } from "./types";
import { bySku, SHOP_NAME } from "./catalog";
import { fmt } from "./policy";
import { assertExecutable, computeSettlement, LockError, proposalHash } from "./settlement";
import type { PayPalGateway } from "./paypal";
import { mutateOrder, type Store } from "./store";
import { runSwapAgent } from "./agent";
import { MAX_PHOTO_BYTES, sniffImage } from "./guard";

export class ServiceError extends Error { constructor(public code: string, message: string, public http = 400) { super(message); } }
const now = () => new Date().toISOString();
const short = () => randomBytes(5).toString("hex");
const ledger = (o: Order, type: string, extra: Partial<Order["ledger"][number]> = {}) => o.ledger.push({ id: short(), at: now(), type, verified: "n/a", ...extra });
const mustLine = (o: Order, lineId: string): OrderLine => { const l = o.lines.find((x) => x.id === lineId); if (!l) throw new ServiceError("LINE_NOT_FOUND", "No such line on this order.", 404); return l; };
const mustHeld = (o: Order) => { if (o.status !== "HELD") throw new ServiceError("NOT_HELD", `This order is ${o.status.toLowerCase()}; it can no longer be changed.`, 409); };

export function parsePrefs(raw: unknown): Prefs {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = <T extends string>(v: unknown, allowed: readonly T[]) => (Array.isArray(v) ? v.filter((x): x is T => (allowed as readonly string[]).includes(x as string)) : []);
  const diet = list([r.diet], DIETS)[0] ?? null;
  return { avoidAllergens: [...new Set(list(r.avoidAllergens, ALLERGENS))], diet, allowSubstitutions: r.allowSubstitutions !== false };
}

/** Step 1: build the basket from catalog prices (the browser never sends prices) and create an AUTHORIZE order. */
export async function createOrder(store: Store, gw: PayPalGateway, input: { shopperName: string; prefs: unknown; items: { sku: string; qty: number }[] }) {
  const items = (Array.isArray(input.items) ? input.items : []).slice(0, 20);
  const lines: OrderLine[] = items.flatMap((it, i) => {
    const p = bySku(String(it.sku)); const qty = Math.floor(Number(it.qty));
    return p && qty >= 1 && qty <= 10 ? [{ id: `l${i + 1}`, sku: p.sku, name: p.name, size: p.size, qty, unitPriceCents: p.priceCents, status: "pending" as const }] : [];
  });
  if (!lines.length) throw new ServiceError("EMPTY_BASKET", "Add at least one item to the basket.");
  const order: Order = {
    id: `ss_${short()}`, createdAt: now(), shopName: SHOP_NAME, shopperName: String(input.shopperName || "Sandbox shopper").slice(0, 60), shopperToken: randomBytes(16).toString("hex"),
    prefs: parsePrefs(input.prefs), lines, status: "DRAFT", currency: "USD", paypal: { refunds: [] }, approvals: [], timeline: [], ledger: [], issues: [],
  };
  const totalCents = lines.reduce((a, l) => a + l.qty * l.unitPriceCents, 0);
  const created = await gw.createAuthorizeOrder({ ref: order.id, totalCents, requestId: `ss-create-${order.id}`, items: lines.map((l) => ({ name: l.name, qty: l.qty, unitCents: l.unitPriceCents })) });
  order.paypal.orderId = created.orderId;
  ledger(order, "ORDER_CREATED (intent AUTHORIZE)", { paypalId: created.orderId, debugId: created.debugId, amountCents: totalCents });
  await store.insertOrder(order);
  return { id: order.id, paypalOrderId: created.orderId, shopperToken: order.shopperToken, totalCents };
}

/** Step 2: after the shopper approves in PayPal, place the hold. Nothing is charged. */
export async function authorizeOrder(store: Store, gw: PayPalGateway, id: string) {
  return mutateOrder(store, id, async (o) => {
    if (o.status !== "DRAFT") return;
    const a = await gw.authorizeOrder(o.paypal.orderId!, `ss-auth-${o.id}`);
    o.paypal.authorizationId = a.authorizationId; o.paypal.authorizedCents = a.amountCents; o.paypal.authExpiresAt = a.expiresAt; o.status = "HELD";
    ledger(o, "AUTHORIZATION_CREATED (hold placed, nothing charged)", { paypalId: a.authorizationId, debugId: a.debugId, amountCents: a.amountCents });
  });
}

export async function pickLine(store: Store, id: string, lineId: string, status: "picked" | "out_of_stock" | "pending") {
  return mutateOrder(store, id, (o) => { mustHeld(o); const l = mustLine(o, lineId); l.status = status; if (status !== "out_of_stock") delete l.substitution; o.approvals = []; });
}

export interface PhotoInput { bytes: Uint8Array; url: string }
/** Step 3: the picker proposes a substitute with a label photo. The agent gathers evidence; rules decide. */
export async function proposeSwap(store: Store, id: string, lineId: string, substituteSku: string, photo: PhotoInput | null) {
  const substitute = bySku(substituteSku);
  if (!substitute) throw new ServiceError("UNKNOWN_SKU", "That product is not in the shop's catalog.");
  let photoRec: { bytes: Uint8Array; mediaType: string; sha256: string; url: string; id: string } | null = null;
  if (photo) {
    if (photo.bytes.byteLength > MAX_PHOTO_BYTES) throw new ServiceError("PHOTO_TOO_LARGE", "Photos can be up to 5 MB.", 413);
    const mediaType = sniffImage(photo.bytes);
    if (!mediaType) throw new ServiceError("PHOTO_TYPE", "Upload a JPEG, PNG or WebP photo.", 415);
    photoRec = { bytes: photo.bytes, mediaType, sha256: createHash("sha256").update(photo.bytes).digest("hex"), url: photo.url, id: `ph_${short()}` };
  }
  const cur = await store.getOrder(id);
  if (!cur) throw new ServiceError("ORDER_NOT_FOUND", "No such order.", 404);
  mustHeld(cur.order);
  const line0 = mustLine(cur.order, lineId);
  if (line0.status !== "out_of_stock") throw new ServiceError("NOT_OUT_OF_STOCK", "Mark the line out of stock before proposing a swap.", 409);
  const original = bySku(line0.sku)!;
  const result = await runSwapAgent({ line: line0, original, substitute, prefs: cur.order.prefs, photo: photoRec });
  return mutateOrder(store, id, (o) => {
    mustHeld(o); const l = mustLine(o, lineId);
    const photoMeta = photoRec ? { id: photoRec.id, url: photoRec.url, sha256: photoRec.sha256 } : null;
    const sub: Substitution = {
      id: `sw_${short()}`, sku: substitute.sku, name: `${substitute.brand} ${substitute.name}`, size: substitute.size, listPriceCents: substitute.priceCents,
      photo: photoMeta, reading: result.reading, decision: result.decision,
      proposalHash: proposalHash(l, { sku: substitute.sku, photo: photoMeta, chargeCentsPerUnit: result.decision.chargeCentsPerUnit }),
      status: result.decision.verdict === "offer" ? "proposed" : "blocked",
    };
    l.substitution = sub; o.approvals = [];
    o.timeline.push({ at: now(), tool: "swap", input: `${l.name} -> ${sub.name}`, output: `${result.mode}: ${result.note}`, ms: 0, kind: "note" }, ...result.steps);
    return sub;
  });
}

/** Step 4: the shopper answers each swap. The answer is bound to the exact proposal by its hash. */
export async function recordConsent(store: Store, id: string, token: string, lineId: string, decision: "accepted" | "declined") {
  return mutateOrder(store, id, (o) => {
    if (token !== o.shopperToken) throw new ServiceError("FORBIDDEN", "This link cannot answer for the shopper.", 403);
    mustHeld(o); const s = mustLine(o, lineId).substitution;
    if (!s || s.status === "blocked") throw new ServiceError("NO_PROPOSAL", "There is no open swap on this line.", 409);
    s.status = decision; s.consent = { decision, at: now(), proposalHash: s.proposalHash }; o.approvals = [];
    o.timeline.push({ at: now(), tool: "shopper_consent", input: s.name, output: `${decision}; bound to proposal ${s.proposalHash.slice(0, 10)}`, ms: 0, kind: "approval" });
  });
}

/** Step 5a: the shop approves the settlement as computed now. This record is what the second lock checks. */
export async function approveSettlement(store: Store, id: string, by: string) {
  return mutateOrder(store, id, (o) => {
    mustHeld(o); const s = computeSettlement(o);
    if (!s.ready) throw new ServiceError("NOT_READY", s.blockers[0], 409);
    const approval = { id: `ap_${short()}`, by: by.slice(0, 40) || "shop", at: now(), settlementHash: s.hash, totalCents: s.totalCents };
    o.approvals.push(approval);
    o.timeline.push({ at: now(), tool: "shop_approval", input: `${s.action} ${fmt(s.totalCents)}`, output: `approved by ${approval.by}; settlement ${s.hash.slice(0, 10)}`, ms: 0, kind: "approval" });
    return approval;
  });
}

/** Step 5b: money moves here and only here. One final capture (the rest of the hold is released) or a void. */
export async function executeSettlement(store: Store, gw: PayPalGateway, id: string, approvalId: string, requestedTotalCents: number) {
  try {
    return await mutateOrder(store, id, async (o) => {
      if (o.status === "SETTLED" || o.status === "VOIDED") return { already: true };
      const { settlement } = assertExecutable(o, approvalId, requestedTotalCents);
      const auth = o.paypal.authorizationId!;
      if (settlement.action === "capture") {
        const c = await gw.capture(auth, settlement.totalCents, `ss-settle-${o.id}`, o.id);
        o.paypal.captureId = c.captureId; o.paypal.capturedCents = settlement.totalCents; o.status = "SETTLED";
        ledger(o, "CAPTURE (final_capture=true, remainder released)", { paypalId: c.captureId, debugId: c.debugId, amountCents: settlement.totalCents, detail: `released ${fmt(settlement.releaseCents)}` });
      } else {
        const v = await gw.voidAuthorization(auth, `ss-void-${o.id}`);
        o.paypal.voided = true; o.paypal.capturedCents = 0; o.status = "VOIDED";
        ledger(o, "VOID (nothing was charged)", { paypalId: auth, debugId: v.debugId, amountCents: 0 });
      }
      return { already: false };
    });
  } catch (e) {
    if (!(e instanceof LockError)) throw e;
    // A refused attempt is part of the audit trail.
    await mutateOrder(store, id, (o) => { ledger(o, `SETTLEMENT_REFUSED (${e.code})`, { detail: e.message }); });
    throw new ServiceError(e.code, e.message, 409);
  }
}

/** After delivery: the shopper reports a problem with one charged line. The amount is that line's charge, set by code. */
export async function reportIssue(store: Store, id: string, token: string, lineId: string, noteText: string) {
  return mutateOrder(store, id, (o) => {
    if (token !== o.shopperToken) throw new ServiceError("FORBIDDEN", "This link cannot report for the shopper.", 403);
    if (o.status !== "SETTLED") throw new ServiceError("NOT_SETTLED", "Only a captured order can be refunded.", 409);
    const charged = computeSettlementSnapshot(o).find((l) => l.lineId === lineId);
    if (!charged || charged.chargeCents <= 0) throw new ServiceError("NOT_CHARGED", "That line was not charged.", 409);
    if (o.issues.some((i) => i.lineId === lineId && i.status !== "rejected")) throw new ServiceError("ALREADY_REPORTED", "This line already has a report.", 409);
    o.issues.push({ id: `is_${short()}`, lineId, note: String(noteText).slice(0, 300), cents: charged.chargeCents, status: "open", at: now() });
  });
}
const computeSettlementSnapshot = (o: Order) => computeSettlement({ ...o, status: "HELD" }).lines;

/** The shop approves a refund; the server caps it at what was captured and uses one idempotency key per issue. */
export async function refundIssue(store: Store, gw: PayPalGateway, id: string, issueId: string, by: string) {
  return mutateOrder(store, id, async (o) => {
    const issue = o.issues.find((i) => i.id === issueId);
    if (!issue) throw new ServiceError("ISSUE_NOT_FOUND", "No such report.", 404);
    if (issue.status === "refunded") return;
    const refunded = o.paypal.refunds.reduce((a, r) => a + r.cents, 0);
    if (!o.paypal.captureId || refunded + issue.cents > (o.paypal.capturedCents ?? 0)) throw new ServiceError("REFUND_OVER_CAPTURE", "Refunds cannot exceed what was captured.", 409);
    o.timeline.push({ at: now(), tool: "shop_approval", input: `refund ${fmt(issue.cents)}`, output: `approved by ${by.slice(0, 40) || "shop"} for report ${issue.id}`, ms: 0, kind: "approval" });
    const r = await gw.refund(o.paypal.captureId, issue.cents, `ss-refund-${issue.id}`, `SwapSafe refund: ${issue.note}`);
    o.paypal.refunds.push({ id: r.refundId, cents: issue.cents, reason: issue.note, at: now() }); issue.status = "refunded";
    ledger(o, `REFUND (via ${r.via})`, { paypalId: r.refundId, debugId: r.debugId, amountCents: issue.cents });
  });
}

/** Webhook: attach the verification result to the order it belongs to. Unverified events never change state. */
export async function applyWebhook(store: Store, ev: { id: string; event_type: string; resource?: { id?: string; supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } } } }, verified: "SUCCESS" | "FAILURE") {
  const resourceId = ev.resource?.id ?? "";
  const rel = ev.resource?.supplementary_data?.related_ids ?? {};
  let orderId: string | null = null;
  for (const pid of [resourceId, rel.authorization_id, rel.capture_id, rel.order_id]) { if (pid && (orderId = await store.findByPayPalId(pid))) break; }
  const fresh = await store.recordWebhook({ id: ev.id, eventType: ev.event_type, resourceId, verified, at: now(), orderId: orderId ?? undefined });
  if (fresh && orderId) await mutateOrder(store, orderId, (o) => { ledger(o, `WEBHOOK ${ev.event_type}`, { paypalId: resourceId, verified, detail: `event ${ev.id}` }); });
  return { fresh, orderId };
}

export { randomUUID };
