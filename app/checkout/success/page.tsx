import { getStripeClient } from "@/lib/stripe";

/**
 * Post-checkout landing page. Reachable only via a direct Stripe redirect
 * (no Buy button links here yet — see STRIPE-INTEGRATION-SPEC.md §9).
 *
 * Deliberately does NOT depend on the Order row existing: the webhook that
 * creates it can land after (or race) this redirect, so we read the
 * session straight from Stripe instead of the DB.
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const stripe = getStripeClient();
  const session = stripe && session_id
    ? await stripe.checkout.sessions.retrieve(session_id).catch(() => null)
    : null;
  const email = session?.customer_details?.email;

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-center justify-center px-5 text-center">
      <h1 className="font-display text-3xl uppercase tracking-[0.06em] text-ivory">
        You&rsquo;re in!
      </h1>
      <p className="mt-4 text-muted">
        {email
          ? `We've sent your upload link to ${email}.`
          : "We've sent your upload link to your email."}{" "}
        Check your inbox to send us your pet&rsquo;s photos.
      </p>
    </main>
  );
}
