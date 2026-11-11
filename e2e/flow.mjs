// End-to-end run against a running SwapSafe instance and the real PayPal sandbox.
// Usage: BASE_URL=... SANDBOX_BUYER_EMAIL=... SANDBOX_BUYER_PASSWORD=... node e2e/flow.mjs [--video dir] [--swap]
import { chromium } from "@playwright/test";
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const args = process.argv.slice(2);
const videoDir = args.includes("--video") ? args[args.indexOf("--video") + 1] : null;
const withSwap = args.includes("--swap");
const voidRun = args.includes("--void"); // nothing can be packed: the whole hold is released
const step = (m) => console.log(`[e2e] ${m}`);
const browser = await chromium.launch({ proxy: process.env.HTTPS_PROXY && !BASE.includes("localhost") ? { server: process.env.HTTPS_PROXY } : process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "localhost,127.0.0.1" } : undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "en-US", ...(videoDir ? { recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } } : {}) });
const page = await context.newPage();
let failed = false;
try {
  await page.goto(`${BASE}/order/new`);
  await page.getByRole("button", { name: "Fill a sample basket" }).click();
  const pay = page.getByRole("button", { name: "Approve the hold in PayPal" });
  await pay.waitFor({ state: "visible" });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes("Approve the hold")); return b && !b.disabled; }, null, { timeout: 60000 });
  step("checkout ready (JS SDK v6 loaded)");
  const [popup] = await Promise.all([context.waitForEvent("page", { timeout: 60000 }), pay.click()]);
  await popup.waitForSelector("#email", { timeout: 60000 });
  await popup.fill("#email", process.env.SANDBOX_BUYER_EMAIL);
  if (await popup.locator("#btnNext").isVisible().catch(() => false)) await popup.click("#btnNext");
  await popup.waitForSelector("#password", { state: "visible", timeout: 30000 });
  await popup.fill("#password", process.env.SANDBOX_BUYER_PASSWORD);
  await popup.click("#btnLogin");
  const approve = popup.locator('#payment-submit-btn, [data-testid="submit-button-initial"], button:has-text("Complete Purchase"), button:has-text("Pay Now"), button:has-text("Continue")').first();
  await approve.waitFor({ state: "visible", timeout: 60000 });
  await popup.waitForTimeout(1200);
  await approve.click();
  await page.waitForURL(/\/o\/ss_[a-f0-9]+\?t=/, { timeout: 90000 });
  const shopperUrl = page.url();
  const orderId = shopperUrl.match(/\/o\/(ss_[a-f0-9]+)/)[1];
  await page.getByText("On hold, nothing charged").first().waitFor({ timeout: 30000 });
  step(`hold placed for ${orderId}`);

  await page.goto(`${BASE}/shop/${orderId}`);
  const line = (name) => page.getByRole("article", { name });
  if (voidRun) {
    for (const n of ["Oat Drink Original", "Oat & Honey Granola", "Gluten-Free Penne (corn & rice)", "Tomato & Basil Sauce"]) { await line(n).getByRole("button", { name: "Out of stock" }).click(); await page.waitForTimeout(500); }
    await page.getByRole("button", { name: "1. Approve this settlement" }).click();
    const release = page.getByRole("button", { name: "2. Release the whole hold (void)" });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.startsWith("2. Release")); return b && !b.disabled; }, null, { timeout: 30000 });
    await release.click();
    await page.getByText("Released, nothing charged").first().waitFor({ timeout: 60000 });
    step("voided: the whole hold was released");
    await page.goto(shopperUrl);
    await page.getByRole("heading", { name: "Your receipt" }).waitFor({ timeout: 30000 });
    await page.waitForTimeout(25000); // give PayPal time to deliver the webhook
    const v = await (await page.request.get(`${BASE}/api/orders/${orderId}`)).json();
    console.log(JSON.stringify({ orderId, status: v.order.status, paypal: v.order.paypal, ledger: v.order.ledger.map((l) => [l.type, l.paypalId, l.amountCents, l.verified]) }, null, 2));
    await context.close(); await browser.close(); process.exit(0);
  }
  await line("Oat Drink Original").getByRole("button", { name: "Out of stock" }).click();
  for (const n of ["Oat & Honey Granola", "Gluten-Free Penne (corn & rice)", "Tomato & Basil Sauce"]) { await line(n).getByRole("button", { name: "Picked", exact: true }).click(); await page.waitForTimeout(400); }
  if (withSwap) {
    await line("Oat Drink Original").getByLabel("Propose a substitute from the same shelf").selectOption("almond-milk-1l");
    await line("Oat Drink Original").getByRole("button", { name: "Use the sample label image" }).click();
    await line("Oat Drink Original").getByText(/Waiting for the shopper|Blocked by the rules/).waitFor({ timeout: 90000 });
    const offered = await line("Oat Drink Original").getByText("Waiting for the shopper").isVisible().catch(() => false);
    step(`swap ${offered ? "offered" : "blocked"}`);
    if (offered) {
      await page.goto(shopperUrl);
      await page.getByRole("button", { name: "Accept this swap" }).click();
      await page.getByText(/You accepted this swap/).waitFor({ timeout: 30000 });
      step("shopper accepted the swap");
      await page.goto(`${BASE}/shop/${orderId}`);
    }
  }
  await page.getByRole("button", { name: "1. Approve this settlement" }).click();
  const exec = page.getByRole("button", { name: /^2\. Capture/ });
  await page.waitForFunction(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.startsWith("2. Capture")); return b && !b.disabled; }, null, { timeout: 30000 });
  const label = await exec.innerText();
  await exec.click();
  await page.getByText("Captured", { exact: true }).first().waitFor({ timeout: 60000 });
  step(`settled: ${label}`);

  await page.goto(shopperUrl);
  await page.getByRole("heading", { name: "Your receipt" }).waitFor({ timeout: 30000 });
  await page.getByLabel(/What went wrong with Tomato/).fill("jar arrived cracked");
  await page.getByRole("row", { name: /Tomato & Basil Sauce/ }).getByRole("button", { name: "Report" }).click();
  await page.getByText("reported, waiting for the shop").waitFor({ timeout: 30000 });
  await page.goto(`${BASE}/shop/${orderId}`);
  await page.getByRole("button", { name: /Approve refund of/ }).click();
  await page.getByText(/REFUND \(via/).waitFor({ timeout: 60000 });
  step(`refund: ${await page.getByText(/REFUND \(via/).first().innerText()}`);
  const order = await (await page.request.get(`${BASE}/api/orders/${orderId}`)).json();
  console.log(JSON.stringify({ orderId, status: order.order.status, paypal: order.order.paypal, ledger: order.order.ledger.map((l) => [l.type, l.paypalId, l.amountCents, l.verified]) }, null, 2));
} catch (e) {
  failed = true; step(`FAILED: ${String(e.message).split("\n")[0]}`);
  for (const p of context.pages()) step(`open page: ${p.url().split("?")[0]} :: ${(await p.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 260)}`);
  await page.screenshot({ path: "/tmp/e2e_fail.png" }).catch(() => {});
} finally { await context.close(); await browser.close(); process.exit(failed ? 1 : 0); }
