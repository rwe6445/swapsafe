import type { Product } from "./types";

/** Demo catalog for a fictional shop. Allergen data here is the shop's own declaration. */
export const SHOP_NAME = "Marigold Corner Market (demo shop)";

const p = (sku: string, name: string, brand: string, size: string, priceCents: number, category: string,
  allergens: Product["allergens"], mayContain: Product["mayContain"], diets: Product["diets"]): Product =>
  ({ sku, name, brand, size, priceCents, category, allergens, mayContain, diets, labelImage: `/labels/${sku}.png` });

export const CATALOG: Product[] = [
  p("oat-milk-1l", "Oat Drink Original", "Fernhill", "1 L", 399, "plant-milk", [], [], ["vegetarian", "vegan"]),
  p("almond-milk-1l", "Almond Drink Unsweetened", "Fernhill", "1 L", 429, "plant-milk", ["tree_nuts"], [], ["vegetarian", "vegan"]),
  p("soy-milk-1l", "Soy Drink Classic", "Tidewell", "1 L", 349, "plant-milk", ["soy"], [], ["vegetarian", "vegan"]),
  p("granola-oat-500", "Oat & Honey Granola", "Brightfield", "500 g", 549, "cereal", ["wheat"], ["tree_nuts"], ["vegetarian"]),
  p("granola-nut-500", "Peanut Crunch Granola", "Brightfield", "500 g", 499, "cereal", ["peanuts", "wheat"], ["tree_nuts"], ["vegetarian"]),
  p("granola-seed-450", "Seed & Berry Granola", "Larkspur", "450 g", 629, "cereal", [], ["sesame"], ["vegetarian", "vegan"]),
  p("pasta-penne-500", "Penne Rigate", "Casa Volta", "500 g", 189, "pasta", ["wheat"], ["egg"], ["vegetarian", "vegan"]),
  p("pasta-gf-400", "Gluten-Free Penne (corn & rice)", "Casa Volta", "400 g", 329, "pasta", [], [], ["vegetarian", "vegan"]),
  p("pesto-190", "Basil Pesto", "Orto Verde", "190 g", 449, "sauce", ["milk", "tree_nuts"], [], ["vegetarian"]),
  p("pesto-vegan-180", "Vegan Basil Pesto", "Orto Verde", "180 g", 479, "sauce", ["tree_nuts"], [], ["vegetarian", "vegan"]),
  p("tomato-sauce-400", "Tomato & Basil Sauce", "Orto Verde", "400 g", 299, "sauce", [], [], ["vegetarian", "vegan"]),
  p("yogurt-plain-500", "Plain Yogurt", "Meadowlane", "500 g", 359, "yogurt", ["milk"], [], ["vegetarian"]),
  p("yogurt-coconut-400", "Coconut Yogurt Alternative", "Tidewell", "400 g", 449, "yogurt", [], ["tree_nuts"], ["vegetarian", "vegan"]),
  p("bread-wheat-600", "Whole Wheat Loaf", "Hearth & Rye", "600 g", 389, "bread", ["wheat"], ["sesame"], ["vegetarian", "vegan"]),
  p("bread-seeded-550", "Seeded Sourdough", "Hearth & Rye", "550 g", 459, "bread", ["wheat", "sesame"], [], ["vegetarian", "vegan"]),
];

export const bySku = (sku: string) => CATALOG.find((x) => x.sku === sku);
export const sameCategory = (sku: string) => { const a = bySku(sku); return a ? CATALOG.filter((x) => x.category === a.category && x.sku !== sku) : []; };
