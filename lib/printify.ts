import type { Order } from "@/generated/prisma/client";

const PRINTIFY_BASE = "https://api.printify.com/v1";

type TierPrintConfig = {
  blueprintId: string;
  printProviderId: string;
  variantId: string;
};

/**
 * Pass 2 (PRICING-PRODUCT-V2-SPEC.md §5): Printify now fires for a purchased
 * physical ADD-ON (Printed Poster / Gallery Canvas), not at base checkout —
 * neither "preset" nor "custom" ships a physical good on its own. Blueprint/
 * provider/variant IDs come from env, confirmed by the owner during the
 * Phase 5 Printify test. Returns null if the add-on type is unrecognized or
 * its IDs aren't configured yet — same "not configured yet" posture as the
 * rest of the app's optional integrations.
 *
 * Env var names are the ones established in POD-INTEGRATION-SPEC.md §3 and
 * already configured in production — keep them stable so this pass needs no
 * re-keying of the deployment's variables.
 */
function configFor(addonType: string | null): TierPrintConfig | null {
  if (addonType !== "poster" && addonType !== "canvas") return null;
  const env =
    addonType === "poster"
      ? { b: "PRINTIFY_BLUEPRINT_POSTER", p: "PRINTIFY_PROVIDER_POSTER", v: "PRINTIFY_VARIANT_POSTER" }
      : { b: "PRINTIFY_BLUEPRINT_CANVAS", p: "PRINTIFY_PROVIDER_CANVAS", v: "PRINTIFY_VARIANT_CANVAS" };
  const blueprintId = process.env[env.b];
  const printProviderId = process.env[env.p];
  const variantId = process.env[env.v];
  if (!blueprintId || !printProviderId || !variantId) return null;
  return { blueprintId, printProviderId, variantId };
}

/**
 * Submit a print order for the finished poster. A no-op (returns null) if no
 * physical add-on was purchased or Printify isn't configured yet — see
 * configFor above. Missing shipping address or missing Printify config both
 * throw — callers (lib/mocks.ts's createPodOrder) must catch and log loudly
 * rather than block delivery, same pattern as the poster-print render.
 */
export async function createPrintifyOrder(order: Order): Promise<{ printifyOrderId: string } | null> {
  const config = configFor(order.addonType);
  if (!config) return null; // no physical add-on purchased yet, or Printify not configured

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
