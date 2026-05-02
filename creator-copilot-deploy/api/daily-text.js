const { createClient } = require('@supabase/supabase-js');
const twilio = require('twilio');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const HEADERS = { 'Content-Type': 'application/json' };

// Day mapping handled inline in handler

exports.handler = async function(event, context) {
  try {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat

    // 7 days a week — no days off
    // Day 0 = Sunday (index 6), Day 1 = Monday (index 0), etc.
    const DAY_TO_SCRIPT_7 = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 0: 6 };
    const scriptIndex = DAY_TO_SCRIPT_7[dayOfWeek];

    // 7 days a week — Sunday through Saturday
    // Get all active clients with phone numbers
    const { data: clients, error } = await supabase
      .from('clients')
      .select('id, name, phone, email, tier, location, goal, targeting, category, created_at, delivery_count')
      .eq('status', 'active')
      .not('phone', 'is', null);

    if (error) throw error;

    console.log(`Sending day ${dayOfWeek} scripts to ${clients.length} clients`);

    const results = [];

    for (const client of clients) {
      try {
        if (!client.phone) continue;

        // Get their most recent delivery
        const { data: delivery } = await supabase
          .from('deliveries')
          .select('scripts')
          .eq('client_email', client.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        // Skip clients who signed up today — their onboarding text already fired from intake.js
        const signupDate = new Date(client.created_at);
        const today = new Date();
        if (signupDate.toDateString() === today.toDateString()) {
          console.log('Skipping ' + client.email + ' — signed up today, scripts start tomorrow');
          continue;
        }

        if (!delivery || !delivery.scripts || !delivery.scripts[scriptIndex]) {
          console.log(`No script found for ${client.email} index ${scriptIndex}`);
          continue;
        }

        const script = delivery.scripts[scriptIndex];
        const firstName = client.name?.split(' ')[0] || 'Hey';

        // Format the text message
        const isLocal = client.targeting === 'local' || client.targeting === 'both';
        const message = formatScriptText(script, firstName, dayOfWeek, client.location, isLocal, client.category);

        // Send via Twilio
        await twilioClient.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: client.phone
        });

        results.push({ email: client.email, status: 'sent', day: dayOfWeek });
        console.log(`Text sent to ${client.email}`);

      } catch(clientErr) {
        console.error(`Failed for ${client.email}:`, clientErr.message);
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

function formatScriptText(script, firstName, dayOfWeek, location, isLocal, category) {
  const dayNames = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const isWeekend = dayOfWeek === 6;

  const hook = script.hook || '';
  const structure = script.structure || '';
  const cta = script.cta || '';
  const title = script.title || '';
  const caption = script.caption || '';
  const tiktokNote = script.tiktok_note || 'Talking to camera. Natural light. One take is fine.';
  const igNote = script.instagram_note || 'Post as Reel. Add to profile grid.';
  const locationLine = isLocal && location
    ? '📍 Tag location: ' + location + '\n🏷 Add topics: ' + (category || 'your niche') + ' near me, ' + location + ' ' + (category || '') + '\n⏰ Post: 6-8am or 5-7pm (local hours)'
    : '⏰ Post: 6-9am or 7-10pm';

  if (isWeekend) {
    return `Creator Copilot 🎬 Saturday — Weekend Post

Make this one go viral.

Hook — say this exactly:
"${hook}"

That's the whole script. One sentence. Say it and stop.

---
How to film:
Straight to camera. Natural light. Slow and confident. No music needed.

---
TikTok: Post between 6-9am or 7-10pm. No template. Sound on.
Instagram: Post as Reel. Add to profile grid.

---
Caption — copy and paste:
${caption}

---
Say it naturally. You can adjust the wording slightly.
Keep the hook exactly as written — that's what stops the scroll.

Film it today and post it 🔥
Reply STOP to unsubscribe`;
  }

  return `Creator Copilot 🎬 ${dayNames[dayOfWeek]}

${title}

Hook — say this first:
"${hook}"

What to say next:
${structure}

CTA — end with this:
${cta}

---
How to film:
${tiktokNote}

---
TikTok: Sound on. No template.\n${locationLine}\nInstagram: Post as Reel. Add to profile grid.

---
Caption — copy and paste:
${caption}

---
Say it naturally in your own words. Change the middle if you need to.
Keep the hook and CTA exactly as written.

Film it today 💪
Reply STOP to unsubscribe`;
}
