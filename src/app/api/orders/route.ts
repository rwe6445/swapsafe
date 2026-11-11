import { getStore } from "@/lib/store";
import { ensureWebhook, restGateway } from "@/lib/paypal";
import { createOrder } from "@/lib/service";
import { computeSettlement } from "@/lib/settlement";
import { rateLimit } from "@/lib/guard";
import { fail } from "@/lib/http";
import { ensureShop, sameOrigin, withCookie } from "@/lib/session";

export const dynamic = "force-dynamic";

/** The shop dashboard: only the orders of the visitor's own demo shop. */
export async function GET(req: Request) {
  try {
    const store = getStore(); const { shop, setCookie } = ensureShop(req);
    const [orders, webhooks] = await Promise.all([store.listOrders(30, shop), store.listWebhooks(15, shop)]);
    return withCookie(Response.json({
      orders: orders.map((o) => ({ id: o.id, createdAt: o.createdAt, shopperName: o.shopperName, status: o.status, lines: o.lines.length,
        authorizedCents: o.paypal.authorizedCents ?? 0, capturedCents: o.paypal.capturedCents ?? null,
        waiting: o.lines.filter((l) => l.substitution?.status === "proposed").length, total: computeSettlement(o).totalCents })),
      webhooks, store: store.kind,
    }), setCookie);
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "create", 8); if (limited) return limited;
  if (!sameOrigin(req)) return Response.json({ error: "CROSS_ORIGIN", message: "This request did not come from the SwapSafe site." }, { status: 403 });
  try {
    const { shop, setCookie } = ensureShop(req);
    const body = await req.json().catch(() => ({}));
    await ensureWebhook().catch(() => null); // so the first hold already produces a verifiable event
    return withCookie(Response.json(await createOrder(getStore(), restGateway, body, shop), { status: 201 }), setCookie);
  } catch (e) { return fail(e); }
}
