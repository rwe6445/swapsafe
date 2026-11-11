export const ALLERGENS = ["peanuts", "tree_nuts", "milk", "egg", "wheat", "soy", "fish", "shellfish", "sesame"] as const;
export type Allergen = (typeof ALLERGENS)[number];
export const DIETS = ["vegetarian", "vegan"] as const;
export type Diet = (typeof DIETS)[number];

export interface Product {
  sku: string; name: string; brand: string; size: string; priceCents: number; category: string;
  allergens: Allergen[]; mayContain: Allergen[]; diets: Diet[]; labelImage: string;
}

export interface Prefs { avoidAllergens: Allergen[]; diet: Diet | null; allowSubstitutions: boolean }

/** What the vision model may return. There is deliberately no price or amount field. */
export interface LabelReading {
  source: "ai" | "cached" | "none";
  model?: string;
  productName: string | null;
  sizeText: string | null;
  allergensContains: Allergen[];
  allergensMayContain: Allergen[];
  dietClaims: Diet[];
  evidence: { claim: string; quote: string }[];
  notReadable: string[];
  /** Text in the photo that reads like an instruction. Shown to people as data, never acted on. */
  textAddressedToAi: string[];
}

export type ReasonCode =
  | "NO_LABEL_EVIDENCE" | "ALLERGEN_CONFLICT" | "DIET_MISMATCH" | "DIFFERENT_CATEGORY" | "SHOPPER_OPTED_OUT"
  | "LABEL_NAME_UNCONFIRMED" | "PRICE_MATCHED_DOWN" | "PRICE_LOWER" | "INSTRUCTION_TEXT_IGNORED";

export interface SubDecision {
  verdict: "offer" | "blocked";
  chargeCentsPerUnit: number;
  reasons: { code: ReasonCode; detail: string; blocking: boolean }[];
}

export interface Substitution {
  id: string; sku: string; name: string; size: string; listPriceCents: number;
  photo: { id: string; url: string; sha256: string } | null;
  reading: LabelReading; decision: SubDecision; proposalHash: string;
  status: "proposed" | "accepted" | "declined" | "blocked";
  consent?: { decision: "accepted" | "declined"; at: string; proposalHash: string };
}

export interface OrderLine {
  id: string; sku: string; name: string; size: string; qty: number; unitPriceCents: number;
  status: "pending" | "picked" | "out_of_stock";
  substitution?: Substitution;
}

export type OrderStatus = "DRAFT" | "HELD" | "SETTLING" | "SETTLED" | "VOIDED";

export interface AgentStep { at: string; tool: string; input: string; output: string; ms: number; kind: "tool" | "approval" | "note" }

export interface Approval { id: string; by: string; at: string; settlementHash: string; totalCents: number }

export interface LedgerEvent {
  id: string; at: string; type: string; paypalId?: string; debugId?: string; amountCents?: number;
  verified?: "SUCCESS" | "FAILURE" | "n/a"; detail?: string;
}

export interface Order {
  id: string; createdAt: string; shopName: string; shopperName: string; shopperToken: string; prefs: Prefs;
  lines: OrderLine[]; status: OrderStatus; currency: "USD";
  paypal: {
    orderId?: string; authorizationId?: string; authorizedCents?: number; authExpiresAt?: string;
    captureId?: string; capturedCents?: number; voided?: boolean; refunds: { id: string; cents: number; reason: string; at: string }[];
  };
  approvals: Approval[]; timeline: AgentStep[]; ledger: LedgerEvent[];
  issues: { id: string; lineId: string; note: string; cents: number; status: "open" | "refunding" | "refunded" | "rejected"; at: string }[];
  /** Set while a settlement is in flight. The order accepts no other change until PayPal has answered. */
  settling?: { approvalId: string; totalCents: number; releaseCents: number; action: "capture" | "void"; at: string };
  photoCount?: number;
}

export interface SettlementLine { lineId: string; label: string; qty: number; chargeCents: number; basis: "picked" | "substituted" | "removed"; note: string }
export interface Settlement {
  ready: boolean; blockers: string[]; lines: SettlementLine[]; totalCents: number; authorizedCents: number;
  releaseCents: number; action: "capture" | "void"; hash: string;
}
