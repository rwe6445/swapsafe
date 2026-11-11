"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Order, Settlement } from "@/lib/types";

export const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export type ShopView = { role: "shop" | "shopper"; order: Order; settlement: Settlement; candidates?: Record<string, { sku: string; name: string; size: string; priceCents: number; labelImage: string }[]> };

export function Pill({ tone, children }: { tone: "ok" | "wait" | "stop" | "plain"; children: React.ReactNode }) {
  const cls = { ok: "bg-ok-bg text-leaf-dark", wait: "bg-wait-bg text-ink", stop: "bg-stop-bg text-stop", plain: "bg-card text-muted" }[tone];
  return <span className={`pill ${cls}`}>{children}</span>;
}
export const statusTone = (s: string) => (s === "SETTLED" ? "ok" : s === "VOIDED" ? "plain" : s === "HELD" || s === "SETTLING" ? "wait" : "plain") as "ok" | "wait" | "plain";
export const statusText = (s: string) => ({ DRAFT: "Waiting for PayPal approval", HELD: "On hold, nothing charged", SETTLING: "Settling with PayPal", SETTLED: "Captured", VOIDED: "Released, nothing charged" }[s] ?? s);

/** Loads one order, polls while it is open, and posts actions. Errors are shown, not swallowed. */
export function useOrder(id: string, token: string | null) {
  const [view, setView] = useState<ShopView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const alive = useRef(true); const running = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/orders/${id}${token ? `?t=${encodeURIComponent(token)}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!alive.current) return;
      if (!r.ok) setLoadError(j.message ?? "Could not load the order."); else { if (!running.current) setView(j); setLoadError(null); }
    } catch { if (alive.current) setLoadError("Network problem. Retrying."); }
  }, [id, token]);
  useEffect(() => { alive.current = true; load(); const t = setInterval(load, 5000); return () => { alive.current = false; clearInterval(t); }; }, [load]);
  const act = useCallback(async (label: string, body: Record<string, string> | FormData) => {
    if (running.current) return null; // buttons stay focusable while busy (aria-disabled), so guard re-entry here
    running.current = true; setBusy(label); setError(null); setNotice("Working…");
    try {
      const isForm = body instanceof FormData;
      if (token) { if (isForm) body.set("token", token); else body.token = token; }
      const r = await fetch(`/api/orders/${id}`, { method: "POST", body: isForm ? body : JSON.stringify(body), headers: isForm ? undefined : { "Content-Type": "application/json" } });
      const j = await r.json();
      if (!r.ok) { setError(j.message ?? "That did not work."); setNotice(""); return null; }
      setView(j); setNotice(`Done. Order status: ${statusText((j as ShopView).order.status)}.`); return j as ShopView;
    } catch { setError("Network problem. Nothing was changed."); setNotice(""); return null; } finally { running.current = false; setBusy(null); }
  }, [id, token]);
  return { view, error: error ?? loadError, notice, busy, act, reload: load };
}

export function ErrorNote({ message, notice = "" }: { message: string | null; notice?: string }) {
  return <><div role="alert" aria-live="assertive">{message ? <p className="card border-stop text-stop bg-stop-bg my-3">{message}</p> : null}</div><p role="status" className="sr-only">{notice}</p></>;
}

export function Ledger({ order }: { order: Pick<Order, "ledger"> }) {
  if (!order.ledger.length) return <p className="text-muted">No PayPal activity yet.</p>;
  return (
    <div className="overflow-x-auto"><table>
      <thead><tr><th scope="col">When (UTC)</th><th scope="col">Event</th><th scope="col">Amount</th><th scope="col">PayPal ID</th><th scope="col">Webhook signature</th></tr></thead>
      <tbody>{order.ledger.map((e) => (
        <tr key={e.id}>
          <td className="mono">{e.at.slice(11, 19)}</td><td>{e.type}{e.detail ? <span className="block text-sm text-muted">{e.detail}</span> : null}</td>
          <td>{e.amountCents != null ? fmt(e.amountCents) : ""}</td>
          <td className="mono">{e.paypalId ?? ""}{e.debugId ? <span className="block text-muted">debug {e.debugId}</span> : null}</td>
          <td>{e.verified === "SUCCESS" ? <Pill tone="ok">verified by PayPal</Pill> : e.verified === "FAILURE" ? <Pill tone="stop">not verified</Pill> : ""}</td>
        </tr>))}</tbody>
    </table></div>
  );
}

const CLAIM_LABELS: [RegExp, string][] = [[/^product\s*name/i, "Product name"], [/^size/i, "Size"], [/^allergens?\s*may\s*contain/i, "May contain"], [/^allergens?\s*contains?/i, "Contains"], [/^diet/i, "Diet claim"]];
/** The model names its claims after schema fields; show them in plain words. */
const claimLabel = (claim: string) => { const rest = claim.includes(":") ? claim.slice(claim.indexOf(":") + 1).trim().replace(/_/g, " ") : ""; const hit = CLAIM_LABELS.find(([rx]) => rx.test(claim)); return hit ? (rest ? `${hit[1]} (${rest})` : hit[1]) : claim; };

export function SwapEvidence({ sub }: { sub: NonNullable<Order["lines"][number]["substitution"]> }) {
  const r = sub.reading;
  return (
    <div className="grid gap-4 sm:grid-cols-[160px_1fr] mt-3">
      {sub.photo ? <img src={sub.photo.url} alt={`Label photo of ${sub.name}`} className="w-40 rounded-lg border border-line" /> : <div className="w-40 h-40 grid place-items-center rounded-lg border border-dashed border-line text-sm text-muted text-center p-2">No label photo</div>}
      <div className="text-sm space-y-2">
        <p><strong>{sub.name}</strong>, {sub.size}. Shelf price {fmt(sub.listPriceCents)}. <strong>Charge if accepted: {fmt(sub.decision.chargeCentsPerUnit)} each.</strong></p>
        <p className="text-muted">{r.source === "ai" ? `Label read by ${r.model ?? "the vision model"}.` : r.source === "cached" ? "Cached AI result: a reading recorded earlier for this sample label." : "No label reading is available."}</p>
        {r.evidence.length > 0 && <ul className="list-disc pl-5">{r.evidence.slice(0, 6).map((e, i) => <li key={i}>{claimLabel(e.claim)}: <q>{e.quote}</q></li>)}</ul>}
        {r.notReadable.length > 0 && <p>Could not read: {r.notReadable.join("; ")}</p>}
        {r.textAddressedToAi.length > 0 && <p className="card bg-wait-bg py-2">Text found in the photo was treated as data, not as an instruction: <q className="mono">{r.textAddressedToAi[0]}</q></p>}
        <ul className="space-y-1">{sub.decision.reasons.map((x, i) => <li key={i}><Pill tone={x.blocking ? "stop" : "plain"}>{x.blocking ? "Rule blocks" : "Rule note"}</Pill> {x.detail}</li>)}</ul>
      </div>
    </div>
  );
}
