import { randomBytes } from "node:crypto";
import { getStore } from "@/lib/store";
import { publicBaseUrl, restGateway, type PayPalGateway } from "@/lib/paypal";
import { toolkitRefund } from "@/lib/toolkit";
import { approveSettlement, authorizeOrder, executeSettlement, pickLine, proposeSwap, recordConsent, refundIssue, reportIssue, ServiceError } from "@/lib/service";
import { computeSettlement } from "@/lib/settlement";
import { bySku, sameCategory } from "@/lib/catalog";
import { MAX_PHOTO_BYTES, MAX_PHOTOS_PER_ORDER, rateLimit, sniffImage } from "@/lib/guard";
import { fail } from "@/lib/http";
import type { Order } from "@/lib/types";
import { readShop, safeEqual, sameOrigin } from "@/lib/session";

const SHOP_ONLY = new Set(["pick", "swap", "approve", "execute", "refund"]);
const forbidden = (message: string) => Response.json({ error: "FORBIDDEN", message }, { status: 403 });
const ownsShop = (req: Request, order: Order) => { const shop = readShop(req); return !!shop && !!order.shop && safeEqual(shop, order.shop); };

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refunds go through the PayPal Agent Toolkit's create_refund; plain REST is the fallback, and the ledger says which ran. */
const gateway: PayPalGateway = {
  ...restGateway,
  async refund(captureId, cents, requestId, note) {
    try { const r = await toolkitRefund(captureId, cents, note, requestId); return { ...r, via: "agent-toolkit" }; }
    catch (e) { console.error("toolkit refund failed, using REST", e instanceof Error ? e.message : e); return restGateway.refund(captureId, cents, requestId, note); }
  },
};

