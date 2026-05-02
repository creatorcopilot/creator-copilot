const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HEADERS = { 'Content-Type': 'application/json' };

// ── MAP YOUR STRIPE PRICE IDs TO TIERS ───────────────────────────
// Replace these with your actual Stripe price IDs
// Find them in Stripe Dashboard → Products → click each product → copy the Price ID
const PRICE_TIER_MAP = {
  // Content Monthly $149
  'price_1TPxmzGhJomtax1ojXwyJOT0': 'tier1_monthly',
  // Content Annual $1490
  'price_1TPxqtGhJomtax1ooArcxCU0': 'tier1_annual',
  // All Inclusive Monthly $297
  'price_1TPxszGhJomtax1o6hGDsauj': 'tier2_monthly',
  // All Inclusive Annual $2970
  'price_1TPxwYGhJomtax1oSdWk7FFQ': 'tier2_annual',
};

// Fallback detection by amount if price IDs not mapped
function detectTierByAmount(amountTotal) {
  if (amountTotal >= 297000) return 'tier2_annual';   // $2970
  if (amountTotal >= 149000) return 'tier2_monthly';  // $1490 annual or $297 monthly
  if (amountTotal >= 29700) return 'tier2_monthly';   // $297
  return 'tier1_monthly'; // $149
}

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch(err) {
    console.error('Webhook signature failed:', err.message);
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Webhook signature failed' }) };
  }

  // ── PAYMENT SUCCEEDED ─────────────────────────────────────────
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;
    const amountTotal = session.amount_total || 0;

    if (!email) {
      console.error('No email in session');
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'No email' }) };
    }

    // Detect tier from price ID or amount
    let tier = 'tier1_monthly';
    try {
      const lineItems = await stripe.checkout.sessions.listLineItems(session.id);
      const priceId = lineItems.data[0]?.price?.id;
      tier = PRICE_TIER_MAP[priceId] || detectTierByAmount(amountTotal);
      console.log('Price ID:', priceId, '→ Tier:', tier);
    } catch(e) {
      tier = detectTierByAmount(amountTotal);
      console.log('Using amount fallback → Tier:', tier);
    }

    const isTier2 = tier.includes('tier2');

    // Check if client already exists (came from demo builder)
    const { data: existing } = await supabase
      .from('clients')
      .select('id, demo_complete')
      .eq('email', email)
      .single()
      .catch(() => ({ data: null }));

    if (existing) {
      await supabase
        .from('clients')
        .update({
          tier,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          status: 'active',
        })
        .eq('email', email);
      console.log('Updated existing client:', email, tier);
    } else {
      await supabase
        .from('clients')
        .insert({
          email,
          tier,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          status: 'active',
        });
      console.log('Created new client:', email, tier);
    }

    console.log('Payment processed:', email, tier, isTier2 ? 'Tier 2 — All Inclusive' : 'Tier 1 — Content');
  }

  // ── SUBSCRIPTION CANCELLED ────────────────────────────────────
  if (stripeEvent.type === 'customer.subscription.deleted') {
    const subscription = stripeEvent.data.object;
    await supabase
      .from('clients')
      .update({ status: 'cancelled' })
      .eq('stripe_subscription_id', subscription.id);
    console.log('Subscription cancelled:', subscription.id);
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ received: true }) };
};
