import { getStore } from "@/lib/store";
import { ensureWebhook, paypalConfigured, restGateway } from "@/lib/paypal";
import { aiConfigured } from "@/lib/ai";
import { rateLimit } from "@/lib/guard";

let cached: { at: number; db: boolean; paypal: boolean; webhook: boolean } | null = null;

export const dynamic = "force-dynamic";

/** Booleans only. The PayPal client id is a public value that the browser SDK needs. */
export async function GET(req: Request) {
  const limited = rateLimit(req, "health", 60); if (limited) return limited;
  const store = getStore();
  let db = false, paypal = false;
  if (cached && Date.now() - cached.at < 30_000) return answer(store.kind, cached.db, cached.paypal, cached.webhook);
  try { await store.listWebhooks(1); db = true; } catch { db = false; }
  if (paypalConfigured()) { try { await restGateway.getAuthorization("0"); paypal = true; } catch (e) { paypal = (e as { name?: string }).name !== "TOKEN_FAILED" && (e as { name?: string }).name !== "NOT_CONFIGURED"; } }
  const webhook = paypal ? await ensureWebhook().catch(() => null) : null;
  cached = { at: Date.now(), db, paypal, webhook: !!webhook };
  return answer(store.kind, db, paypal, !!webhook);
}

function answer(kind: string, db: boolean, paypal: boolean, webhook: boolean) {
  const ok = db && paypal;
  return Response.json({ ok, db, store: kind, paypal, paypalEnv: "sandbox", webhookConfigured: webhook, ai: aiConfigured(),
    paypalClientId: process.env.PAYPAL_CLIENT_ID ?? process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? null }, { status: ok ? 200 : 503 });
}
