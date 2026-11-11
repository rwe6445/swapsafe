/** Best-effort per-IP limiter (per server instance). It protects a public demo from being used to burn the AI key. */
const hits = new Map<string, { n: number; reset: number }>();
export function rateLimit(req: Request, bucket: string, perMinute: number): Response | null {
  const ip = (req.headers.get("x-forwarded-for") ?? "local").split(",")[0].trim();
  const key = `${bucket}:${ip}`, now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < now) { hits.set(key, { n: 1, reset: now + 60_000 }); if (hits.size > 5000) hits.clear(); return null; }
  if (++cur.n > perMinute) return Response.json({ error: "RATE_LIMITED", message: "Too many requests. Try again in a minute." }, { status: 429, headers: { "Retry-After": "60" } });
  return null;
}

export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
/** Check the real file type from its first bytes, not the name or the declared type. */
export function sniffImage(bytes: Uint8Array): "image/jpeg" | "image/png" | "image/webp" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return "image/webp";
  return null;
}
