const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MASTER_REFERENCE } = require('./master-reference');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event, context) {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { clientEmail, brandName, brandData } = body;
  if (!clientEmail || !brandName) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing fields' }) };

  try {
    const { data: client } = await supabase.from('clients').select('*').eq('email', clientEmail).single();
    if (!client) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Client not found' }) };

    // ── WEEKLY LIMIT — one pitch per week ────────────────────────
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    weekStart.setHours(0, 0, 0, 0);

    const { data: thisWeekPitch } = await supabase
      .from('pitch_history')
      .select('id, brand_name, created_at')
      .eq('client_email', clientEmail)
      .gte('created_at', weekStart.toISOString())
      .single()
      .catch(() => ({ data: null }));

    if (thisWeekPitch) {
      const now = new Date();
      const nextMonday = new Date();
      nextMonday.setDate(now.getDate() + (8 - now.getDay()) % 7 || 7);
      nextMonday.setHours(8, 0, 0, 0);
      const daysUntil = Math.ceil((nextMonday - now) / (1000 * 60 * 60 * 24));
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({
        error: 'weekly_limit',
        pitchedBrand: thisWeekPitch.brand_name,
        daysUntil,
        message: 'You already pitched ' + thisWeekPitch.brand_name + ' this week. One pitch per week done right beats five rushed ones. Your next pitch unlocks in ' + daysUntil + ' day' + (daysUntil === 1 ? '' : 's') + '.'
      })};
    }

    // ── 90-DAY BRAND COOLDOWN ─────────────────────────────────
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { data: recentPitch } = await supabase
      .from('pitch_history')
      .select('id, created_at')
      .eq('client_email', clientEmail)
      .eq('brand_name', brandName)
      .gte('created_at', ninetyDaysAgo.toISOString())
      .single()
      .catch(() => ({ data: null }));

    if (recentPitch) {
      const cooldownEnd = new Date(new Date(recentPitch.created_at).getTime() + 90 * 24 * 60 * 60 * 1000);
      const daysLeft = Math.ceil((cooldownEnd - new Date()) / (1000 * 60 * 60 * 24));
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({
        error: 'brand_cooldown',
        message: 'You pitched ' + brandName + ' recently. You can pitch them again in ' + daysLeft + ' days with a fresh angle.',
        cooldownEnd: cooldownEnd.toISOString()
      })};
    }

    const prompt = `Generate a brand pitch email using Blake's framework.
Creator: ${client.name}, Niche: ${client.niche}, Style: ${client.content_style}
Fingerprint: ${client.content_fingerprint}
Brand to pitch: ${brandName}
Pitch angle: ${brandData?.pitchAngle || ''}

IMPORTANT — also search for the brand's partnerships or creator contact email.
Search: "${brandName} creator partnerships email" or "${brandName} influencer contact"
Common formats: partnerships@brand.com, creators@brand.com, influencer@brand.com

Rules: Idea first, under 150 words, subject line leads with concept not creator name.
Return JSON: {
  subject,
  body,
  contactEmail: "the partnerships email you found or your best guess based on brand domain",
  contactConfidence: "verified" or "estimated",
  followUp1,
  followUp2,
  followUp3,
  circleBack
}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1000,
      system: MASTER_REFERENCE,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const pitchResult = JSON.parse(clean);

    const cooldownUntil = new Date();
    cooldownUntil.setDate(cooldownUntil.getDate() + 90);
    await supabase.from('pitch_history').insert({ client_id: client.id, client_email: clientEmail, brand_name: brandName, pitch_email: pitchResult.body, cooldown_until: cooldownUntil.toISOString() });

    const firstName = client.name?.split(' ')[0] || 'there';
    const contactNote = pitchResult.contactConfidence === 'verified'
      ? `✓ Verified contact`
      : `Estimated — verify before sending`;

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: clientEmail,
      subject: `Your ${brandName} pitch is ready — copy and send`,
      html: `<div style="font-family:Arial;background:#06060F;color:#F4F4EF;padding:40px 24px;max-width:600px;margin:0 auto">
        <div style="font-family:monospace;font-size:10px;letter-spacing:3px;color:#FF2424;text-transform:uppercase;margin-bottom:8px;">Your pitch is ready</div>
        <h2 style="font-size:28px;font-weight:900;margin-bottom:24px;">${brandName}</h2>

        <div style="background:#0E0E1C;border-left:4px solid #00CC66;padding:16px 20px;margin-bottom:16px;">
          <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#00CC66;text-transform:uppercase;margin-bottom:4px;">Send To</div>
          <div style="font-size:16px;font-weight:700;color:#F4F4EF;">${pitchResult.contactEmail || 'partnerships@' + brandName.toLowerCase().replace(/\s/g,'') + '.com'}</div>
          <div style="font-size:11px;color:#6666AA;margin-top:4px;">${contactNote}</div>
        </div>

        <div style="background:#0E0E1C;border-left:4px solid #FF2424;padding:20px;margin-bottom:16px;">
          <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#FF2424;text-transform:uppercase;margin-bottom:8px;">Subject Line</div>
          <div style="font-size:14px;font-weight:700;color:#F4F4EF;">${pitchResult.subject}</div>
        </div>

        <div style="background:#0E0E1C;border-left:4px solid #FF2424;padding:20px;margin-bottom:16px;">
          <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#FF2424;text-transform:uppercase;margin-bottom:8px;">Email Body — Copy and paste this</div>
          <div style="font-size:14px;color:rgba(244,244,239,0.85);line-height:1.8;white-space:pre-wrap;">${pitchResult.body}</div>
        </div>

        <div style="background:#0E0E1C;border-left:4px solid #FF2424;padding:20px;margin-bottom:24px;">
          <div style="font-family:monospace;font-size:10px;letter-spacing:2px;color:#FF2424;text-transform:uppercase;margin-bottom:12px;">Follow-Up Schedule</div>
          <div style="font-size:13px;color:#6666AA;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><strong style="color:#F4F4EF;">Day 3-4:</strong> ${pitchResult.followUp1}</div>
          <div style="font-size:13px;color:#6666AA;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><strong style="color:#F4F4EF;">Day 8-11:</strong> ${pitchResult.followUp2}</div>
          <div style="font-size:13px;color:#6666AA;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><strong style="color:#F4F4EF;">Day 18-21:</strong> ${pitchResult.followUp3}</div>
          <div style="font-size:13px;color:#6666AA;padding:8px 0;"><strong style="color:#F4F4EF;">Day 45-60:</strong> ${pitchResult.circleBack}</div>
        </div>

        <p style="font-size:13px;color:#6666AA;">Set a reminder to follow up. Most deals close on follow-up 2 or 3.</p>
        <p style="color:#FF2424;font-weight:700;font-size:14px;margin-top:16px;">You create. We make you unstoppable.</p>
      </div>`
    });

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, pitch: pitchResult }) };
  } catch(error) {
    console.error('Pitch error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
