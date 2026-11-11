"use client";
import Link from "next/link";
import { use, useEffect, useRef, useState } from "react";
import { ErrorNote, fmt, Ledger, Pill, statusText, statusTone, SwapEvidence, useOrder } from "@/components/ui";

/** Shrink the photo in the browser before upload. Re-encoding through a canvas also drops EXIF (location, device). */
async function shrink(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas"); canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("encode"))), "image/jpeg", 0.85));
}

export default function ShopOrder({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { view, error, notice, busy, act } = useOrder(id, null);
  const executeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { document.title = `Order ${id} · SwapSafe shop`; }, [id]);
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [approvalId, setApprovalId] = useState<string | null>(null);
  if (!view) return <><p role="status" className="text-muted">Loading order…</p><ErrorNote message={error} /></>;
  const { order, settlement, candidates } = view;
  const open = order.status === "HELD";
  const approval = order.approvals.find((a) => a.id === approvalId && a.settlementHash === settlement.hash) ?? order.approvals.find((a) => a.settlementHash === settlement.hash);

  const propose = async (lineId: string, sample: boolean) => {
    const sku = choice[lineId] ?? candidates?.[lineId]?.[0]?.sku; if (!sku) return;
    const form = new FormData(); form.set("action", "swap"); form.set("lineId", lineId); form.set("sku", sku);
    if (sample) form.set("sample", "1");
    else if (files[lineId]) { try { form.set("photo", await shrink(files[lineId]!), "label.jpg"); } catch { form.set("photo", files[lineId]!); } }
    await act(`swap-${lineId}`, form);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><p className="text-sm"><Link className="underline" href="/shop">All orders</Link></p><h1>Order <span className="mono">{order.id}</span></h1>
          <p className="text-muted">{order.shopperName} · held {fmt(order.paypal.authorizedCents ?? 0)} · avoids: {order.prefs.avoidAllergens.join(", ").replace(/_/g, " ") || "nothing listed"}{order.prefs.diet ? ` · ${order.prefs.diet}` : ""}{order.prefs.allowSubstitutions ? "" : " · no swaps wanted"}</p></div>
        <Pill tone={statusTone(order.status)}>{statusText(order.status)}</Pill>
      </div>
      <ErrorNote message={error} notice={notice} />
      {order.status === "DRAFT" && <p className="card bg-wait-bg">The shopper has not approved the hold in PayPal yet. Nothing can be picked until they do.</p>}

      <section aria-labelledby="pick" className="space-y-3">
        <h2 id="pick">Pick list</h2>
        {order.lines.map((l) => (
          <article key={l.id} className="card" aria-label={l.name}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><p className="font-bold">{l.qty} × {l.name}</p><p className="text-sm text-muted">{l.size} · {fmt(l.unitPriceCents)} each</p></div>
              <div className="flex gap-2">
                <button type="button" className={`btn ${l.status === "picked" ? "btn-primary" : ""}`} aria-pressed={l.status === "picked"} disabled={!open} aria-aria-disabled={!!busy} onClick={() => act("pick", { action: "pick", lineId: l.id, status: "picked" })}>Picked</button>
                <button type="button" className={`btn ${l.status === "out_of_stock" ? "btn-danger" : ""}`} aria-pressed={l.status === "out_of_stock"} disabled={!open} aria-aria-disabled={!!busy} onClick={() => act("pick", { action: "pick", lineId: l.id, status: "out_of_stock" })}>Out of stock</button>
              </div>
            </div>
            {l.status === "out_of_stock" && open && (
              <div className="mt-3 border-t border-line pt-3 space-y-2">
                <label className="block text-sm font-semibold" htmlFor={`sub-${l.id}`}>Propose a substitute from the same shelf</label>
                <select id={`sub-${l.id}`} className="field" value={choice[l.id] ?? candidates?.[l.id]?.[0]?.sku ?? ""} onChange={(e) => setChoice((c) => ({ ...c, [l.id]: e.target.value }))}>
                  {(candidates?.[l.id] ?? []).map((c) => <option key={c.sku} value={c.sku}>{c.name}, {c.size}, {fmt(c.priceCents)}</option>)}
                </select>
                <label className="block text-sm font-semibold" htmlFor={`photo-${l.id}`}>Photo of the substitute&apos;s label (JPEG, PNG or WebP, up to 2 MB)</label>
                <input id={`photo-${l.id}`} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="block w-full text-sm" onChange={(e) => setFiles((f) => ({ ...f, [l.id]: e.target.files?.[0] ?? null }))} />
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary" disabled={!files[l.id]} aria-aria-disabled={!!busy} onClick={() => propose(l.id, false)}>Check my photo</button>
                  <button type="button" className="btn" aria-disabled={!!busy} onClick={() => propose(l.id, true)}>Use the sample label image</button>
                </div>
                {busy === `swap-${l.id}` && <p role="status" className="text-sm">Reading the label and checking the shopper&apos;s rules…</p>}
              </div>
            )}
            {l.substitution && (
              <div className="mt-3 border-t border-line pt-3">
                <p><Pill tone={l.substitution.status === "accepted" ? "ok" : l.substitution.status === "proposed" ? "wait" : "stop"}>
                  {{ proposed: "Waiting for the shopper", accepted: "Shopper accepted", declined: "Shopper declined: not charged", blocked: "Blocked by the rules: not offered" }[l.substitution.status]}</Pill></p>
                <SwapEvidence sub={l.substitution} />
              </div>
            )}
          </article>
        ))}
      </section>

      <section className="card" aria-labelledby="settle">
        <h2 id="settle">Settlement</h2>
        <div className="overflow-x-auto"><table className="mt-2"><thead><tr><th scope="col">Line</th><th scope="col">Basis</th><th scope="col">Charge</th></tr></thead>
          <tbody>{settlement.lines.map((s) => <tr key={s.lineId}><td>{s.qty} × {s.label}</td><td>{s.note}</td><td>{fmt(s.chargeCents)}</td></tr>)}</tbody></table></div>
        <p className="mt-3">Held <strong>{fmt(settlement.authorizedCents)}</strong> · to capture <strong>{fmt(settlement.totalCents)}</strong> · to release <strong>{fmt(settlement.releaseCents)}</strong></p>
        {open && settlement.blockers.length > 0 && <ul className="mt-2 list-disc pl-5 text-sm">{settlement.blockers.map((b) => <li key={b}>{b}</li>)}</ul>}
        {open && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" className="btn" disabled={!settlement.ready || !!approval} aria-aria-disabled={!!busy} onClick={async () => { const v = await act("approve", { action: "approve", by: "shop owner (demo)" }); const a = v?.order.approvals.at(-1); if (a) { setApprovalId(a.id); setTimeout(() => executeRef.current?.focus(), 50); } }}>1. Approve this settlement</button>
            <button type="button" ref={executeRef} className="btn btn-primary" disabled={!approval} aria-aria-disabled={!!busy} onClick={() => approval && act("execute", { action: "execute", approvalId: approval.id, totalCents: String(settlement.totalCents) })}>
              2. {settlement.action === "capture" ? `Capture ${fmt(settlement.totalCents)} and release ${fmt(settlement.releaseCents)}` : "Release the whole hold (void)"}</button>
            <p className="text-sm text-muted basis-full">The server recomputes the settlement and compares it with your approval record before it calls PayPal. Any change after step 1 cancels the approval.</p>
          </div>
        )}
        {order.status === "SETTLING" && order.settling && (
          <div className="mt-3"><p className="text-sm">PayPal has not confirmed this settlement yet.</p>
            <button type="button" className="btn btn-primary mt-2" aria-disabled={!!busy} onClick={() => act("execute", { action: "execute", approvalId: order.settling!.approvalId, totalCents: String(order.settling!.totalCents) })}>Ask PayPal again (same request, cannot charge twice)</button></div>
        )}
        {!open && order.status !== "DRAFT" && <p className="mt-2 text-sm"><Link className="underline" href={`/o/${order.id}?t=${order.shopperToken}`}>Open the shopper&apos;s receipt for this order</Link></p>}
      </section>

      {order.issues.length > 0 && (
        <section className="card" aria-labelledby="issues"><h2 id="issues">Reports from the shopper</h2>
          <ul className="mt-2 space-y-2">{order.issues.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2"><span>{order.lines.find((l) => l.id === i.lineId)?.name}: “{i.note}” · {fmt(i.cents)}</span>
              {i.status === "refunded" ? <Pill tone="ok">refunded</Pill> : <button type="button" className="btn" aria-disabled={!!busy} onClick={() => act("refund", { action: "refund", issueId: i.id, by: "shop owner (demo)" })}>{i.status === "refunding" ? "Finish refund" : "Approve refund"} of {fmt(i.cents)}</button>}</li>))}</ul>
        </section>
      )}

      <section className="card" aria-labelledby="ledger"><h2 id="ledger" className="mb-2">PayPal ledger</h2><Ledger order={order} /></section>

      <section className="card" aria-labelledby="agent">
        <h2 id="agent">Assistant timeline</h2>
        <p className="text-sm text-muted mb-2">Each tool the swap assistant ran, with what it returned. Approvals by people are listed too.</p>
        {order.timeline.length === 0 ? <p className="text-muted">Nothing yet. It starts when you propose a swap.</p> : (
          <ol className="space-y-1 text-sm">{order.timeline.map((s, i) => (
            <li key={i} className="grid grid-cols-1 sm:grid-cols-[72px_170px_1fr] gap-x-2 gap-y-0.5 py-1 sm:py-0"><span className="mono text-muted">{s.at.slice(11, 19)}</span>
              <span><Pill tone={s.kind === "approval" ? "wait" : "plain"}>{s.tool}</Pill></span><span>{s.output}{s.ms ? <span className="text-muted"> ({s.ms} ms)</span> : null}</span></li>))}</ol>
        )}
      </section>

      {order.status !== "DRAFT" && <p className="text-sm">Demo shortcut: <Link className="underline" href={`/o/${order.id}?t=${order.shopperToken}`}>open the shopper&apos;s page for this order</Link>. In a real shop this link goes to the shopper by message.</p>}
    </div>
  );
}
