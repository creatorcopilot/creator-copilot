const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MASTER_REFERENCE } = require('./master-reference');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { clientEmail, brandName, brandData } = req.body;

  if (!clientEmail || !brandName) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Get client profile
    const { data: client } = await supabase
      .from('clients')
      .select('*')
      .eq('email', clientEmail)
      .single();

    if (!client) {
      return res.status(404).json({ error: 'Client not found' });
    }

    // Check pitch history — 90 day cooldown
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const { data: recentPitch } = await supabase
      .from('pitch_history')
      .select('id, created_at')
      .eq('client_email', clientEmail)
      .eq('brand_name', brandName)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .single();

    if (recentPitch) {
      return res.status(400).json({
        error: 'Cooldown active',
        message: `You pitched ${brandName} recently. Wait until ${new Date(new Date(recentPitch.created_at).getTime() + 90 * 24 * 60 * 60 * 1000).toLocaleDateString()} to pitch them again.`
      });
    }

    // Generate pitch email using Blake's framework
    const prompt = `
Generate a brand pitch email for this Creator Copilot client using Blake's pitch framework.

CREATOR PROFILE:
Name: ${client.name}
Niche: ${client.niche}
Content Style: ${client.content_style}
Content Fingerprint: ${client.content_fingerprint}
Micro Audience: ${client.micro_audience}
Platforms: ${JSON.stringify(client.platforms)}
Differentiator: ${client.differentiator}

BRAND TO PITCH: ${brandName}
BRAND DATA: ${JSON.stringify(brandData || {})}

BLAKE'S PITCH RULES:
- Lead with the IDEA — something they can picture going live
- Then brand fit — why this specific brand in this creator's world
- Then creator context — brief, specific, relevant
- Stats only if they naturally reinforce the concept
- Under 150 words total
- Subject line leads with the creative concept — never the creator's name
- Written in the creator's Content Fingerprint voice

Return JSON with:
{
  "subject": "Email subject — idea first, under 10 words",
  "body": "Full email under 150 words",
  "followUp1": "Day 3-4 follow-up — 2-3 sentences",
  "followUp2": "Day 8-11 follow-up — adds new angle",
  "followUp3": "Day 18-21 final — leaves door open",
  "circleBack": "Day 45-60 circle back — fresh angle"
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const pitch = JSON.parse(clean);

    // Save to pitch history
    const cooldownUntil = new Date();
    cooldownUntil.setDate(cooldownUntil.getDate() + 90);

    await supabase.from('pitch_history').insert({
      client_id: client.id,
      client_email: clientEmail,
      brand_name: brandName,
      pitch_email: pitch.body,
      cooldown_until: cooldownUntil.toISOString(),
    });

    // Send pitch email to client
    const firstName = client.name?.split(' ')[0] || 'there';
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: clientEmail,
      subject: `Your ${brandName} pitch is ready — copy and send`,
      html: `
<!DOCTYPE html>
<html>
<head><style>
  body { font-family: Arial, sans-serif; background: #06060F; color: #F4F4EF; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
  .logo { font-size: 20px; font-weight: 900; letter-spacing: 4px; color: #F4F4EF; margin-bottom: 32px; }
  .logo span { color: #FF2424; }
  h1 { font-size: 26px; font-weight: 900; margin-bottom: 16px; }
  p { font-size: 15px; line-height: 1.8; color: #8888AA; margin-bottom: 16px; }
  p strong { color: #F4F4EF; }
  .pitch-card { background: #0E0E1C; border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid #FF2424; padding: 24px; margin-bottom: 16px; }
  .label { font-size: 10px; letter-spacing: 3px; color: #FF2424; text-transform: uppercase; margin-bottom: 8px; }
  .content { font-size: 14px; color: #CCCCEE; line-height: 1.8; white-space: pre-wrap; }
  .note { font-size: 12px; color: #444466; font-style: italic; margin-top: 8px; }
  .footer { font-size: 11px; color: #444466; margin-top: 40px; }
</style></head>
<body>
<div class="wrap">
  <div class="logo">CREATOR<span>COPILOT</span></div>
  <h1>Your ${brandName} pitch is ready.</h1>
  <p>Hey ${firstName} — copy the email below, paste it into your email app, and send it to ${brandName}'s partnerships team. Then follow up on the schedule below. That's it.</p>

  <div class="pitch-card">
    <div class="label">Subject Line</div>
    <div class="content">${pitch.subject}</div>
  </div>

  <div class="pitch-card">
    <div class="label">Email Body — copy this</div>
    <div class="content">${pitch.body}</div>
  </div>

  <div class="pitch-card">
    <div class="label">Follow-Up Schedule</div>
    <div class="note">Day 3-4: ${pitch.followUp1}</div>
    <div class="note">Day 8-11: ${pitch.followUp2}</div>
    <div class="note">Day 18-21: ${pitch.followUp3}</div>
    <div class="note">Day 45-60: ${pitch.circleBack}</div>
  </div>

  <p>If you don't follow up, you didn't really pitch. Set a reminder now.</p>
  <p style="color:#FF2424;font-weight:700;">You create. We make you unstoppable.</p>
  <div class="footer">Creator Copilot · marketing@creatorcopilot.org</div>
</div>
</body>
</html>`
    });

    return res.status(200).json({ success: true, pitch });

  } catch (error) {
    console.error('Pitch generator error:', error);
    return res.status(500).json({ error: error.message });
  }
}
