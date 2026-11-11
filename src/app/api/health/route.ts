import { getStore } from "@/lib/store";
import { ensureWebhook, paypalConfigured, restGateway } from "@/lib/paypal";
import { aiConfigured } from "@/lib/ai";

export const dynamic = "force-dynamic";

/** Booleans only. The PayPal client id is a public value that the browser SDK needs. */
export async function GET() {
  const store = getStore();
  let db = false, paypal = false;
  try { await store.listWebhooks(1); db = true; } catch { db = false; }
  if (paypalConfigured()) { try { await restGateway.getAuthorization("0"); paypal = true; } catch (e) { paypal = (e as { name?: string }).name !== "TOKEN_FAILED" && (e as { name?: string }).name !== "NOT_CONFIGURED"; } }
  const webhook = paypal ? await ensureWebhook().catch(() => null) : null;
  const ok = db && paypal;
  return Response.json({ ok, db, store: store.kind, paypal, paypalEnv: "sandbox", webhookConfigured: !!webhook, ai: aiConfigured(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? null }, { status: ok ? 200 : 503 });
}
