import { PayPalAgentToolkit } from "@paypal/agent-toolkit/ai-sdk";
import { toValue } from "./policy";
import { paypalBase } from "./paypal";

type ToolkitTool = { description?: string; execute?: (args: unknown, options: unknown) => Promise<unknown> };

/** PayPal Agent Toolkit (1.11.0), limited to the actions SwapSafe uses. The model never receives the refund tool. */
function toolkit(actions: Record<string, Record<string, boolean>>, requestId?: string): Record<string, ToolkitTool> {
  paypalBase(); // sandbox guard
  const t = new PayPalAgentToolkit({
    clientId: process.env.PAYPAL_CLIENT_ID!, clientSecret: process.env.PAYPAL_CLIENT_SECRET!,
    configuration: { actions, context: { sandbox: true, ...(requestId ? { request_id: requestId } : {}) } },
  });
  return t.getTools() as unknown as Record<string, ToolkitTool>;
}
const run = async (tool: ToolkitTool | undefined, args: unknown) => {
  if (!tool?.execute) throw new Error("Agent Toolkit tool is not available");
  const out = await tool.execute(args, { toolCallId: `ss-${Date.now()}`, messages: [] });
  return typeof out === "string" ? safeJson(out) : out;
};
const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return { text: s }; } };

/** Called by server code only, after the refund lock has passed. */
export async function toolkitRefund(captureId: string, cents: number, note: string, requestId: string): Promise<{ refundId: string; status: string }> {
  // The toolkit sends context.request_id as PayPal-Request-Id, so this call and the REST fallback share one idempotency key.
  const tools = toolkit({ payments: { createRefund: true } }, requestId);
  const out = (await run(tools.create_refund, { capture_id: captureId, amount: { currency_code: "USD", value: toValue(cents) }, note_to_payer: note.slice(0, 255) })) as { id?: string; status?: string };
  if (!out?.id) throw new Error("Agent Toolkit create_refund returned no refund id");
  return { refundId: out.id, status: out.status ?? "COMPLETED" };
}

/** Read-only lookups for the shop assistant. */
export function toolkitReaders() {
  const tools = toolkit({ orders: { get: true }, transactions: { list: true }, payments: { getRefunds: true } });
  return {
    names: Object.keys(tools),
    getOrder: (orderId: string) => run(tools.get_order, { id: orderId }),
    getRefund: (refundId: string) => run(tools.get_refund, { refund_id: refundId }),
    listTransactions: (args: Record<string, unknown>) => run(tools.list_transactions, args),
  };
}
