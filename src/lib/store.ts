import { neon } from "@neondatabase/serverless";
import type { Order } from "./types";

export interface WebhookRecord { id: string; eventType: string; resourceId: string; verified: "SUCCESS" | "FAILURE"; at: string; orderId?: string }
export interface Store {
  kind: "postgres" | "memory";
  getOrder(id: string): Promise<{ order: Order; version: number } | null>;
  insertOrder(order: Order): Promise<void>;
  saveOrder(order: Order, expectedVersion: number): Promise<boolean>;
  listOrders(limit: number, shop: string): Promise<Order[]>;
  findByPayPalId(paypalId: string): Promise<string | null>;
  recordWebhook(w: WebhookRecord): Promise<boolean>; // false when the event id was already stored
  listWebhooks(limit: number, shop?: string): Promise<WebhookRecord[]>;
  bumpCounter(key: string): Promise<number>;
  putPhoto(id: string, mediaType: string, bytes: Uint8Array): Promise<void>;
  getPhoto(id: string): Promise<{ mediaType: string; bytes: Uint8Array } | null>;
}

const g = globalThis as unknown as { __swapsafe?: { orders: Map<string, { order: Order; version: number }>; hooks: Map<string, WebhookRecord>; counters: Map<string, number>; photos: Map<string, { mediaType: string; bytes: Uint8Array }> } };
function memory(): Store {
  const m = (g.__swapsafe ??= { orders: new Map(), hooks: new Map(), counters: new Map(), photos: new Map() });
  const paypalIds = (o: Order) => [o.paypal.orderId, o.paypal.authorizationId, o.paypal.captureId, ...o.paypal.refunds.map((r) => r.id)];
  return {
    kind: "memory",
    async getOrder(id) { const r = m.orders.get(id); return r ? structuredClone(r) : null; },
    async insertOrder(order) { m.orders.set(order.id, { order: structuredClone(order), version: 1 }); },
    async saveOrder(order, v) { const cur = m.orders.get(order.id); if (!cur || cur.version !== v) return false; m.orders.set(order.id, { order: structuredClone(order), version: v + 1 }); return true; },
    async listOrders(limit, shop) { return [...m.orders.values()].filter((r) => r.order.shop === shop).map((r) => structuredClone(r.order)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); },
    async findByPayPalId(pid) { for (const r of m.orders.values()) if (paypalIds(r.order).includes(pid)) return r.order.id; return null; },
    async recordWebhook(w) { if (m.hooks.has(w.id)) return false; m.hooks.set(w.id, w); return true; },
    async listWebhooks(limit, shop) { return [...m.hooks.values()].filter((w) => !shop || (w.orderId && m.orders.get(w.orderId)?.order.shop === shop)).sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit); },
    async bumpCounter(key) { const n = (m.counters.get(key) ?? 0) + 1; m.counters.set(key, n); return n; },
    async putPhoto(id, mediaType, bytes) { m.photos.set(id, { mediaType, bytes }); },
    async getPhoto(id) { return m.photos.get(id) ?? null; },
  };
}

let ready: Promise<void> | null = null;
function postgres(url: string): Store {
  const sql = neon(url);
  const init = () => (ready ??= (async () => {
    await sql`create table if not exists orders (id text primary key, version int not null default 1, doc jsonb not null, paypal_ids text[] not null default '{}', created_at timestamptz not null default now())`;
    await sql`create table if not exists webhook_events (id text primary key, event_type text not null, resource_id text not null, verified text not null, order_id text, at timestamptz not null default now())`;
    await sql`create table if not exists counters (key text primary key, n int not null default 0)`;
    await sql`create table if not exists photos (id text primary key, media_type text not null, b64 text not null, at timestamptz not null default now())`;
    await sql`create index if not exists orders_paypal_ids on orders using gin (paypal_ids)`;
  })());
  const ids = (o: Order) => [o.paypal.orderId, o.paypal.authorizationId, o.paypal.captureId, ...o.paypal.refunds.map((r) => r.id)].filter((x): x is string => !!x);
  return {
    kind: "postgres",
    async getOrder(id) { await init(); const r = await sql`select doc, version from orders where id = ${id}`; return r[0] ? { order: r[0].doc as Order, version: r[0].version as number } : null; },
    async insertOrder(o) { await init(); await sql`insert into orders (id, doc, paypal_ids) values (${o.id}, ${JSON.stringify(o)}::jsonb, ${ids(o)})`; },
    async saveOrder(o, v) { await init(); const r = await sql`update orders set doc = ${JSON.stringify(o)}::jsonb, paypal_ids = ${ids(o)}, version = version + 1 where id = ${o.id} and version = ${v} returning id`; return r.length === 1; },
    async listOrders(limit, shop) { await init(); const r = await sql`select doc from orders where doc->>'shop' = ${shop} order by created_at desc limit ${limit}`; return r.map((x) => x.doc as Order); },
    async findByPayPalId(pid) { await init(); const r = await sql`select id from orders where paypal_ids @> array[${pid}]::text[] limit 1`; return r[0] ? (r[0].id as string) : null; },
    async recordWebhook(w) { await init(); const r = await sql`insert into webhook_events (id, event_type, resource_id, verified, order_id) values (${w.id}, ${w.eventType}, ${w.resourceId}, ${w.verified}, ${w.orderId ?? null}) on conflict (id) do nothing returning id`; return r.length === 1; },
    async listWebhooks(limit, shop) { await init(); const r = shop ? await sql`select w.id, w.event_type, w.resource_id, w.verified, w.order_id, w.at from webhook_events w join orders o on o.id = w.order_id where o.doc->>'shop' = ${shop} order by w.at desc limit ${limit}` : await sql`select id, event_type, resource_id, verified, order_id, at from webhook_events order by at desc limit ${limit}`; return r.map((x) => ({ id: x.id, eventType: x.event_type, resourceId: x.resource_id, verified: x.verified, orderId: x.order_id ?? undefined, at: new Date(x.at).toISOString() })); },
    async putPhoto(id, mediaType, bytes) { await init(); await sql`insert into photos (id, media_type, b64) values (${id}, ${mediaType}, ${Buffer.from(bytes).toString("base64")}) on conflict (id) do nothing`; },
    async getPhoto(id) { await init(); const r = await sql`select media_type, b64 from photos where id = ${id}`; return r[0] ? { mediaType: r[0].media_type as string, bytes: new Uint8Array(Buffer.from(r[0].b64 as string, "base64")) } : null; },
    async bumpCounter(key) { await init(); const r = await sql`insert into counters (key, n) values (${key}, 1) on conflict (key) do update set n = counters.n + 1 returning n`; return r[0].n as number; },
  };
}

export function getStore(): Store { const url = process.env.DATABASE_URL; return url ? postgres(url) : memory(); }

/** Load, change, save with an optimistic version check. Retries when a webhook or another tab saved first. */
export async function mutateOrder<T>(store: Store, id: string, fn: (order: Order) => Promise<T> | T): Promise<{ order: Order; result: T }> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const cur = await store.getOrder(id);
    if (!cur) throw new Error("ORDER_NOT_FOUND");
    const result = await fn(cur.order);
    if (await store.saveOrder(cur.order, cur.version)) return { order: cur.order, result };
  }
  throw new Error("ORDER_BUSY");
}
