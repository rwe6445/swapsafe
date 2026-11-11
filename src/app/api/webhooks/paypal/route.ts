import { getStore } from "@/lib/store";
import { verifyWebhook } from "@/lib/paypal";
import { applyWebhook } from "@/lib/service";
import { rateLimit } from "@/lib/guard";

export const dynamic = "force-dynamic";

/** PayPal calls this. The raw body is verified with PayPal before anything is recorded as verified. */
export async function POST(req: Request) {
  const limited = rateLimit(req, "webhook", 120); if (limited) return limited;
  const raw = await req.text();
  if (raw.length > 200_000) return new Response("Too large", { status: 413 });
  let event: { id?: string; event_type?: string; resource?: { id?: string } };
  try { event = JSON.parse(raw); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (typeof event.id !== "string" || typeof event.event_type !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(event.id) || !/^[A-Z_.-]{3,64}$/.test(event.event_type)) return new Response("Not a PayPal event", { status: 400 });
  const { status } = await verifyWebhook(req.headers, raw);
  if (status === "ERROR") return new Response("Verification unavailable, send again", { status: 503 });
  if (status === "FAILURE") return Response.json({ received: true, verification_status: status }); // not stored: anyone can POST here
  try { await applyWebhook(getStore(), { id: event.id, event_type: event.event_type, resource: event.resource }, status); }
  catch (e) { console.error("webhook store failed", e instanceof Error ? e.message : e); return new Response("Try again", { status: 500 }); }
  return Response.json({ received: true, verification_status: status });
}
