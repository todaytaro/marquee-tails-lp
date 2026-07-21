import type { Order } from "@/generated/prisma/client";

const PRINTIFY_BASE = "https://api.printify.com/v1";

type TierPrintConfig = {
  blueprintId: string;
  printProviderId: string;
  variantId: string;
};

function configFor(tier: string): TierPrintConfig | null {
  if (tier === "feature") {
    const { PRINTIFY_BLUEPRINT_POSTER, PRINTIFY_PROVIDER_POSTER, PRINTIFY_VARIANT_POSTER } = process.env;
    if (!PRINTIFY_BLUEPRINT_POSTER || !PRINTIFY_PROVIDER_POSTER || !PRINTIFY_VARIANT_POSTER) return null;
    return { blueprintId: PRINTIFY_BLUEPRINT_POSTER, printProviderId: PRINTIFY_PROVIDER_POSTER, variantId: PRINTIFY_VARIANT_POSTER };
  }
  if (tier === "collector") {
    const { PRINTIFY_BLUEPRINT_CANVAS, PRINTIFY_PROVIDER_CANVAS, PRINTIFY_VARIANT_CANVAS } = process.env;
    if (!PRINTIFY_BLUEPRINT_CANVAS || !PRINTIFY_PROVIDER_CANVAS || !PRINTIFY_VARIANT_CANVAS) return null;
    return { blueprintId: PRINTIFY_BLUEPRINT_CANVAS, printProviderId: PRINTIFY_PROVIDER_CANVAS, variantId: PRINTIFY_VARIANT_CANVAS };
  }
  return null; // "digital" or unknown — no physical good
}

/**
 * Submit a print order for the finished poster. Digital-tier orders are a
 * deliberate no-op (no physical good). Missing shipping address or missing
 * Printify config both throw — callers (lib/approvals.ts) must catch and log
 * loudly rather than block delivery, same pattern as the poster-print render.
 */
export async function createPrintifyOrder(order: Order): Promise<{ printifyOrderId: string } | null> {
  const config = configFor(order.tier ?? "");
  if (!config) return null; // digital tier, or Printify not configured yet

  const apiKey = process.env.PRINTIFY_API_KEY;
  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!apiKey || !shopId) throw new Error("Printify not configured (PRINTIFY_API_KEY/PRINTIFY_SHOP_ID missing)");

  if (!order.posterPrintUrl) throw new Error(`Order ${order.id} has no posterPrintUrl to print`);
  if (!order.shippingLine1 || !order.shippingCity || !order.shippingCountry) {
    throw new Error(`Order ${order.id} is missing a shipping address`);
  }

  const [firstName, ...rest] = (order.shippingName ?? "Customer").split(" ");
  const lastName = rest.join(" ") || "-";

  const res = await fetch(`${PRINTIFY_BASE}/shops/${shopId}/orders.json`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "User-Agent": "marquee-tails",
    },
    body: JSON.stringify({
      external_id: order.id, // reconciliation
      label: `Marquee Tails — ${order.petName ?? order.id}`,
      line_items: [
        {
          print_provider_id: Number(config.printProviderId),
          blueprint_id: Number(config.blueprintId),
          variant_id: Number(config.variantId),
          quantity: 1,
          print_areas: {
            front: order.posterPrintUrl,
          },
        },
      ],
      shipping_method: 1, // standard — confirm against the print provider's shipping_methods.json if orders fail
      send_shipping_notification: true,
      address_to: {
        first_name: firstName,
        last_name: lastName,
        email: order.customerEmail,
        address1: order.shippingLine1,
        address2: order.shippingLine2 ?? "",
        city: order.shippingCity,
        region: order.shippingRegion ?? "",
        country: order.shippingCountry,
        zip: order.shippingPostalCode ?? "",
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Printify order failed: ${res.status} ${res.statusText} ${detail}`.trim());
  }
  const data = (await res.json()) as { id: string };
  return { printifyOrderId: data.id };
}
