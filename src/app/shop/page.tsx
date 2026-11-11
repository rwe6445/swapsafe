"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { fmt, Pill, statusText, statusTone } from "@/components/ui";

type Row = { id: string; createdAt: string; shopperName: string; status: string; lines: number; authorizedCents: number; capturedCents: number | null; waiting: number; total: number };
type Hook = { id: string; eventType: string; resourceId: string; verified: string; at: string; orderId?: string };

export default function Shop() {
  const [data, setData] = useState<{ orders: Row[]; webhooks: Hook[]; store: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { document.title = "Orders to pick · SwapSafe shop"; }, []);
  useEffect(() => {
    const load = () => fetch("/api/orders", { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (r.ok) { setData(j); setError(null); } else setError(j.message); }).catch(() => setError("Network problem. Retrying."));
    load(); const t = setInterval(load, 6000); return () => clearInterval(t);
  }, []);
  return (
    <div className="space-y-8">
      <div><h1>Marigold Corner Market: orders to pick</h1><p className="text-muted">This is your own private demo shop: it shows only orders started in this browser, and only this browser can pick, settle or refund them.</p></div>
      {error && <p role="alert" className="card bg-stop-bg text-stop">{error}</p>}
      <section className="card" aria-labelledby="orders">
        <h2 id="orders" className="mb-2">Orders</h2>
        {!data ? <p role="status" className="text-muted">Loading orders…</p> : data.orders.length === 0 ? (
          <p>No orders yet. <Link className="underline font-semibold" href="/order/new">Start a basket as the shopper</Link>, approve the hold in PayPal, and it appears here.</p>
        ) : (
          <div className="overflow-x-auto"><table>
            <thead><tr><th scope="col">Order</th><th scope="col">Shopper</th><th scope="col">Status</th><th scope="col">Held</th><th scope="col">Would capture now</th><th scope="col">Captured</th></tr></thead>
            <tbody>{data.orders.map((o) => (
              <tr key={o.id}>
                <td><Link className="underline font-semibold mono" href={`/shop/${o.id}`}>{o.id}</Link><span className="block text-sm text-muted">{o.lines} lines</span></td>
                <td>{o.shopperName}</td>
                <td><Pill tone={statusTone(o.status)}>{statusText(o.status)}</Pill>{o.waiting > 0 && <span className="block text-sm mt-1">{o.waiting} swap waiting for the shopper</span>}</td>
                <td>{fmt(o.authorizedCents)}</td><td>{o.status === "HELD" ? fmt(o.total) : ""}</td><td>{o.capturedCents != null ? fmt(o.capturedCents) : ""}</td>
              </tr>))}</tbody>
          </table></div>
        )}
      </section>
      <section className="card" aria-labelledby="hooks">
        <h2 id="hooks" className="mb-1">PayPal webhooks received</h2>
        <p className="text-sm text-muted mb-2">Each event is checked with PayPal&apos;s verify-webhook-signature call before it is recorded as verified.</p>
        {!data ? null : data.webhooks.length === 0 ? <p className="text-muted">No events yet. They arrive a few seconds after a hold, capture, void or refund.</p> : (
          <div className="overflow-x-auto"><table>
            <thead><tr><th scope="col">When (UTC)</th><th scope="col">Event</th><th scope="col">Resource</th><th scope="col">Signature</th><th scope="col">Order</th></tr></thead>
            <tbody>{data.webhooks.map((w) => (
              <tr key={w.id}><td className="mono">{w.at.slice(0, 19).replace("T", " ")}</td><td>{w.eventType}</td><td className="mono">{w.resourceId}</td>
                <td>{w.verified === "SUCCESS" ? <Pill tone="ok">verified by PayPal</Pill> : <Pill tone="stop">not verified</Pill>}</td>
                <td>{w.orderId ? <Link className="underline mono" href={`/shop/${w.orderId}`}>{w.orderId}</Link> : ""}</td></tr>))}</tbody>
          </table></div>
        )}
      </section>
    </div>
  );
}
