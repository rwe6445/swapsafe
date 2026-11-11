"use client";
import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorNote, fmt, Ledger, Pill, statusText, statusTone, SwapEvidence, useOrder } from "@/components/ui";

export default function ShopperOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const token = useSearchParams().get("t") ?? "";
  const { view, error, notice, busy, act } = useOrder(id, token);
  useEffect(() => { document.title = `Your order ${id} · SwapSafe`; }, [id]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  if (!view) return <><p role="status" className="text-muted">Loading your order…</p><ErrorNote message={error} /></>;
  const { order, settlement } = view;
  const swaps = order.lines.filter((l) => l.substitution && l.substitution.status !== "blocked");
  const settled = order.status === "SETTLED" || order.status === "VOIDED";
  const refunded = order.paypal.refunds.reduce((a, r) => a + r.cents, 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1>{settled ? "Your receipt" : "Your order"}</h1><p className="text-muted">{order.shopName} · order <span className="mono">{order.id}</span></p></div>
        <Pill tone={statusTone(order.status)}>{statusText(order.status)}</Pill>
      </div>
      <ErrorNote message={error} notice={notice} />
      {order.status === "HELD" && <p className="card bg-wait-bg">PayPal is holding {fmt(order.paypal.authorizedCents ?? 0)}. Nothing has been charged. This page updates as the shop picks your order.</p>}

      {swaps.length > 0 && (
        <section aria-labelledby="swaps" className="space-y-3">
          <h2 id="swaps">{order.status === "HELD" ? "Swaps that need your answer" : "Swaps on this order"}</h2>
          {swaps.map((l) => { const s = l.substitution!; return (
            <article key={l.id} className="card" aria-label={`Swap for ${l.name}`}>
              <p><strong>{l.qty} × {l.name}</strong> is out of stock. You ordered it at {fmt(l.unitPriceCents)} each.</p>
              <SwapEvidence sub={s} />
              {order.status === "HELD" ? (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className={`btn ${s.status === "accepted" ? "btn-primary" : ""}`} aria-pressed={s.status === "accepted"} aria-disabled={!!busy} onClick={() => act("consent", { action: "consent", lineId: l.id, decision: "accepted", proposalHash: s.proposalHash })}>Accept this swap</button>
                  <button type="button" className={`btn ${s.status === "declined" ? "btn-danger" : ""}`} aria-pressed={s.status === "declined"} aria-disabled={!!busy} onClick={() => act("consent", { action: "consent", lineId: l.id, decision: "declined", proposalHash: s.proposalHash })}>No thanks, remove the item</button>
                  <span className="text-sm text-muted">{s.status === "proposed" ? "Waiting for your answer." : `You ${s.status} this swap. You can change it until the shop finishes.`}</span>
                </div>
              ) : <p className="mt-2"><Pill tone={s.status === "accepted" ? "ok" : "plain"}>{s.status === "accepted" ? "You accepted" : "You declined: not charged"}</Pill></p>}
            </article>); })}
        </section>
      )}

      <section className="card" aria-labelledby="lines">
        <h2 id="lines">{settled ? "What you paid for" : "Your basket so far"}</h2>
        <div className="overflow-x-auto"><table className="mt-2"><thead><tr><th scope="col">Item</th><th scope="col">What happened</th><th scope="col">Charge</th>{order.status === "SETTLED" && <th scope="col">Problem?</th>}</tr></thead>
          <tbody>{settlement.lines.map((s) => { const issue = order.issues.find((i) => i.lineId === s.lineId); return (
            <tr key={s.lineId}><td>{s.qty} × {s.label}</td><td>{s.note}</td><td>{fmt(s.chargeCents)}</td>
              {order.status === "SETTLED" && <td>{s.chargeCents === 0 ? "" : issue ? <Pill tone={issue.status === "refunded" ? "ok" : "wait"}>{issue.status === "refunded" ? `refunded ${fmt(issue.cents)}` : "reported, waiting for the shop"}</Pill> : (
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); act("report", { action: "report", lineId: s.lineId, note: notes[s.lineId] || "item arrived damaged" }); }}>
                  <label className="sr-only" htmlFor={`note-${s.lineId}`}>What went wrong with {s.label}</label>
                  <input id={`note-${s.lineId}`} className="field !w-44 !py-1" placeholder="What went wrong?" maxLength={300} value={notes[s.lineId] ?? ""} onChange={(e) => setNotes((n) => ({ ...n, [s.lineId]: e.target.value }))} />
                  <button className="btn" aria-disabled={!!busy}>Report</button></form>)}</td>}
            </tr>); })}</tbody></table></div>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt>Held by PayPal</dt><dd className="font-bold">{fmt(settlement.authorizedCents)}</dd>
          <dt>{settled ? "Captured" : "Would be captured now"}</dt><dd className="font-bold">{fmt(settled ? order.paypal.capturedCents ?? 0 : settlement.totalCents)}</dd>
          <dt>{settled ? "Released back to you" : "Would be released"}</dt><dd className="font-bold">{fmt(settled ? (order.paypal.authorizedCents ?? 0) - (order.paypal.capturedCents ?? 0) : settlement.releaseCents)}</dd>
          {refunded > 0 && <><dt>Refunded</dt><dd className="font-bold">{fmt(refunded)}</dd></>}
        </dl>
      </section>

      <section className="card" aria-labelledby="proof">
        <h2 id="proof" className="mb-1">PayPal record</h2>
        <p className="text-sm text-muted mb-2">These ids come from PayPal. You can check them in your PayPal activity.</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 mb-3">
          <dt>Order</dt><dd className="mono">{order.paypal.orderId ?? "none"}</dd>
          <dt>Authorization</dt><dd className="mono">{order.paypal.authorizationId ?? "none"}</dd>
          {order.paypal.captureId && <><dt>Capture</dt><dd className="mono">{order.paypal.captureId}</dd></>}
          {order.paypal.refunds.map((r) => <div key={r.id} className="contents"><dt>Refund</dt><dd className="mono">{r.id} · {fmt(r.cents)}</dd></div>)}
        </dl>
        <Ledger order={order} />
      </section>
    </div>
  );
}
