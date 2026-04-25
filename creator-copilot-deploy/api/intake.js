const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const { MASTER_REFERENCE } = require('./master-reference');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);

// Master reference imported from master-reference.js

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { answers, hasDemo, clientEmail, path, tier } = req.body;

  if (!clientEmail) {
    return res.status(400).json({ error: 'Missing client email' });
  }

  try {
    // Pull demo profile from Supabase if they did the builder
    let demoReport = null;
    if (hasDemo) {
      const { data: client } = await supabase
        .from('clients')
        .select('demo_report, demo_answers')
        .eq('email', clientEmail)
        .single();
      demoReport = client?.demo_report;
    }

    // Update client record with intake answers
    await supabase
      .from('clients')
      .update({
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
      })
      .eq('email', clientEmail);

    // Build the prompt for Claude
    const clientTier = tier || 'tier1_monthly';
    const isTier2 = clientTier.includes('tier2');

    const prompt = `
New Creator Copilot client setup. Generate their complete onboarding output.

CLIENT TIER: ${isTier2 ? 'TIER 2 — ALL INCLUSIVE' : 'TIER 1 — CONTENT ONLY'}

INTAKE FORM ANSWERS:
Name: ${answers.contact?.name}
Email: ${clientEmail}
Type: ${answers.type}
Stage: ${answers.stage}
Primary Goal: ${answers.goal}
What they do: ${answers.what}
Category: ${answers.category}
Content Style: ${answers.style}
Differentiator: ${answers.different}
Link: ${answers.link || 'None yet'}
Brand experience: ${answers.brands}
Brand wishlist: ${answers.brandwish || 'Not specified'}
Off limits: ${answers.offlimits || 'None specified'}
Month 3 win: ${answers.win}

${demoReport ? `DEMOGRAPHIC BUILDER PROFILE (already on file):
Who they are: ${demoReport.who}
Psychology: ${demoReport.psychology}
Language that stops scroll: ${demoReport.language}
Where they live online: ${demoReport.where}
Brands that want them: ${demoReport.brands}
Most powerful hook: ${demoReport.hook}` : `AUDIENCE: ${answers.audience?.type === 'known' ? answers.audience.description : 'Build from intake answers'}`}

Generate the following as a JSON object with these exact keys:
{
  "creatorPersonality": "3-4 sentence profile of who this creator is, their voice, their energy, and what makes them specific",
  "microAudience": "The exact micro-audience signal phrase and 2-3 sentence psychological profile",
  "contentFingerprint": "5-7 specific voice rules for this creator — sentence style, vocabulary, POV, what to always do, what to never do",
  "competitivePosition": "Their lead differentiator and how it gets reinforced in content every week",
  "scripts": [
    {
      "title": "Reel 1 — Personal/Capture",
      "hook": "The exact opening line",
      "script": "Full script with natural line breaks",
      "cta": "Specific CTA for this post",
      "tiktok_note": "One line posting instruction for TikTok",
      "instagram_note": "One line posting instruction for Instagram",
      "caption": "Ready to post caption with hashtags"
    },
    { "title": "Reel 2 — Value/Education", "hook": "...", "script": "...", "cta": "...", "tiktok_note": "...", "instagram_note": "...", "caption": "..." },
    { "title": "Reel 3 — Social Proof", "hook": "...", "script": "...", "cta": "...", "tiktok_note": "...", "instagram_note": "...", "caption": "..." },
    { "title": "Reel 4 — Flex", "hook": "...", "script": "...", "cta": "...", "tiktok_note": "...", "instagram_note": "...", "caption": "..." },
    { "title": "Reel 5 — Flex", "hook": "...", "script": "...", "cta": "...", "tiktok_note": "...", "instagram_note": "...", "caption": "..." },
    { "title": "Weekend Post — Viral", "hook": "...", "script": "...", "cta": "...", "tiktok_note": "...", "instagram_note": "...", "caption": "..." }
  ]${isTier2 ? `,
  "inroSetup": {
    "triggerWord": "The recommended trigger word for their offer",
    "message1": "Immediate DM — warm, delivers their offer/link, asks one qualifying question",
    "message2": "24-hour follow-up — short and warm",
    "message3": "3-day follow-up — genuinely useful tip, not a sales push"
  },
  "brandReport": {
    "weeklyMarketRead": "2-3 sentences on what categories are spending in their niche this week",
    "topBrands": [
      {
        "name": "Brand name",
        "score": "X.X/10",
        "tag": "Good Money / Strategic Money / Proceed with Caution",
        "whySpending": "Why they are spending now",
        "whyFit": "Why they fit this specific creator",
        "pitchAngle": "Specific content concept ready to visualize",
        "dealStructure": "Likely deal structure",
        "budgetTier": "Estimated budget range",
        "redFlags": "Specific risks to watch"
      }
    ],
    "pitchEmails": [
      {
        "brand": "Brand name",
        "subject": "Email subject line — idea first",
        "body": "Full pitch email under 150 words — idea, brand fit, creator context, ask",
        "followUp1": "Day 3-4 follow-up",
        "followUp2": "Day 8-11 follow-up",
        "followUp3": "Day 18-21 final follow-up"
      }
    ]
  }` : ''}
}

Return ONLY the JSON object. No preamble. No markdown. No explanation.`;

    // Call Claude
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: MASTER_REFERENCE,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    const clean = text.replace(/```json|```/g, '').trim();
    const output = JSON.parse(clean);

    // Save generated content to Supabase
    await supabase
      .from('clients')
      .update({
        creator_personality: output.creatorPersonality,
        content_fingerprint: output.contentFingerprint,
        competitive_position: output.competitivePosition,
        micro_audience: output.microAudience,
        last_delivery: new Date().toISOString(),
        delivery_count: 1,
      })
      .eq('email', clientEmail);

    // Save first delivery
    await supabase
      .from('deliveries')
      .insert({
        client_email: clientEmail,
        week_number: 1,
        scripts: output.scripts,
        brand_report: output.brandReport || null,
        delivered_at: new Date().toISOString(),
      });

    // Send Week 1 email to client
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: clientEmail,
      subject: `Week 1 is ready — let's go, ${answers.contact?.name?.split(' ')[0]}`,
      html: buildClientEmail(output, answers.contact?.name?.split(' ')[0], isTier2),
    });

    // Send internal brief to operator
    await resend.emails.send({
      from: process.env.FROM_EMAIL,
      to: process.env.NOTIFY_EMAIL,
      subject: `New client setup complete — ${answers.contact?.name} (${isTier2 ? 'Tier 2' : 'Tier 1'})`,
      html: buildInternalEmail(output, answers, clientEmail, isTier2),
    });

    return res.status(200).json({ success: true });

  } catch (error) {
    console.error('Intake processing error:', error);
    return res.status(500).json({ error: 'Failed to process intake form' });
  }
}

