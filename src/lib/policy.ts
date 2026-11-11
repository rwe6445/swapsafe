import { createHash } from "node:crypto";
import type { Allergen, LabelReading, Prefs, Product, SubDecision } from "./types";
import { ALLERGENS, DIETS } from "./types";

export const EMPTY_READING: LabelReading = {
  source: "none", productName: null, sizeText: null, allergensContains: [], allergensMayContain: [],
  dietClaims: [], evidence: [], notReadable: [], textAddressedToAi: [],
};

/** Keep only fields and enum values the schema allows. Anything else a model returns (amounts, verdicts) is dropped. */
export function sanitizeReading(raw: unknown, source: LabelReading["source"], model?: string): LabelReading {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const strs = (v: unknown, max = 8) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").map((s) => s.slice(0, 240)).slice(0, max) : []);
  const pick = <T extends string>(v: unknown, allowed: readonly T[]) => [...new Set(strs(v, 20).filter((s): s is T => (allowed as readonly string[]).includes(s)))];
  const ev = Array.isArray(r.evidence) ? r.evidence : [];
  return {
    source, model,
    productName: typeof r.productName === "string" ? r.productName.slice(0, 120) : null,
    sizeText: typeof r.sizeText === "string" ? r.sizeText.slice(0, 40) : null,
    allergensContains: pick(r.allergensContains, ALLERGENS),
    allergensMayContain: pick(r.allergensMayContain, ALLERGENS),
    dietClaims: pick(r.dietClaims, DIETS),
    evidence: ev.filter((e): e is { claim: string; quote: string } => !!e && typeof e.claim === "string" && typeof e.quote === "string")
      .map((e) => ({ claim: e.claim.slice(0, 120), quote: e.quote.slice(0, 240) })).slice(0, 12),
    notReadable: strs(r.notReadable),
    textAddressedToAi: strs(r.textAddressedToAi),
  };
}

const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 3));

/**
 * Deterministic substitution rules. The model's reading is evidence only:
 * - it can ADD allergens to the shop's declaration (union), never remove one;
 * - a diet claim on a label never grants permission the catalog does not already give;
 * - the charge comes from catalog prices: the shopper never pays more per unit than the item they ordered.
 */
export function decideSubstitution(input: {
  original: Product; substitute: Product; prefs: Prefs; reading: LabelReading; hasPhoto: boolean;
}): SubDecision {
  const { original, substitute, prefs, reading, hasPhoto } = input;
  const reasons: SubDecision["reasons"] = [];
  const block = (code: SubDecision["reasons"][number]["code"], detail: string) => reasons.push({ code, detail, blocking: true });
  const note = (code: SubDecision["reasons"][number]["code"], detail: string) => reasons.push({ code, detail, blocking: false });

  if (!prefs.allowSubstitutions) block("SHOPPER_OPTED_OUT", "The shopper asked for no substitutions on this order.");
  if (!hasPhoto || reading.source === "none") block("NO_LABEL_EVIDENCE", "No label photo was read for this item. A swap cannot be offered without one.");
  if (substitute.category !== original.category) block("DIFFERENT_CATEGORY", `Substitute is "${substitute.category}", ordered item is "${original.category}".`);

  const all = new Set<Allergen>([...substitute.allergens, ...substitute.mayContain, ...reading.allergensContains, ...reading.allergensMayContain]);
  const hits = prefs.avoidAllergens.filter((a) => all.has(a));
  if (hits.length) {
    const fromLabelOnly = hits.filter((a) => !substitute.allergens.includes(a) && !substitute.mayContain.includes(a));
    block("ALLERGEN_CONFLICT", `Contains or may contain: ${hits.join(", ")}.` + (fromLabelOnly.length ? ` (${fromLabelOnly.join(", ")} found on the label photo, not in the shop's data.)` : ""));
  }
  if (prefs.diet && !substitute.diets.includes(prefs.diet)) block("DIET_MISMATCH", `The shop's data does not list this item as ${prefs.diet}.`);

  // Fail closed: the photo must be evidence for THIS product, and an allergy-sensitive swap needs a fully read label.
  if (hasPhoto && reading.source !== "none") {
    const a = words(reading.productName ?? ""), b = words(`${substitute.brand} ${substitute.name}`);
    if (!reading.productName) block("LABEL_MISMATCH", "The reading could not tell which product the photo shows.");
    else if (![...a].some((w) => b.has(w))) block("LABEL_MISMATCH", `The label reads "${reading.productName}", but the proposed substitute is "${substitute.name}". Photograph the right product.`);
    if ((prefs.avoidAllergens.length > 0 || prefs.diet) && reading.notReadable.length > 0) block("LABEL_NOT_FULLY_READABLE", `Part of the label could not be read (${reading.notReadable.join("; ").slice(0, 160)}). With an allergy or diet rule on the order, an unclear label is not offered.`);
    if (reading.agreed === false) note("READINGS_DISAGREE", "Two independent readings differed on the allergen statements. Every allergen either one reported is counted.");
  }
  if (reading.textAddressedToAi.length) note("INSTRUCTION_TEXT_IGNORED", "Text found in the photo was treated as data, not as an instruction.");

  const chargeCentsPerUnit = Math.min(substitute.priceCents, original.priceCents);
  if (substitute.priceCents > original.priceCents) note("PRICE_MATCHED_DOWN", `Listed at ${fmt(substitute.priceCents)}, charged at the ordered item's ${fmt(original.priceCents)}.`);
  else if (substitute.priceCents < original.priceCents) note("PRICE_LOWER", `Costs ${fmt(original.priceCents - substitute.priceCents)} less per unit than the ordered item.`);

  return { verdict: reasons.some((r) => r.blocking) ? "blocked" : "offer", chargeCentsPerUnit, reasons };
}

export const fmt = (cents: number) => `$${(cents / 100).toFixed(2)}`;
export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (value: string | number) => Math.round(Number(value) * 100);

export function sha(obj: unknown): string { return createHash("sha256").update(canonical(obj)).digest("hex"); }
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
