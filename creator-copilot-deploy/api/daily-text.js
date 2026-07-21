const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const HEADERS = { 'Content-Type': 'application/json' };

// Vonage SMS API
async function sendSMS(to, text) {
  const apiKey = process.env.VONAGE_API_KEY;
  const apiSecret = process.env.VONAGE_API_SECRET;
  const from = process.env.VONAGE_PHONE_NUMBER;

  const response = await fetch('https://rest.nexmo.com/sms/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      api_key: apiKey,
      api_secret: apiSecret,
      from: from,
      to: to,
      text: text
    }).toString()
  });

  const data = await response.json();
  const msg = data.messages?.[0];

  if (!msg || msg.status !== '0') {
    throw new Error('Vonage error: ' + (msg?.['error-text'] || 'Unknown error'));
  }

  return data;
}

exports.handler = async function(event, context) {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay();

    // 7 days a week — 0=Sun through 6=Sat
    const DAY_TO_SCRIPT = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    const scriptIndex = DAY_TO_SCRIPT[dayOfWeek];

    // Get all active clients with phone numbers
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, name, business_name, phone, email, tier, location, goal, targeting, category, created_at')
      .eq('status', 'active')
      .not('phone', 'is', null);

    if (error) throw error;

    console.log(`Sending day ${dayOfWeek} scripts to ${clients.length} clients`);
    const results = [];

    for (const client of clients) {
      try {
        if (!client.phone) continue;

        // Skip clients who signed up today — onboarding text already fired
        const signupDate = new Date(client.created_at);
        const todayDate = new Date();
        if (signupDate.toDateString() === todayDate.toDateString()) {
          console.log('Skipping ' + client.email + ' — signed up today');
          continue;
        }

        // Get most recent delivery
        const { data: delivery } = await supabase
          .from('deliveries')
          .select('scripts')
          .eq('client_email', client.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (!delivery || !delivery.scripts || !delivery.scripts[scriptIndex]) {
          console.log('No script found for ' + client.email + ' index ' + scriptIndex);
          continue;
        }

        const script = delivery.scripts[scriptIndex];
        const firstName = client.name?.split(' ')[0] || 'there';
        const businessName = client.business_name || client.name || firstName;
        const isLocal = client.targeting === 'local' || client.targeting === 'both';

        const message = formatScriptText(script, firstName, dayOfWeek, client.location, isLocal, client.category, businessName);

        await sendSMS(client.phone, message);

        results.push({ email: client.email, status: 'sent' });
        console.log('Text sent to ' + client.email);

      } catch(clientErr) {
        console.error('Failed for ' + client.email + ':', clientErr.message);
        results.push({ email: client.email, status: 'error', error: clientErr.message });
      }
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ sent: results.filter(r => r.status === 'sent').length, results })
    };

  } catch(error) {
    console.error('Daily text error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

function formatScriptText(script, firstName, dayOfWeek, location, isLocal, category, businessName) {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isWeekend = dayOfWeek === 0;

  const hook = script.hook || '';
  const structure = script.structure || '';
  const cta = script.cta || '';
  const title = script.title || '';
  const caption = script.caption || '';
  const tiktokNote = script.tiktok_note || 'Talking to camera. Natural light. One take is fine.';

  const locationLine = isLocal && location
    ? '📍 Tag location: ' + location + '\n🏷 Add topics: ' + (category || 'your niche') + ' near me, ' + location
    : '⏰ Post: 6-9am or 7-10pm';

  if (isWeekend) {
    return 'Creator Copilot 🎬 [' + businessName + '] Sunday\n\nWeekend post — make this one go viral.\n\nHook — say this exactly:\n"' + hook + '"\n\nThat\'s the whole script. Say it and stop.\n\n---\nHow to film:\n' + tiktokNote + '\n\n---\nTikTok: Sound on. No template.\n' + locationLine + '\nInstagram: Post as Reel. Add to profile grid.\n\n---\nCaption — copy and paste:\n' + caption + '\n\n---\nSay it naturally. Keep the hook exactly as written.\n\nFilm it today 🔥\nReply STOP to unsubscribe';
  }

  return 'Creator Copilot 🎬 [' + businessName + '] ' + dayNames[dayOfWeek] + '\n\n' + title + '\n\nHook — say this first:\n"' + hook + '"\n\nWhat to say next:\n' + structure + '\n\nCTA — end with this:\n' + cta + '\n\n---\nHow to film:\n' + tiktokNote + '\n\n---\nTikTok: Sound on. No template.\n' + locationLine + '\nInstagram: Post as Reel. Add to profile grid.\n\n---\nCaption — copy and paste:\n' + caption + '\n\n---\nSay it naturally in your own words. Change the middle if you need to.\nKeep the hook and CTA exactly as written.\n\nFilm it today 💪\nReply STOP to unsubscribe';
}
