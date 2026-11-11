"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CATALOG } from "@/lib/catalog";
import { ALLERGENS, type Allergen, type Diet } from "@/lib/types";
import { ErrorNote, fmt } from "@/components/ui";

type Session = { start: (opts: { presentationMode: "auto" }, order: Promise<{ orderId: string }>) => Promise<void> };
const SAMPLE: Record<string, number> = { "oat-milk-1l": 2, "granola-oat-500": 1, "pasta-gf-400": 1, "tomato-sauce-400": 1 };
const label = (a: string) => a.replace("_", " ");

export default function NewOrder() {
  const router = useRouter();
  const [qty, setQty] = useState<Record<string, number>>({});
  const [avoid, setAvoid] = useState<Allergen[]>([]);
  const [diet, setDiet] = useState<Diet | "">("");
  const [allowSubs, setAllowSubs] = useState(true);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sdk, setSdk] = useState<"loading" | "ready" | "off">("loading");
  const [paying, setPaying] = useState(false);
  const session = useRef<Session | null>(null);
  const created = useRef<{ id: string; shopperToken: string } | null>(null);
  const total = useMemo(() => CATALOG.reduce((a, p) => a + (qty[p.sku] ?? 0) * p.priceCents, 0), [qty]);

  useEffect(() => { document.title = "Start a basket · SwapSafe"; }, []);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const health = await fetch("/api/health", { cache: "no-store" }).then((r) => r.json());
        if (!health.paypalClientId) { if (!cancelled) setSdk("off"); return; }
        const { loadCoreSdkScript } = await import("@paypal/paypal-js/sdk-v6");
        const paypal = await loadCoreSdkScript({ environment: "sandbox" });
        const instance = await paypal!.createInstance({ clientId: health.paypalClientId, components: ["paypal-payments"], pageType: "checkout" });
        session.current = instance.createPayPalOneTimePaymentSession({
          onApprove: async () => {
            const c = created.current; if (!c) return;
            const r = await fetch(`/api/orders/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "authorize" }) });
            if (!r.ok) { setError((await r.json()).message ?? "PayPal could not place the hold."); setPaying(false); return; }
            router.push(`/o/${c.id}?t=${c.shopperToken}`);
          },
          onCancel: () => { setPaying(false); setError("You closed PayPal before approving. Nothing was held."); },
          onError: () => { setPaying(false); setError("PayPal reported a problem. Nothing was held."); },
        }) as unknown as Session;
        if (!cancelled) setSdk("ready");
      } catch { if (!cancelled) setSdk("off"); }
    })();
    return () => { cancelled = true; };
  }, [router]);

  const pay = async () => {
    if (!session.current) return;
    setError(null); setPaying(true);
    const items = Object.entries(qty).filter(([, n]) => n > 0).map(([sku, n]) => ({ sku, qty: n }));
    const order = fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shopperName: name, items, prefs: { avoidAllergens: avoid, diet: diet || null, allowSubstitutions: allowSubs } }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.message ?? "Could not create the order."); created.current = j; return { orderId: j.paypalOrderId as string }; });
    order.catch((e: Error) => { setError(e.message); setPaying(false); });
    try { await session.current.start({ presentationMode: "auto" }, order); } catch { setPaying(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1>Start a basket</h1><p className="text-muted">Prices come from the shop&apos;s catalog on the server. PayPal holds the total; you are charged only for what is packed.</p></div>
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <section aria-labelledby="items" className="card">
          <div className="flex items-center justify-between gap-3 mb-2"><h2 id="items">Items</h2><button type="button" className="btn" onClick={() => { setQty(SAMPLE); setAvoid(["peanuts"]); }}>Fill a sample basket</button></div>
          <ul>
            {CATALOG.map((p) => (
              <li key={p.sku} className="flex items-center justify-between gap-3 py-2 border-b border-line last:border-0">
                <div><p className="font-semibold">{p.brand} {p.name}</p><p className="text-sm text-muted">{p.size} · {fmt(p.priceCents)}</p></div>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn px-3" aria-label={`One less ${p.name}`} disabled={!qty[p.sku]} onClick={() => setQty((q) => ({ ...q, [p.sku]: Math.max((q[p.sku] ?? 0) - 1, 0) }))}>−</button>
                  <span className="w-6 text-center"><span className="sr-only">{p.name} quantity: </span>{qty[p.sku] ?? 0}</span>
                  <button type="button" className="btn px-3" aria-label={`One more ${p.name}`} disabled={(qty[p.sku] ?? 0) >= 10} onClick={() => setQty((q) => ({ ...q, [p.sku]: (q[p.sku] ?? 0) + 1 }))}>+</button>
                </div>
              </li>))}
          </ul>
        </section>
        <aside className="space-y-4">
          <section className="card space-y-3" aria-labelledby="rules">
            <h2 id="rules">Your swap rules</h2>
            <label className="block text-sm font-semibold" htmlFor="name">Name on the order</label>
            <input id="name" autoComplete="name" className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="Sandbox shopper" />
            <fieldset><legend className="text-sm font-semibold">Never give me anything that contains or may contain</legend>
              <div className="grid grid-cols-2 gap-x-3 mt-1">{ALLERGENS.map((a) => (
                <label key={a} className="flex items-center gap-2 py-1 capitalize"><input type="checkbox" className="size-4" checked={avoid.includes(a)} onChange={(e) => setAvoid((v) => e.target.checked ? [...v, a] : v.filter((x) => x !== a))} />{label(a)}</label>))}</div>
            </fieldset>
            <label className="block text-sm font-semibold" htmlFor="diet">Diet</label>
            <select id="diet" className="field" value={diet} onChange={(e) => setDiet(e.target.value as Diet | "")}><option value="">No restriction</option><option value="vegetarian">Vegetarian</option><option value="vegan">Vegan</option></select>
            <label className="flex items-center gap-2"><input type="checkbox" className="size-4" checked={allowSubs} onChange={(e) => setAllowSubs(e.target.checked)} />Offer me swaps for out-of-stock items</label>
          </section>
          <section className="card space-y-3" aria-labelledby="pay">
            <h2 id="pay">Hold {fmt(total)} with PayPal</h2>
            <p className="text-sm text-muted">This is an authorization. The shop can capture up to this amount, never more. Anything not packed is released.</p>
            <button type="button" className="btn btn-primary w-full" disabled={sdk !== "ready" || total === 0 || paying} onClick={pay}>{paying ? "Waiting for PayPal…" : "Approve the hold in PayPal"}</button>
            {sdk === "loading" && <p className="text-sm text-muted" role="status">Loading PayPal…</p>}
            {sdk === "off" && <p className="text-sm text-stop" role="status">PayPal sandbox is not configured on this deployment, so checkout is unavailable.</p>}
            {sdk === "ready" && total === 0 && <p className="text-sm text-muted">Add at least one item to enable the button.</p>}
            <ErrorNote message={error} />
          </section>
        </aside>
      </div>
    </div>
  );
}
