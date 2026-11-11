import { getStore } from "@/lib/store";
import { restGateway } from "@/lib/paypal";
import { createOrder } from "@/lib/service";
import { computeSettlement } from "@/lib/settlement";
import { rateLimit } from "@/lib/guard";
import { fail } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const store = getStore();
    const [orders, webhooks] = await Promise.all([store.listOrders(30), store.listWebhooks(15)]);
    return Response.json({
      orders: orders.map((o) => ({ id: o.id, createdAt: o.createdAt, shopperName: o.shopperName, status: o.status, lines: o.lines.length,
        authorizedCents: o.paypal.authorizedCents ?? 0, capturedCents: o.paypal.capturedCents ?? null,
        waiting: o.lines.filter((l) => l.substitution?.status === "proposed").length, total: computeSettlement(o).totalCents })),
      webhooks, store: store.kind,
    });
  } catch (e) { return fail(e); }
}

export async function POST(req: Request) {
  const limited = rateLimit(req, "create", 8); if (limited) return limited;
  try {
    const body = await req.json().catch(() => ({}));
    return Response.json(await createOrder(getStore(), restGateway, body), { status: 201 });
  } catch (e) { return fail(e); }
}
