const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const MASTER_REFERENCE = `You are the Creator Copilot content intelligence system.
Generate weekly content that sounds exactly like the creator based on their fingerprint.
Every script must pass: FaceTime rule, scroll-stop test, retention arc, fingerprint test.
Never use banned phrases: game changer, life changing, amazing, incredible, journey, authentic.
Return valid JSON only.`;

export default async function handler(req, res) {
  // Verify this is called by Vercel cron (or manually triggered)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && req.method !== 'GET') {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .in('tier', ['tier1_monthly', 'tier1_annual', 'tier2_monthly', 'tier2_annual']);

    if (error) throw error;

    console.log(`Processing ${clients.length} active clients`);

    const results = [];

    for (const client of clients) {
      try {
        const isTier2 = client.tier.includes('tier2');
        const weekNumber = (client.delivery_count || 0) + 1;

        // Build weekly prompt
        const prompt = `
Generate Week ${weekNumber} content for this Creator Copilot client.

CREATOR PROFILE:
Name: ${client.name}
Niche: ${client.niche}
Category: ${client.category}
Goal: ${client.goal}
Content Style: ${client.content_style}
Off Limits: ${client.off_limits || 'None'}

CREATOR PERSONALITY:
${client.creator_personality}

CONTENT FINGERPRINT:
${client.content_fingerprint}

MICRO AUDIENCE:
${client.micro_audience}

COMPETITIVE POSITION:
${client.competitive_position}

Generate 6 scripts (5 reels + 1 weekend post) following the weekly structure.
${isTier2 ? 'Also generate a brand deal report with top 5 opportunities this week and 1 ready-to-send pitch email.' : ''}

Return as JSON with keys: scripts (array of 6), ${isTier2 ? 'brandReport' : ''}
Each script: title, hook, script, cta, tiktok_note, instagram_note, caption
${isTier2 ? 'brandReport: weeklyMarketRead, topBrands (array), pitchEmails (array of 1)' : ''}`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 6000,
          system: MASTER_REFERENCE,
          messages: [{ role: 'user', content: prompt }]
        });

        const text = response.content[0].text;
        const clean = text.replace(/```json|```/g, '').trim();
        const output = JSON.parse(clean);

        // Save delivery to Supabase
        await supabase.from('deliveries').insert({
          client_id: client.id,
          client_email: client.email,
          week_number: weekNumber,
          scripts: output.scripts,
          brand_report: output.brandReport || null,
          delivered_at: new Date().toISOString(),
        });

        // Update client delivery count
        await supabase
          .from('clients')
          .update({
            delivery_count: weekNumber,
            last_delivery: new Date().toISOString(),
          })
          .eq('id', client.id);

        // Build and send the Monday email
        const firstName = client.name?.split(' ')[0] || 'there';
        const emailHtml = buildWeeklyEmail(output, firstName, weekNumber, isTier2);

        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: client.email,
          subject: `Week ${weekNumber} is ready — ${firstName}, let's go`,
          html: emailHtml,
        });

        results.push({ email: client.email, status: 'success', week: weekNumber });
        console.log(`Delivered Week ${weekNumber} to ${client.email}`);

      } catch (clientError) {
        console.error(`Failed for ${client.email}:`, clientError);
        results.push({ email: client.email, status: 'error', error: clientError.message });
      }
    }

    return res.status(200).json({
      processed: clients.length,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Weekly delivery error:', error);
    return res.status(500).json({ error: error.message });
  }
}

function buildWeeklyEmail(output, firstName, weekNumber, isTier2) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #06060F; color: #F4F4EF; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
  .logo { font-size: 20px; font-weight: 900; letter-spacing: 4px; color: #F4F4EF; margin-bottom: 32px; }
  .logo span { color: #FF2424; }
  h1 { font-size: 28px; font-weight: 900; margin-bottom: 16px; }
  h1 em { color: #FF2424; font-style: normal; }
  p { font-size: 15px; line-height: 1.8; color: #8888AA; margin-bottom: 16px; }
  p strong { color: #F4F4EF; }
  .script-card { background: #0E0E1C; border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid #FF2424; padding: 24px; margin-bottom: 16px; }
  .script-num { font-size: 10px; letter-spacing: 3px; color: #FF2424; text-transform: uppercase; margin-bottom: 8px; }
  .script-title { font-size: 16px; font-weight: 700; color: #F4F4EF; margin-bottom: 12px; }
  .hook { font-size: 18px; font-weight: 700; color: #FF2424; margin-bottom: 12px; }
  .script-body { font-size: 14px; color: #AAAACC; line-height: 1.8; white-space: pre-wrap; margin-bottom: 12px; }
  .note { font-size: 12px; color: #444466; font-style: italic; margin-bottom: 4px; }
  .caption-box { background: #1A1A2E; padding: 12px 16px; margin-top: 12px; font-size: 12px; color: #6666AA; }
  .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 32px 0; }
  .footer { font-size: 11px; color: #444466; margin-top: 40px; }
</style></head>
<body>
<div class="wrap">
  <div class="logo">CREATOR<span>COPILOT</span></div>
  <h1>Week ${weekNumber} is <em>ready.</em></h1>
  <p>Hey ${firstName} — this week's content is built, researched, and ready to film. Five scripts below. Film them whenever you have ten minutes. Post them. That's your whole job this week.</p>

  <div class="divider"></div>

  ${output.scripts.map((s, i) => `
  <div class="script-card">
    <div class="script-num">Script ${i + 1}</div>
    <div class="script-title">${s.title}</div>
    <div class="hook">"${s.hook}"</div>
    <div class="script-body">${s.script}</div>
    <div class="note">→ CTA: ${s.cta}</div>
    <div class="note">TikTok: ${s.tiktok_note}</div>
    <div class="note">Instagram: ${s.instagram_note}</div>
    <div class="caption-box">${s.caption}</div>
  </div>`).join('')}

  ${isTier2 && output.brandReport ? `
  <div class="divider"></div>
  <h2 style="font-size:20px;font-weight:900;margin-bottom:8px;">This week's brand pitch.</h2>
  <p>${output.brandReport.weeklyMarketRead}</p>
  ${output.brandReport.pitchEmails?.[0] ? `
  <div class="script-card">
    <div class="script-num">Pitch — ${output.brandReport.pitchEmails[0].brand}</div>
    <div class="script-title">Subject: ${output.brandReport.pitchEmails[0].subject}</div>
    <div class="script-body">${output.brandReport.pitchEmails[0].body}</div>
    <div class="note">Follow-up Day 3-4: ${output.brandReport.pitchEmails[0].followUp1}</div>
    <div class="note">Follow-up Day 8-11: ${output.brandReport.pitchEmails[0].followUp2}</div>
    <div class="note">Follow-up Day 18-21: ${output.brandReport.pitchEmails[0].followUp3}</div>
  </div>` : ''}
  ` : ''}

  <div class="divider"></div>
  <p>See you next Monday.</p>
  <p style="color:#FF2424;font-weight:700;">You create. We make you unstoppable.</p>
  <div class="footer">Creator Copilot · marketing@creatorcopilot.org · Unsubscribe</div>
</div>
</body>
</html>`;
}
