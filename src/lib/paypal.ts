import { toCents, toValue } from "./policy";

const SANDBOX_API = "https://api-m.sandbox.paypal.com";

/** Start-up guard: this project never talks to live PayPal. */
export function paypalBase(): string {
  if ((process.env.PAYPAL_ENV ?? "sandbox") !== "sandbox") throw new Error("SwapSafe runs against the PayPal sandbox only. Set PAYPAL_ENV=sandbox.");
  return SANDBOX_API;
}
export const paypalConfigured = () => !!(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

export class PayPalError extends Error {
  constructor(public status: number, public name: string, public debugId: string | undefined, message: string) { super(message); }
}

let token: { value: string; exp: number } | null = null;
async function accessToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const id = process.env.PAYPAL_CLIENT_ID, secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new PayPalError(503, "NOT_CONFIGURED", undefined, "PayPal sandbox credentials are not configured on this deployment.");
  const res = await fetch(`${paypalBase()}/v1/oauth2/token`, {
    method: "POST", body: "grant_type=client_credentials", cache: "no-store",
    headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) throw new PayPalError(res.status, "TOKEN_FAILED", res.headers.get("paypal-debug-id") ?? undefined, json.error_description ?? "Could not get a PayPal access token.");
  token = { value: json.access_token, exp: Date.now() + (json.expires_in ?? 300) * 1000 };
  return token.value;
}

export interface Call<T> { data: T; debugId?: string; status: number }
async function call<T>(method: "GET" | "POST", path: string, body?: unknown, requestId?: string, rawBody?: string): Promise<Call<T>> {
  const res = await fetch(`${paypalBase()}${path}`, {
    method, cache: "no-store",
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", Prefer: "return=representation", ...(requestId ? { "PayPal-Request-Id": requestId } : {}) },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const debugId = res.headers.get("paypal-debug-id") ?? undefined;
  const text = await res.text();
  const data = (text ? JSON.parse(text) : {}) as T & { name?: string; message?: string; details?: { issue?: string; description?: string }[] };
  if (!res.ok) throw new PayPalError(res.status, data.details?.[0]?.issue ?? data.name ?? "PAYPAL_ERROR", debugId, data.details?.[0]?.description ?? data.message ?? `PayPal answered ${res.status}`);
  return { data, debugId, status: res.status };
}

export interface PayPalGateway {
  createAuthorizeOrder(i: { ref: string; totalCents: number; items: { name: string; qty: number; unitCents: number }[]; requestId: string }): Promise<{ orderId: string; debugId?: string }>;
  authorizeOrder(orderId: string, requestId: string): Promise<{ authorizationId: string; amountCents: number; expiresAt?: string; status: string; debugId?: string }>;
  capture(authorizationId: string, cents: number, requestId: string, invoiceId: string): Promise<{ captureId: string; status: string; debugId?: string }>;
  voidAuthorization(authorizationId: string, requestId: string): Promise<{ status: string; debugId?: string }>;
  refund(captureId: string, cents: number, requestId: string, note: string): Promise<{ refundId: string; status: string; debugId?: string; via: "agent-toolkit" | "rest" }>;
  getAuthorization(authorizationId: string): Promise<{ status: string; amountCents: number }>;
}

type Money = { currency_code: string; value: string };
const usd = (cents: number): Money => ({ currency_code: "USD", value: toValue(cents) });

export const restGateway: PayPalGateway = {
  async createAuthorizeOrder({ ref, totalCents, items, requestId }) {
    const r = await call<{ id: string }>("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: ref, custom_id: ref, description: "Grocery basket, held until picked",
        amount: { ...usd(totalCents), breakdown: { item_total: usd(totalCents) } },
        items: items.map((i) => ({ name: i.name.slice(0, 127), quantity: String(i.qty), unit_amount: usd(i.unitCents), category: "PHYSICAL_GOODS" })),
      }],
    }, requestId);
    return { orderId: r.data.id, debugId: r.debugId };
  },
  async authorizeOrder(orderId, requestId) {
    const r = await call<{ purchase_units: { payments: { authorizations: { id: string; status: string; amount: Money; expiration_time?: string }[] } }[] }>("POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, requestId);
    const a = r.data.purchase_units[0].payments.authorizations[0];
    return { authorizationId: a.id, amountCents: toCents(a.amount.value), expiresAt: a.expiration_time, status: a.status, debugId: r.debugId };
  },
  async capture(authorizationId, cents, requestId, invoiceId) {
    const r = await call<{ id: string; status: string }>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`, { amount: usd(cents), final_capture: true, invoice_id: invoiceId.slice(0, 127) }, requestId);
    return { captureId: r.data.id, status: r.data.status, debugId: r.debugId };
  },
  async voidAuthorization(authorizationId, requestId) {
    const r = await call<{ status?: string }>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, requestId);
    return { status: r.data.status ?? "VOIDED", debugId: r.debugId };
  },
  async refund(captureId, cents, requestId, note) {
    const r = await call<{ id: string; status: string }>("POST", `/v2/payments/captures/${encodeURIComponent(captureId)}/refund`, { amount: usd(cents), note_to_payer: note.slice(0, 255) }, requestId);
    return { refundId: r.data.id, status: r.data.status, debugId: r.debugId, via: "rest" };
  },
  async getAuthorization(authorizationId) {
    const r = await call<{ status: string; amount: Money }>("GET", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}`);
    return { status: r.data.status, amountCents: toCents(r.data.amount.value) };
  },
};

/**
 * Verify a webhook with PayPal's verify-webhook-signature call. The event body is embedded byte-for-byte:
 * re-serialising it can change the bytes PayPal signed.
 */
export async function verifyWebhook(headers: Headers, rawBody: string): Promise<{ status: "SUCCESS" | "FAILURE"; debugId?: string }> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  const h = (k: string) => headers.get(k) ?? "";
  if (!webhookId || !h("paypal-transmission-id")) return { status: "FAILURE" };
  const envelope = JSON.stringify({
    auth_algo: h("paypal-auth-algo"), cert_url: h("paypal-cert-url"), transmission_id: h("paypal-transmission-id"),
    transmission_sig: h("paypal-transmission-sig"), transmission_time: h("paypal-transmission-time"), webhook_id: webhookId,
  });
  const body = `${envelope.slice(0, -1)},"webhook_event":${rawBody}}`;
  try {
    const r = await call<{ verification_status: string }>("POST", "/v1/notifications/verify-webhook-signature", undefined, undefined, body);
    return { status: r.data.verification_status === "SUCCESS" ? "SUCCESS" : "FAILURE", debugId: r.debugId };
  } catch { return { status: "FAILURE" }; }
}
