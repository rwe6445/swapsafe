import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "SwapSafe: grocery swaps the shopper agrees to, paid only for what was packed",
  description: "A PayPal authorization holds the basket. When an item is out of stock, a vision model reads the substitute's label, code checks the shopper's rules, and PayPal captures only what was agreed.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-card focus:p-2">Skip to content</a>
        <div className="bg-ink text-paper text-sm px-4 py-1.5 text-center">PayPal sandbox only. No real money moves anywhere on this site.</div>
        <header className="border-b border-line bg-card">
          <nav aria-label="Main" className="mx-auto max-w-5xl px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/" className="font-extrabold text-lg tracking-tight">Swap<span className="text-leaf">Safe</span></Link>
            <Link href="/order/new" className="underline-offset-4 hover:underline">Shopper: start a basket</Link>
            <Link href="/shop" className="underline-offset-4 hover:underline">Shop: pick orders</Link>
          </nav>
        </header>
        <main id="main" className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-8 text-sm text-muted">Demo shop, products and labels are fictional. Built for the PayPal AI Hackathon, 2026.</footer>
      </body>
    </html>
  );
}
