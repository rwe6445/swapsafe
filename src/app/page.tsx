import Link from "next/link";

const steps = [
  ["The basket is held, not charged", "The shopper approves once in PayPal. An Orders v2 order with intent AUTHORIZE holds the estimate."],
  ["An item is out of stock", "The picker chooses a substitute and photographs its label. A vision model reads the label and quotes what it says."],
  ["Code checks the shopper's rules", "Allergens from the label are added to the shop's own data. A conflict blocks the swap. The price is never above the item that was ordered."],
  ["The shopper answers each swap", "Accept or decline per line, with the photo and the reasons in front of them."],
  ["PayPal captures only what was agreed", "After the shop approves, the server re-checks the approval record and sends one final capture. PayPal releases the rest of the hold."],
];

export default function Home() {
  return (
    <div className="space-y-10">
      <section className="space-y-4 max-w-3xl">
        <h1>When a grocery item is out of stock, the swap should be safe to eat and fair to pay for.</h1>
        <p className="text-lg">SwapSafe is for small grocers who pack online orders by hand. The shopper&apos;s basket is held with a PayPal authorization. A vision model reads the label of each proposed substitute, code applies the shopper&apos;s allergy and diet rules, the shopper answers line by line, and PayPal captures only the final amount.</p>
        <div className="flex flex-wrap gap-3">
          <Link className="btn btn-primary" href="/order/new">Try it as the shopper</Link>
          <Link className="btn" href="/shop">Open the shop&apos;s picking screen</Link>
        </div>
      </section>
      <section aria-labelledby="how">
        <h2 id="how" className="mb-3">How one order moves</h2>
        <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([t, d], i) => (
            <li key={t} className="card"><p className="text-sm font-bold text-leaf">Step {i + 1}</p><p className="font-bold">{t}</p><p className="text-sm text-muted mt-1">{d}</p></li>
          ))}
        </ol>
      </section>
      <section className="card max-w-3xl" aria-labelledby="limits">
        <h2 id="limits">What the model cannot do</h2>
        <ul className="list-disc pl-5 mt-2 space-y-1">
          <li>It never sets or changes an amount. Its output has no amount field.</li>
          <li>It can add an allergen warning to the shop&apos;s data. It cannot remove one.</li>
          <li>It cannot capture, void or refund. Those run only after a person approves and the server re-checks the approval.</li>
          <li>Text printed inside a photo is treated as data.</li>
        </ul>
      </section>
    </div>
  );
}
