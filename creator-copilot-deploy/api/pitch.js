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

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const { data: recentPitch } = await supabase.from('pitch_history').select('id,created_at').eq('client_email', clientEmail).eq('brand_name', brandName).gte('created_at', ninetyDaysAgo.toISOString()).single();

    if (recentPitch) {
      return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Cooldown active', message: `You pitched ${brandName} recently. Wait 90 days before pitching again.` }) };
    }

    const prompt = `Generate a brand pitch email using Blake's framework.
Creator: ${client.name}, Niche: ${client.niche}, Style: ${client.content_style}
Fingerprint: ${client.content_fingerprint}
Brand to pitch: ${brandName}
Rules: Idea first, under 150 words, subject line leads with concept not creator name.
Return JSON: { subject, body, followUp1, followUp2, followUp3, circleBack }`;

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
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: clientEmail,
      subject: `Your ${brandName} pitch is ready — copy and send`,
      html: `<div style="font-family:Arial;background:#06060F;color:#F4F4EF;padding:40px 24px;max-width:600px;margin:0 auto">
        <h2>Your ${brandName} pitch is ready, ${firstName}.</h2>
        <p>Copy the email below and send it.</p>
        <div style="background:#0E0E1C;border-left:4px solid #FF2424;padding:20px;margin:16px 0">
          <strong>Subject:</strong> ${pitchResult.subject}<br><br>
          ${pitchResult.body}
        </div>
        <p><strong>Follow-up schedule:</strong><br>
        Day 3-4: ${pitchResult.followUp1}<br>
        Day 8-11: ${pitchResult.followUp2}<br>
        Day 18-21: ${pitchResult.followUp3}<br>
        Day 45-60: ${pitchResult.circleBack}</p>
      </div>`
    });

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true, pitch: pitchResult }) };
  } catch(error) {
    console.error('Pitch error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
