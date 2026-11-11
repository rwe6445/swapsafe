import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { CATALOG } from "@/lib/catalog";
import { modelId, readLabel } from "@/lib/ai";

/** Reads every bundled sample label with the live vision model and stores the result, keyed by the image's SHA-256.
 *  The app shows these as "Cached AI result" when the model is unavailable. ONLY=sku limits the run; DRY=1 does not write. */
it("records label readings", async () => {
  const out: Record<string, unknown> = process.env.DRY ? {} : JSON.parse(readFileSync("src/lib/cached-readings.json", "utf8"));
  for (const p of CATALOG.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.sku))) {
    const bytes = new Uint8Array(readFileSync(`public${p.labelImage}`));
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const t0 = Date.now();
    const r = await readLabel({ bytes, mediaType: "image/png", sha256 });
    appendFileSync(process.env.RECORD_LOG ?? "/tmp/record.log", `${p.sku} [${modelId()}] ${Date.now() - t0}ms source=${r.source} name="${r.productName}" contains=[${r.allergensContains}] may=[${r.allergensMayContain}] diet=[${r.dietClaims}] ai-text=${r.textAddressedToAi.length} ev=${r.evidence.length}\n`);
    if (r.source === "ai") out[sha256] = { ...r, source: undefined, recordedAt: new Date().toISOString(), sku: p.sku };
  }
  if (!process.env.DRY) writeFileSync("src/lib/cached-readings.json", JSON.stringify(out, null, 2) + "\n");
});
