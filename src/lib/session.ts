import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Every visitor gets a private demo shop. The browser holds a signed, HttpOnly cookie; orders remember the shop that
 * created them; shop screens and shop actions work only for that shop. There is still no login (it is a demo), but one
 * visitor cannot see, settle or refund another visitor's orders.
 */
const COOKIE = "ss_shop";
const key = () => createHmac("sha256", process.env.PAYPAL_CLIENT_SECRET ?? "local-development-only").update("swapsafe-shop-cookie-v1").digest();
const sign = (id: string) => createHmac("sha256", key()).update(id).digest("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function readShop(req: Request): string | null {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  const [id, sig] = raw.split(".");
  return id && sig && /^[a-f0-9]{32}$/.test(id) && safeEqual(sig, sign(id)) ? id : null;
}

export function ensureShop(req: Request): { shop: string; setCookie: string | null } {
  const existing = readShop(req);
  if (existing) return { shop: existing, setCookie: null };
  const id = randomBytes(16).toString("hex");
  const secure = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  return { shop: id, setCookie: `${COOKIE}=${id}.${sign(id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3888000${secure ? "; Secure" : ""}` };
}

/** State-changing requests from a browser must come from this site (the cookie is SameSite=Lax as well). */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients send no Origin and carry no ambient cookie worth protecting
  try { return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host); } catch { return false; }
}

export const withCookie = (res: Response, setCookie: string | null) => { if (setCookie) res.headers.append("Set-Cookie", setCookie); return res; };
