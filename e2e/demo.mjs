// Records the demo walkthrough on a running SwapSafe instance against the real PayPal sandbox.
// Usage: BASE_URL=... SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... node e2e/demo.mjs <outDir>
// Captions are drawn in the page; nothing is simulated. Timing marks for editing are written to <outDir>/marks.json.
import { chromium } from "@playwright/test";
import fs from "node:fs";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const out = process.argv[2] ?? "/tmp/demo";
const PACE = Number(process.env.PACE ?? 1);
fs.mkdirSync(out, { recursive: true });
const size = { width: 1280, height: 720 };
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined });
const context = await browser.newContext({ viewport: size, locale: "en-US", recordVideo: { dir: out, size } });
const page = await context.newPage();
const t0 = Date.now(); const marks = {}; const mark = (k) => { marks[k] = (Date.now() - t0) / 1000; console.log(`[demo] ${k} @ ${marks[k].toFixed(1)}s`); };
const pause = (s) => page.waitForTimeout(s * 1000 * PACE);
async function caption(text, seconds = 3.5) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) { el = document.createElement("div"); el.id = "demo-caption"; el.setAttribute("aria-hidden", "true");
      el.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:99999;background:#17231c;color:#fff;font:600 22px/1.35 system-ui,sans-serif;padding:14px 28px;text-align:center;border-top:4px solid #f2b632";
      document.body.appendChild(el); }
    el.textContent = t;
  }, text);
  await pause(seconds);
}
const show = async (locator) => { await locator.scrollIntoViewIfNeeded().catch(() => {}); await page.evaluate(() => window.scrollBy(0, -80)).catch(() => {}); };
let failed = false;
try {
  await page.goto(`${BASE}/`); mark("start");
  await caption("Small grocers pack online orders by hand. When an item is out of stock, the swap can be wrong, or unsafe.", 5);
  await page.goto(`${BASE}/order/new`);
  await caption("A shopper builds a basket and sets swap rules. Prices come from the server.", 3);
  await page.getByRole("button", { name: "Fill a sample basket" }).click();
  await show(page.getByRole("heading", { name: "Your swap rules" }));
  await caption("This shopper must avoid peanuts.", 3.5);
  const pay = page.getByRole("button", { name: "Approve the hold in PayPal" });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Approve the hold")); return b && !b.disabled; }, null, { timeout: 60000 });
  await show(pay);
  await caption("PayPal holds $19.75 with an authorization (JS SDK v6, sandbox). Nothing is charged yet.", 4.5);
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 60000 }), pay.click()]);
  mark("popup_open");
  await popup.waitForSelector("#email", { timeout: 60000 });
  await popup.waitForTimeout(1200);
  await popup.fill("#email", process.env.SANDBOX_BUYER_EMAIL);
  if (await popup.locator("#btnNext").isVisible().catch(() => false)) await popup.click("#btnNext");
  await popup.waitForSelector("#password", { state: "visible", timeout: 30000 });
  await popup.fill("#password", process.env.SANDBOX_BUYER_PASSWORD);
  await popup.click("#btnLogin");
  const approve = popup.locator('#payment-submit-btn, [data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue")').first();
  await approve.waitFor({ state: "visible", timeout: 60000 });
  await popup.waitForTimeout(2500);
  await approve.click();
  await page.waitForURL(/\/o\/ss_[a-f0-9]+\?t=/, { timeout: 90000 });
  await page.getByText("On hold, nothing charged").first().waitFor({ timeout: 30000 });
  mark("popup_close");
  const shopperUrl = page.url(); const orderId = shopperUrl.match(/\/o\/(ss_[a-f0-9]+)/)[1];
  await caption("The hold is placed. The shopper's page shows PayPal's own order and authorization ids.", 4);
  await show(page.getByRole("heading", { name: "PayPal record" })); await pause(2.5);

  await page.goto(`${BASE}/shop/${orderId}`);
  await caption("At the shop, the picker works through the list.", 3);
  const line = (name) => page.getByRole("article", { name });
  for (const n of ["Oat & Honey Granola", "Gluten-Free Penne (corn & rice)"]) { await line(n).getByRole("button", { name: "Picked", exact: true }).click(); await pause(0.6); }
  await line("Tomato & Basil Sauce").getByRole("button", { name: "Out of stock" }).click(); await pause(0.6);
  await show(line("Oat Drink Original"));
  await line("Oat Drink Original").getByRole("button", { name: "Out of stock" }).click();
  await caption("The oat drink is out of stock. The picker proposes a soy drink and photographs its label.", 4);
  await line("Oat Drink Original").getByLabel("Propose a substitute from the same shelf").selectOption("soy-milk-1l");
  await line("Oat Drink Original").getByRole("button", { name: "Use the sample label image" }).click();
  await line("Oat Drink Original").getByText("Blocked by the rules: not offered").waitFor({ timeout: 90000 });
  await show(line("Oat Drink Original").getByText("Blocked by the rules: not offered"));
  await caption("Gemini reads the label: \"may contain traces of peanuts\". The shop's data did not say so. The rules block this swap.", 7);
  await show(line("Oat Drink Original").getByLabel("Propose a substitute from the same shelf"));
  await line("Oat Drink Original").getByLabel("Propose a substitute from the same shelf").selectOption("almond-milk-1l");
  await line("Oat Drink Original").getByRole("button", { name: "Use the sample label image" }).click();
  await line("Oat Drink Original").getByText("Waiting for the shopper").waitFor({ timeout: 90000 });
  await show(line("Oat Drink Original").getByText("Waiting for the shopper"));
  await caption("Second try: an almond drink. No peanuts on the label. It costs more, so code charges the ordered price: the model never sets an amount.", 7);

  await page.goto(shopperUrl);
  await caption("The shopper sees the photo, the quoted label text and the price, and answers line by line.", 4.5);
  await page.getByRole("button", { name: "Accept this swap" }).click();
  await page.getByText(/You accepted this swap/).waitFor({ timeout: 30000 });
  await pause(1.5);

  await page.goto(`${BASE}/shop/${orderId}`);
  await show(page.getByRole("heading", { name: "Settlement" }));
  await caption("Settlement: picked lines and the accepted swap. The missing sauce is not charged.", 4.5);
  await page.getByRole("button", { name: "1. Approve this settlement" }).click();
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.startsWith("2. Capture")); return b && !b.disabled; }, null, { timeout: 30000 });
  await caption("The shop approves. The server recomputes the settlement and compares it with that approval before it calls PayPal.", 5.5);
  await page.getByRole("button", { name: /^2\. Capture/ }).click();
  await page.getByText("Captured", { exact: true }).first().waitFor({ timeout: 60000 });
  await show(page.getByRole("heading", { name: "PayPal ledger" }));
  await caption("One final capture of $16.76. PayPal releases the other $2.99 of the hold.", 4.5);
  await page.getByText("verified by PayPal").first().waitFor({ timeout: 60000 }).catch(() => {});
  await show(page.getByRole("heading", { name: "PayPal ledger" }));
  await caption("PayPal's webhooks arrive. Each signature is checked with PayPal's verify-webhook-signature call.", 5.5);
  await show(page.getByRole("heading", { name: "Assistant timeline" }));
  await caption("Every tool the assistant ran is on the timeline, next to the approvals people gave.", 4.5);

  await page.goto(shopperUrl);
  await page.getByRole("heading", { name: "Your receipt" }).waitFor({ timeout: 30000 });
  await caption("The shopper's receipt: every line, the evidence, and PayPal's ids.", 4);
  await page.getByLabel(/What went wrong with Oat & Honey Granola/).fill("box arrived torn open");
  await page.getByRole("row", { name: /Oat & Honey Granola/ }).getByRole("button", { name: "Report" }).click();
  await page.getByText("reported, waiting for the shop").waitFor({ timeout: 30000 });
  await caption("A problem after delivery? The shopper reports the line.", 3);
  await page.goto(`${BASE}/shop/${orderId}`);
  await show(page.getByRole("heading", { name: "Reports from the shopper" }));
  await page.getByRole("button", { name: /Approve refund of/ }).click();
  await page.getByText(/REFUND \(via/).waitFor({ timeout: 60000 });
  await show(page.getByRole("heading", { name: "PayPal ledger" }));
  await caption("The shop approves, and the refund goes out through the PayPal Agent Toolkit.", 5);
  mark("end");
  fs.writeFileSync(`${out}/marks.json`, JSON.stringify({ marks, orderId, main: await page.video().path(), popup: await popup.video()?.path() }, null, 2));
} catch (e) {
  failed = true; console.log(`[demo] FAILED: ${String(e.message).split("\n")[0]}`);
  console.log(`[demo] at ${page.url().split("?")[0]} :: ${(await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 300)}`);
} finally { await context.close(); await browser.close(); process.exit(failed ? 1 : 0); }
