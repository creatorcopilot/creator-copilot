const Stripe = require('stripe');
const { createClient } = require('@supabase/supabase-js');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;

  try {
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch(err) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Webhook signature failed' }) };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const email = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripeSubscriptionId = session.subscription;

    if (!email) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'No email' }) };

    const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();

    if (existing) {
      await supabase.from('clients').update({
        tier: 'tier1_monthly',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
      }).eq('email', email);
    } else {
      await supabase.from('clients').insert({
        email, tier: 'tier1_monthly',
        stripe_customer_id: stripeCustomerId,
        stripe_subscription_id: stripeSubscriptionId,
        status: 'active',
      });
    }
  }

  if (stripeEvent.type === 'customer.subscription.deleted') {
    await supabase.from('clients').update({ status: 'cancelled' }).eq('stripe_subscription_id', stripeEvent.data.object.id);
  }

  return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ received: true }) };
};