function buildClientEmail(output, firstName, isTier2) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #06060F; color: #F4F4EF; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
  .logo { font-size: 20px; font-weight: 900; letter-spacing: 4px; color: #F4F4EF; margin-bottom: 32px; }
  .logo span { color: #FF2424; }
  h1 { font-size: 32px; font-weight: 900; line-height: 1.1; margin-bottom: 16px; }
  h1 em { color: #FF2424; font-style: normal; }
  p { font-size: 15px; line-height: 1.8; color: #8888AA; margin-bottom: 16px; }
  p strong { color: #F4F4EF; }
  .script-card { background: #0E0E1C; border: 1px solid rgba(255,255,255,0.08); border-left: 4px solid #FF2424; padding: 24px; margin-bottom: 16px; }
  .script-num { font-size: 10px; letter-spacing: 3px; color: #FF2424; text-transform: uppercase; margin-bottom: 8px; }
  .script-title { font-size: 16px; font-weight: 700; color: #F4F4EF; margin-bottom: 12px; }
  .hook { font-size: 18px; font-weight: 700; color: #FF2424; margin-bottom: 12px; line-height: 1.4; }
  .script-body { font-size: 14px; color: #AAAACC; line-height: 1.8; white-space: pre-wrap; margin-bottom: 12px; }
  .cta-line { font-size: 13px; color: #666688; margin-bottom: 8px; }
  .note { font-size: 12px; color: #444466; font-style: italic; }
  .caption-box { background: #1A1A2E; padding: 12px 16px; margin-top: 12px; font-size: 12px; color: #6666AA; }
  .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 32px 0; }
  .footer { font-size: 11px; color: #444466; margin-top: 40px; }
</style></head>
<body>
<div class="wrap">
  <div class="logo">CREATOR<span>COPILOT</span></div>

  <h1>Your Week 1 is <em>ready.</em></h1>
  <p>Hey ${firstName || 'there'} — we've done the research, built your strategy, and written your first week of content. Everything below is ready to film. You don't need to change anything — just pick up your phone and go.</p>
  <p><strong>The only rule: film all five this week.</strong> Don't overthink it. Don't wait for perfect lighting. The content is built to work. Trust it.</p>

  <div class="divider"></div>

  ${output.scripts.map((s, i) => `
  <div class="script-card">
    <div class="script-num">Script ${i + 1}</div>
    <div class="script-title">${s.title}</div>
    <div class="hook">"${s.hook}"</div>
    <div class="script-body">${s.script}</div>
    <div class="cta-line">→ CTA: ${s.cta}</div>
    <div class="note">TikTok: ${s.tiktok_note}</div>
    <div class="note">Instagram: ${s.instagram_note}</div>
    <div class="caption-box">${s.caption}</div>
  </div>`).join('')}

  ${isTier2 && output.inroSetup ? `
  <div class="divider"></div>
  <h2 style="font-size:22px;font-weight:900;margin-bottom:16px;">Your Instagram automation is being set up.</h2>
  <p>Your comment trigger word is <strong>${output.inroSetup.triggerWord}</strong>. Use it in your CTAs — "comment ${output.inroSetup.triggerWord} and I'll send you everything." We'll handle the rest.</p>
  ` : ''}

  ${isTier2 && output.brandReport ? `
  <div class="divider"></div>
  <h2 style="font-size:22px;font-weight:900;margin-bottom:8px;">This week's brand opportunity.</h2>
  <p>${output.brandReport.weeklyMarketRead}</p>
  <p><strong>Your top pitch this week is below. Copy it. Send it. That's it.</strong></p>
  ${output.brandReport.pitchEmails?.[0] ? `
  <div class="script-card">
    <div class="script-num">Brand Pitch — ${output.brandReport.pitchEmails[0].brand}</div>
    <div class="script-title">Subject: ${output.brandReport.pitchEmails[0].subject}</div>
    <div class="script-body">${output.brandReport.pitchEmails[0].body}</div>
    <div class="note">Follow-up Day 3-4: ${output.brandReport.pitchEmails[0].followUp1}</div>
    <div class="note">Follow-up Day 8-11: ${output.brandReport.pitchEmails[0].followUp2}</div>
    <div class="note">Follow-up Day 18-21: ${output.brandReport.pitchEmails[0].followUp3}</div>
  </div>` : ''}
  ` : ''}

  <div class="divider"></div>
  <p>Your next delivery lands next Monday. In the meantime — film, post, and let the system work.</p>
  <p style="color:#FF2424;font-weight:700;">You create. We make you unstoppable.</p>
  <div class="footer">Creator Copilot · marketing@creatorcopilot.org · creatorcopilot.org</div>
</div>
</body>
</html>`;
}

function buildInternalEmail(output, answers, email, isTier2) {
  return `
<h2>New Client Setup Complete</h2>
<p><strong>Name:</strong> ${answers.contact?.name}</p>
<p><strong>Email:</strong> ${email}</p>
<p><strong>Tier:</strong> ${isTier2 ? 'Tier 2 — All Inclusive' : 'Tier 1 — Content'}</p>
<p><strong>Niche:</strong> ${answers.what}</p>
<p><strong>Goal:</strong> ${answers.goal}</p>
<p><strong>Month 3 Win:</strong> ${answers.win}</p>
<hr>
<h3>Creator Personality</h3>
<p>${output.creatorPersonality}</p>
<h3>Micro Audience</h3>
<p>${output.microAudience}</p>
<h3>Content Fingerprint</h3>
<p>${output.contentFingerprint}</p>
<h3>Competitive Position</h3>
<p>${output.competitivePosition}</p>
${isTier2 && output.brandReport ? `<h3>Top Brand This Week</h3><p>${output.brandReport.topBrands?.[0]?.name} — ${output.brandReport.topBrands?.[0]?.pitchAngle}</p>` : ''}
`;
}
