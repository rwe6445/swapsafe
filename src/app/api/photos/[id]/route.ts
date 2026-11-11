import { getStore } from "@/lib/store";
export const dynamic = "force-dynamic";
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^up_[a-f0-9]{16}$/.test(id)) return new Response("Not found", { status: 404 });
  const photo = await getStore().getPhoto(id);
  if (!photo) return new Response("Not found", { status: 404 });
  return new Response(Buffer.from(photo.bytes), { headers: { "Content-Type": photo.mediaType, "Cache-Control": "public, max-age=86400, immutable", "Content-Security-Policy": "default-src 'none'" } });
}
