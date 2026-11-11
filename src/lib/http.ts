import { PayPalError } from "./paypal";
import { ServiceError } from "./service";

export function fail(e: unknown): Response {
  if (e instanceof ServiceError) return Response.json({ error: e.code, message: e.message }, { status: e.http });
  if (e instanceof PayPalError) return Response.json({ error: e.name, message: e.message, paypalDebugId: e.debugId }, { status: e.status === 503 ? 503 : 502 });
  const msg = e instanceof Error ? e.message : "";
  if (msg === "ORDER_NOT_FOUND") return Response.json({ error: msg, message: "No such order." }, { status: 404 });
  if (msg === "ORDER_BUSY") return Response.json({ error: msg, message: "The order was being updated. Try again." }, { status: 409 });
  console.error("unhandled", e);
  return Response.json({ error: "INTERNAL", message: "Something went wrong on our side." }, { status: 500 });
}
