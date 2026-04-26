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
    const { data: clients } = await supabase.from('clients').select('*').eq('status', 'active').in('tier', ['tier1_monthly','tier1_annual','tier2_monthly','tier2_annual']);

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
Return JSON: { scripts: array of 6 with title/hook/script/cta/tiktok_note/instagram_note/caption${isTier2 ? ', brandReport: { weeklyMarketRead, topBrands, pitchEmails }' : ''} }`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 6000,
          system: MASTER_REFERENCE,
          messages: [{ role: 'user', content: prompt }]
        });

        const output = JSON.parse(response.content[0].text.replace(/```json|```/g, '').trim());

        await supabase.from('deliveries').insert({ client_id: client.id, client_email: client.email, week_number: weekNumber, scripts: output.scripts, brand_report: output.brandReport || null, delivered_at: new Date().toISOString() });
        await supabase.from('clients').update({ delivery_count: weekNumber, last_delivery: new Date().toISOString() }).eq('id', client.id);

        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: client.email,
          subject: `Week ${weekNumber} is ready — ${firstName}, let's go`,
          html: `<div style="font-family:Arial;background:#06060F;color:#F4F4EF;padding:40px 24px;max-width:600px;margin:0 auto">
            <h1 style="color:#F4F4EF">Week ${weekNumber} is ready.</h1>
            <p style="color:#8888AA">Hey ${firstName} — film these five scripts this week and post them. That is your entire job.</p>
            ${output.scripts.map((s,i) => `<div style="background:#0E0E1C;border-left:4px solid #FF2424;padding:20px;margin:16px 0">
              <div style="color:#FF2424;font-size:11px;letter-spacing:2px">Script ${i+1} — ${s.title}</div>
              <div style="font-size:18px;font-weight:700;color:#FF2424;margin:8px 0">"${s.hook}"</div>
              <div style="color:#AAAACC;white-space:pre-wrap">${s.script}</div>
              <div style="color:#444466;font-size:12px;margin-top:8px">TikTok: ${s.tiktok_note}<br>Instagram: ${s.instagram_note}</div>
              <div style="background:#1A1A2E;padding:10px;margin-top:8px;font-size:12px;color:#6666AA">${s.caption}</div>
            </div>`).join('')}
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
