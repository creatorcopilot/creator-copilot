const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Map Stripe price IDs to tier names
// Replace these with your actual Stripe price IDs from your dashboard
const PRICE_TO_TIER = {
  'price_tier1_monthly': 'tier1_monthly',
  'price_tier1_annual': 'tier1_annual',
  'price_tier2_monthly': 'tier2_monthly',
  'price_tier2_annual': 'tier2_annual',
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature failed:', err.message);
    return res.status(400).json({ error: 'Webhook signature verification failed' });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email;
    const priceId = session.line_items?.data[0]?.price?.id;
    const tier = PRICE_TO_TIER[priceId] || 'tier1_monthly';
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;

    if (!email) {
      return res.status(400).json({ error: 'No email in session' });
    }

    // Check if client already exists (came from demo builder)
    const { data: existing } = await supabase
      .from('clients')
      .select('*')
      .eq('email', email)
      .single();

    if (existing) {
      // Update existing demo client to paid tier
      await supabase
        .from('clients')
        .update({
          tier,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          status: 'active',
        })
        .eq('email', email);
    } else {
      // Create new client record
      await supabase
        .from('clients')
        .insert({
          email,
          tier,
          stripe_customer_id: stripeCustomerId,
          stripe_subscription_id: stripeSubscriptionId,
          status: 'active',
        });
    }

    // Determine redirect URL based on tier
    const redirectUrl = tier.startsWith('tier2')
      ? `https://creatorcopilot.org/intake?tier=2&email=${encodeURIComponent(email)}`
      : `https://creatorcopilot.org/intake?tier=1&email=${encodeURIComponent(email)}`;

    console.log(`New client created: ${email} on ${tier}`);
  }

  if (event.type === 'customer.subscription.deleted') {
    const subscription = event.data.object;
    await supabase
      .from('clients')
      .update({ status: 'cancelled' })
      .eq('stripe_subscription_id', subscription.id);
  }

  return res.status(200).json({ received: true });
}

export const config = {
  api: { bodyParser: false }
};
