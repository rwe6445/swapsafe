import { describe, expect, it } from "vitest";
import { ensureShop, readShop, safeEqual, sameOrigin } from "@/lib/session";
import { getStore } from "@/lib/store";
import { createOrder } from "@/lib/service";
import type { PayPalGateway } from "@/lib/paypal";

const req = (headers: Record<string, string> = {}) => new Request("https://swapsafe.example/api/orders", { headers });
const gw = { async createAuthorizeOrder() { return { orderId: `ORD${Math.random()}` }; } } as unknown as PayPalGateway;

describe("private demo shop", () => {
  it("issues a signed cookie and rejects a forged or altered one", () => {
    const { shop, setCookie } = ensureShop(req());
    expect(setCookie).toMatch(/HttpOnly; SameSite=Lax/); expect(setCookie).toMatch(/Secure/);
    const cookie = setCookie!.split(";")[0];
    expect(readShop(req({ cookie }))).toBe(shop);
    expect(readShop(req({ cookie: cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A")) }))).toBeNull();
    expect(readShop(req({ cookie: `ss_shop=${"a".repeat(32)}.forged` }))).toBeNull();
    expect(ensureShop(req({ cookie })).setCookie).toBeNull();
  });
  it("lists a shop only its own orders", async () => {
    const store = getStore();
    const mine = await createOrder(store, gw, { shopperName: "A", prefs: {}, items: [{ sku: "oat-milk-1l", qty: 1 }] }, "shop-mine");
    await createOrder(store, gw, { shopperName: "B", prefs: {}, items: [{ sku: "oat-milk-1l", qty: 1 }] }, "shop-other");
    const listed = await store.listOrders(50, "shop-mine");
    expect(listed.map((o) => o.id)).toEqual([mine.id]);
  });
  it("accepts only same-origin browser requests for state changes", () => {
    expect(sameOrigin(req({ origin: "https://swapsafe.example", host: "swapsafe.example" }))).toBe(true);
    expect(sameOrigin(req({ origin: "https://evil.example", host: "swapsafe.example" }))).toBe(false);
    expect(safeEqual("abc", "abd")).toBe(false);
  });
});
