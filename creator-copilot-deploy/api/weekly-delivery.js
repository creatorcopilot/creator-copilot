const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MASTER_REFERENCE } = require('./master-reference');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async function(event, context) {
  try {
    const { data: clients } = await supabase.from('clients').select('*, location, goal, targeting').eq('status', 'active').in('tier', ['tier1_monthly','tier1_annual','tier2_monthly','tier2_annual']);

    const results = [];
    for (const client of clients) {
      try {
        const isTier2 = client.tier.includes('tier2');
        const weekNumber = (client.delivery_count || 0) + 1;
        const firstName = client.name?.split(' ')[0] || 'there';

        const prompt = `Generate Week ${weekNumber} content for Creator Copilot client.
Name: ${client.name}, Niche: ${client.niche}, Style: ${client.content_style}
Fingerprint: ${client.content_fingerprint}
Micro audience: ${client.micro_audience}
Off limits: ${client.off_limits || 'None'}
Location: ${client.location || 'Not specified'}
Client targeting scope: ${client.targeting || 'anywhere'}
Local mode: ${client.targeting === 'local' ? 'YES — geo-target every script, caption, and posting instruction for ' + (client.location || 'their local area') : client.targeting === 'both' ? 'MIXED — some scripts local, some broad' : 'NO — broad audience targeting'}
Return JSON: { scripts: array of 7 }

CRITICAL — DYNAMIC FORMAT RULES:
- Generate 7 scripts (one per day Monday through Sunday)
- Do NOT use fixed slot labels like "Reel 1 Value" or "Reel 2 Social Proof"
- Instead: run the research engine first, find what content formats are ACTUALLY PERFORMING in this niche RIGHT NOW
- Then build each script around what the data says works — could be pain point, storytime, hot take, direct offer, POV, day in the life, three mistakes, myth bust, anything
- Each script title should describe what it actually is and WHY based on research: e.g. "Pain Point — comments in this niche are full of this frustration right now"
- One script per day. Mix the formats so the week feels varied not repetitive
- Script 7 (Sunday) is always high pattern-interrupt — designed to spread, not convert
- SCRIPT FORMAT: Reel 1 (day 1) can be longer 30-45 sec personal story. All others 15-17 seconds max.
- NEVER fabricate personal stories. Use [brackets] to prompt their real one.
- Include: title (format + why this week), hook, structure, cta, tiktok_note, instagram_note, caption${isTier2 ? ', brandReport: { weeklyMarketRead, topBrands, pitchEmails }' : ''} }`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 6000,
          system: MASTER_REFERENCE,
          messages: [{ role: 'user', content: prompt }]
        });

        const output = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());

        await supabase.from('deliveries').insert({ client_id: client.id, client_email: client.email, week_number: weekNumber, scripts: output.scripts, brand_report: output.brandReport || null, delivered_at: new Date().toISOString() });
        await supabase.from('clients').update({ delivery_count: weekNumber, last_delivery: new Date().toISOString() }).eq('id', client.id);

        // Monday email — brand deals only. Scripts delivered via daily text.
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: client.email,
          subject: `Week ${weekNumber} — your scripts start tomorrow morning, ${firstName}`,
          html: `<div style="font-family:Arial;background:#06060F;color:#F4F4EF;padding:40px 24px;max-width:600px;margin:0 auto">
            <div style="font-family:monospace;font-size:10px;letter-spacing:3px;color:#FF2424;text-transform:uppercase;margin-bottom:8px;">Week ${weekNumber}</div>
            <h1 style="font-size:28px;font-weight:900;margin-bottom:16px;color:#F4F4EF;">Your scripts are coming.<br>Check your phone.</h1>
            <p style="color:#8888AA;font-size:14px;line-height:1.7;margin-bottom:24px;">Hey ${firstName} — 7 scripts are hitting your phone this week, one every morning at 9am. Read it. Film it. Post it. That is your entire job.</p>
            <div style="background:#0E0E1C;border-left:4px solid rgba(255,36,36,0.3);padding:16px 20px;margin-bottom:28px;">
              <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#6666AA;text-transform:uppercase;margin-bottom:4px;">This week</div>
              <div style="font-size:13px;color:#8888AA;line-height:1.7;">Mon–Sun · 9am daily · One script per text · Caption included · Post settings included</div>
            </div>
            <p style="color:#FF2424;font-weight:700">You create. We make you unstoppable.</p>
          </div>`
        });

        results.push({ email: client.email, status: 'success', week: weekNumber });
      } catch(err) {
        results.push({ email: client.email, status: 'error', error: err.message });
      }
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ processed: clients.length, results }) };
  } catch(error) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