function view(order: Order, role: "shop" | "shopper") {
  const settlement = computeSettlement(order);
  const candidates = Object.fromEntries(order.lines.map((l) => [l.id, sameCategory(l.sku).map((p) => ({ sku: p.sku, name: `${p.brand} ${p.name}`, size: p.size, priceCents: p.priceCents, labelImage: p.labelImage }))]));
  if (role === "shop") return { role, order, settlement, candidates };
  // The shopper sees results, evidence and PayPal ids, not the agent's internals or the shop's approval records.
  const { timeline: _t, approvals: _a, shopperToken: _s, ...rest } = order;
  return { role, order: rest, settlement };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params; const token = new URL(req.url).searchParams.get("t");
    const cur = await getStore().getOrder(id);
    if (!cur) return Response.json({ error: "ORDER_NOT_FOUND", message: "No such order." }, { status: 404 });
    if (token !== null) return safeEqual(token, cur.order.shopperToken) ? Response.json(view(cur.order, "shopper")) : forbidden("This link is not valid for this order.");
    if (!ownsShop(req, cur.order)) return forbidden("This order belongs to another visitor's demo shop.");
    return Response.json(view(cur.order, "shop"));
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "action", 40); if (limited) return limited;
  if (!sameOrigin(req)) return Response.json({ error: "CROSS_ORIGIN", message: "This request did not come from the SwapSafe site." }, { status: 403 });
  try {
    const { id } = await ctx.params; const store = getStore();
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData() : null;
    const body = (form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await req.json().catch(() => ({}))) as Record<string, string>;
    // Who may do what: shop actions need the shop that created the order; shopper actions need the shopper's link.
    const target = await store.getOrder(id);
    if (!target) throw new ServiceError("ORDER_NOT_FOUND", "No such order.", 404);
    const isShop = ownsShop(req, target.order), isShopper = !!body.token && safeEqual(body.token, target.order.shopperToken);
    if (SHOP_ONLY.has(body.action) && !isShop) return forbidden("Only the shop that received this order can do that.");
    if (body.action === "authorize" && !isShop && !isShopper) return forbidden("Only the shopper who started this order can place its hold.");
    let order: Order;
    switch (body.action) {
      case "authorize": ({ order } = await authorizeOrder(store, gateway, id)); break;
      case "pick": {
        if (!["picked", "out_of_stock", "pending"].includes(body.status)) throw new ServiceError("BAD_STATUS", "Unknown line status.");
        ({ order } = await pickLine(store, id, body.lineId, body.status as "picked")); break;
      }
      case "swap": {
        const aiLimited = rateLimit(req, "swap", 6); if (aiLimited) return aiLimited;
        // Durable per-visitor daily budget for model calls, so one visitor cannot use up the shared daily cap.
        const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
        if ((await store.bumpCounter(`swap:${new Date().toISOString().slice(0, 10)}:${ip}`)) > 60) throw new ServiceError("DAILY_LIMIT", "This visitor has reached today's limit for label checks. Try again tomorrow.", 429);
        const product = bySku(body.sku);
        if (!product) throw new ServiceError("UNKNOWN_SKU", "That product is not in the shop's catalog.");
        // Validate the order and line before anything is stored.
        const before = await store.getOrder(id);
        if (!before) throw new ServiceError("ORDER_NOT_FOUND", "No such order.", 404);
        if (before.order.status !== "HELD" || before.order.lines.find((l) => l.id === body.lineId)?.status !== "out_of_stock") throw new ServiceError("NOT_OUT_OF_STOCK", "Mark the line out of stock before proposing a swap.", 409);
        let photo: { bytes: Uint8Array; url: string; uploaded?: boolean } | null = null;
        const file = form?.get("photo");
        if (file instanceof File && file.size > 0) {
          if (file.size > MAX_PHOTO_BYTES) throw new ServiceError("PHOTO_TOO_LARGE", "Photos can be up to 2 MB.", 413);
          if ((before.order.photoCount ?? 0) >= MAX_PHOTOS_PER_ORDER) throw new ServiceError("PHOTO_LIMIT", `An order can hold up to ${MAX_PHOTOS_PER_ORDER} uploaded photos.`, 429);
          const bytes = new Uint8Array(await file.arrayBuffer()); const mediaType = sniffImage(bytes);
          if (!mediaType) throw new ServiceError("PHOTO_TYPE", "Upload a JPEG, PNG or WebP photo.", 415);
          const photoId = `up_${randomBytes(8).toString("hex")}`;
          await store.putPhoto(photoId, mediaType, bytes);
          photo = { bytes, url: `/api/photos/${photoId}`, uploaded: true };
        } else if (body.sample === "1") {
          const res = await fetch(new URL(product.labelImage, publicBaseUrl() ?? req.url), { cache: "force-cache" }); // configured origin first, not the request's Host
          if (res.ok) photo = { bytes: new Uint8Array(await res.arrayBuffer()), url: product.labelImage };
        }
        ({ order } = await proposeSwap(store, id, body.lineId, body.sku, photo)); break;
      }
      case "consent": {
        if (body.decision !== "accepted" && body.decision !== "declined") throw new ServiceError("BAD_DECISION", "Answer accepted or declined.");
        ({ order } = await recordConsent(store, id, body.token, body.lineId, body.decision, body.proposalHash ?? "")); break;
      }
      case "approve": ({ order } = await approveSettlement(store, id, body.by ?? "shop", body.hash)); break;
      case "execute": ({ order } = await executeSettlement(store, gateway, id, body.approvalId, Number(body.totalCents))); break;
      case "report": ({ order } = await reportIssue(store, id, body.token, body.lineId, body.note ?? "")); break;
      case "refund": ({ order } = await refundIssue(store, gateway, id, body.issueId, body.by ?? "shop")); break;
      default: throw new ServiceError("UNKNOWN_ACTION", "Unknown action.");
    }
    return Response.json(view(order, SHOP_ONLY.has(body.action) || (isShop && !body.token) ? "shop" : "shopper"));
  } catch (e) { return fail(e); }
}
