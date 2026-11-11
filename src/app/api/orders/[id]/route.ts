import { randomBytes } from "node:crypto";
import { getStore } from "@/lib/store";
import { restGateway, type PayPalGateway } from "@/lib/paypal";
import { toolkitRefund } from "@/lib/toolkit";
import { approveSettlement, authorizeOrder, executeSettlement, pickLine, proposeSwap, recordConsent, refundIssue, reportIssue, ServiceError } from "@/lib/service";
import { computeSettlement } from "@/lib/settlement";
import { bySku, sameCategory } from "@/lib/catalog";
import { MAX_PHOTO_BYTES, rateLimit, sniffImage } from "@/lib/guard";
import { fail } from "@/lib/http";
import type { Order } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Refunds go through the PayPal Agent Toolkit's create_refund; plain REST is the fallback, and the ledger says which ran. */
const gateway: PayPalGateway = {
  ...restGateway,
  async refund(captureId, cents, requestId, note) {
    try { const r = await toolkitRefund(captureId, cents, note); return { ...r, via: "agent-toolkit" }; }
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
    if (token !== null && token !== cur.order.shopperToken) return Response.json({ error: "FORBIDDEN", message: "This link is not valid for this order." }, { status: 403 });
    return Response.json(view(cur.order, token ? "shopper" : "shop"));
  } catch (e) { return fail(e); }
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(req, "action", 40); if (limited) return limited;
  try {
    const { id } = await ctx.params; const store = getStore();
    const isForm = (req.headers.get("content-type") ?? "").includes("multipart/form-data");
    const form = isForm ? await req.formData() : null;
    const body = (form ? Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")) : await req.json().catch(() => ({}))) as Record<string, string>;
    const role: "shop" | "shopper" = body.token ? "shopper" : "shop";
    let order: Order;
    switch (body.action) {
      case "authorize": ({ order } = await authorizeOrder(store, gateway, id)); break;
      case "pick": {
        if (!["picked", "out_of_stock", "pending"].includes(body.status)) throw new ServiceError("BAD_STATUS", "Unknown line status.");
        ({ order } = await pickLine(store, id, body.lineId, body.status as "picked")); break;
      }
      case "swap": {
        const aiLimited = rateLimit(req, "swap", 6); if (aiLimited) return aiLimited;
        const product = bySku(body.sku);
        if (!product) throw new ServiceError("UNKNOWN_SKU", "That product is not in the shop's catalog.");
        let photo: { bytes: Uint8Array; url: string } | null = null;
        const file = form?.get("photo");
        if (file instanceof File && file.size > 0) {
          if (file.size > MAX_PHOTO_BYTES) throw new ServiceError("PHOTO_TOO_LARGE", "Photos can be up to 5 MB.", 413);
          const bytes = new Uint8Array(await file.arrayBuffer()); const mediaType = sniffImage(bytes);
          if (!mediaType) throw new ServiceError("PHOTO_TYPE", "Upload a JPEG, PNG or WebP photo.", 415);
          const photoId = `up_${randomBytes(8).toString("hex")}`;
          await store.putPhoto(photoId, mediaType, bytes);
          photo = { bytes, url: `/api/photos/${photoId}` };
        } else if (body.sample === "1") {
          const res = await fetch(new URL(product.labelImage, req.url), { cache: "force-cache" });
          if (res.ok) photo = { bytes: new Uint8Array(await res.arrayBuffer()), url: product.labelImage };
        }
        ({ order } = await proposeSwap(store, id, body.lineId, body.sku, photo)); break;
      }
      case "consent": {
        if (body.decision !== "accepted" && body.decision !== "declined") throw new ServiceError("BAD_DECISION", "Answer accepted or declined.");
        ({ order } = await recordConsent(store, id, body.token, body.lineId, body.decision)); break;
      }
      case "approve": ({ order } = await approveSettlement(store, id, body.by ?? "shop")); break;
      case "execute": ({ order } = await executeSettlement(store, gateway, id, body.approvalId, Number(body.totalCents))); break;
      case "report": ({ order } = await reportIssue(store, id, body.token, body.lineId, body.note ?? "")); break;
      case "refund": ({ order } = await refundIssue(store, gateway, id, body.issueId, body.by ?? "shop")); break;
      default: throw new ServiceError("UNKNOWN_ACTION", "Unknown action.");
    }
    return Response.json(view(order, role));
  } catch (e) { return fail(e); }
}
