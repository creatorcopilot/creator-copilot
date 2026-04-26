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

  const { answers, hasDemo, clientEmail, path, tier } = body;
  if (!clientEmail) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing email' }) };

  try {
    let demoReport = null;
    if (hasDemo) {
      const { data: client } = await supabase.from('clients').select('demo_report').eq('email', clientEmail).single();
      demoReport = client?.demo_report;
    }

    await supabase.from('clients').update({
      name: answers.contact?.name,
      phone: answers.contact?.phone,
      platforms: answers.platforms,
      client_type: answers.type,
      stage: answers.stage,
      goal: answers.goal,
      niche: answers.what,
      category: answers.category,
      content_style: answers.style,
      differentiator: answers.different,
      link: answers.link,
      brand_experience: answers.brands,
      brand_wishlist: answers.brandwish,
      off_limits: answers.offlimits,
      month3_win: answers.win,
    }).eq('email', clientEmail);

    const isTier2 = (tier || '').includes('tier2');

    const prompt = `New Creator Copilot client. Generate their complete Week 1 setup.

TIER: ${isTier2 ? 'TIER 2 ALL INCLUSIVE' : 'TIER 1 CONTENT ONLY'}
Name: ${answers.contact?.name}
Niche: ${answers.what}
Category: ${answers.category}
Goal: ${answers.goal}
Stage: ${answers.stage}
Style: ${answers.style}
Differentiator: ${answers.different}
Link: ${answers.link || 'None'}
Brand experience: ${answers.brands}
Brand wishlist: ${answers.brandwish || 'Not specified'}
Off limits: ${answers.offlimits || 'None'}
Month 3 win: ${answers.win}
${demoReport ? 'DEMOGRAPHIC PROFILE ON FILE: ' + JSON.stringify(demoReport) : ''}

Return JSON with: creatorPersonality, microAudience, contentFingerprint, competitivePosition, scripts (array of 6 with title/hook/script/cta/tiktok_note/instagram_note/caption)${isTier2 ? ', inroSetup (triggerWord/message1/message2/message3), brandReport (weeklyMarketRead/topBrands/pitchEmails)' : ''}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: MASTER_REFERENCE,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const output = JSON.parse(clean);

    await supabase.from('clients').update({
      creator_personality: output.creatorPersonality,
      content_fingerprint: output.contentFingerprint,
      competitive_position: output.competitivePosition,
      micro_audience: output.microAudience,
      last_delivery: new Date().toISOString(),
      delivery_count: 1,
    }).eq('email', clientEmail);

    await supabase.from('deliveries').insert({
      client_email: clientEmail,
      week_number: 1,
      scripts: output.scripts,
      brand_report: output.brandReport || null,
      delivered_at: new Date().toISOString(),
    });

    const firstName = answers.contact?.name?.split(' ')[0] || 'there';

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: clientEmail,
      subject: `Week 1 is ready — let's go, ${firstName}`,
      html: buildEmail(output, firstName, isTier2),
    });

    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: process.env.NOTIFY_EMAIL,
      subject: `New client: ${answers.contact?.name} (${isTier2 ? 'Tier 2' : 'Tier 1'})`,
      html: `<h2>New client setup complete</h2><p>Name: ${answers.contact?.name}</p><p>Email: ${clientEmail}</p><p>Niche: ${answers.what}</p><p>Goal: ${answers.goal}</p>`,
    });

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };

  } catch(error) {
    console.error('Intake error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

function buildEmail(output, firstName, isTier2) {
  const scripts = output.scripts || [];
  return `<!DOCTYPE html><html><head><style>
    body{font-family:Arial,sans-serif;background:#06060F;color:#F4F4EF;margin:0;padding:0}
    .wrap{max-width:600px;margin:0 auto;padding:40px 24px}
    .logo{font-size:20px;font-weight:900;letter-spacing:4px;margin-bottom:32px}
    .logo span{color:#FF2424}
    h1{font-size:28px;font-weight:900;margin-bottom:16px}
    h1 em{color:#FF2424;font-style:normal}
    p{font-size:15px;line-height:1.8;color:#8888AA;margin-bottom:16px}
    p strong{color:#F4F4EF}
    .card{background:#0E0E1C;border-left:4px solid #FF2424;padding:24px;margin-bottom:16px}
    .num{font-size:10px;letter-spacing:3px;color:#FF2424;text-transform:uppercase;margin-bottom:8px}
    .title{font-size:16px;font-weight:700;margin-bottom:12px}
    .hook{font-size:18px;font-weight:700;color:#FF2424;margin-bottom:12px}
    .script{font-size:14px;color:#AAAACC;line-height:1.8;white-space:pre-wrap;margin-bottom:12px}
    .note{font-size:12px;color:#444466;font-style:italic;margin-bottom:4px}
    .caption{background:#1A1A2E;padding:12px;margin-top:12px;font-size:12px;color:#6666AA}
    .divider{height:1px;background:rgba(255,255,255,0.06);margin:32px 0}
    .footer{font-size:11px;color:#444466;margin-top:40px}
  </style></head><body><div class="wrap">
    <div class="logo">CREATOR<span>COPILOT</span></div>
    <h1>Week 1 is <em>ready.</em></h1>
    <p>Hey ${firstName} — your first week of content is built and ready to film. Five scripts below. Film whenever you have ten minutes. Post them. That is your entire job this week.</p>
    <div class="divider"></div>
    ${scripts.map((s,i) => `<div class="card">
      <div class="num">Script ${i+1}</div>
      <div class="title">${s.title||''}</div>
      <div class="hook">"${s.hook||''}"</div>
      <div class="script">${s.script||''}</div>
      <div class="note">→ CTA: ${s.cta||''}</div>
      <div class="note">TikTok: ${s.tiktok_note||''}</div>
      <div class="note">Instagram: ${s.instagram_note||''}</div>
      <div class="caption">${s.caption||''}</div>
    </div>`).join('')}
    <div class="divider"></div>
    <p>See you next Monday.</p>
    <p style="color:#FF2424;font-weight:700;">You create. We make you unstoppable.</p>
    <div class="footer">Creator Copilot · marketing@creatorcopilot.org</div>
  </div></body></html>`;
}
