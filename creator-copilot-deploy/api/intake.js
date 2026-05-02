const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');
const twilio = require('twilio');
const twilio = require('twilio');
const { MASTER_REFERENCE } = require('./master-reference');
const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

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
      location: answers.contact?.location || null,
      targeting: answers.targeting || 'anywhere',
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

    // Look up tier from Supabase — set by Stripe webhook when they paid
    let resolvedTier = tier || 'tier1_monthly';
    try {
      const { data: clientRecord } = await supabase
        .from('clients')
        .select('tier')
        .eq('email', clientEmail)
        .single();
      if (clientRecord?.tier) {
        resolvedTier = clientRecord.tier;
        console.log('Tier from Supabase:', resolvedTier);
      }
    } catch(e) {
      console.log('Using URL tier fallback:', resolvedTier);
    }
    const isTier2 = resolvedTier.includes('tier2');

    const prompt = `New Creator Copilot client. Generate their complete Week 1 setup.

TIER: ${isTier2 ? 'TIER 2 ALL INCLUSIVE' : 'TIER 1 CONTENT ONLY'}
Name: ${answers.contact?.name}
Niche: ${answers.what}
Category: ${answers.category}
Goal: ${answers.goal}
Stage: ${answers.stage}
Location: ${answers.contact?.location || 'Not specified'}
Local service business: ${answers.goal === 'clients' ? 'YES — target local audience' : 'NO — build broad following'}
Style: ${answers.style}
Differentiator: ${answers.different}
Link: ${answers.link || 'None'}
Brand experience: ${answers.brands}
Brand wishlist: ${answers.brandwish || 'Not specified'}
Off limits: ${answers.offlimits || 'None'}
Month 3 win: ${answers.win}
${demoReport ? 'DEMOGRAPHIC PROFILE ON FILE: ' + JSON.stringify(demoReport) : ''}

Return JSON with: creatorPersonality, microAudience, contentFingerprint, competitivePosition, scripts (array of 7)

CRITICAL — DYNAMIC SCRIPT FORMAT:
- Generate 7 scripts (one per day Monday through Sunday)
- Run the research engine first — find what content formats are ACTUALLY PERFORMING in this niche right now
- Build each script around what the live research shows is working — pain points, storytime, hot takes, direct offer, POV, day in the life, myth bust, three mistakes — whatever the data says
- Do NOT use fixed slot labels. Each title should say what it is AND why based on research
- Example title: "Pain Point — this frustration dominates comments in your niche right now"
- Script 1 (Monday) can be 30-45 seconds — personal story format
- Scripts 2-7: 15-17 seconds max — one idea, one punch, one CTA
- Script 7 (Sunday): high pattern-interrupt — designed to spread, not convert
- Every script needs: title, hook, structure, cta, tiktok_note, instagram_note, caption
- NEVER fabricate personal stories. Use [brackets] to prompt their real one.${isTier2 ? ', inroSetup (triggerWord/message1/message2/message3), brandReport (weeklyMarketRead/topBrands/pitchEmails)' : ''}`;

    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
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

    // ── SCHEDULE DAY 2 ONBOARDING TEXT ──────────────────────────
    // Send Instagram optimization text the next morning at 9am
    const phone = answers.contact?.phone;
    if (phone) {
      const isLocal = answers.targeting === 'local' || answers.targeting === 'both';
      const onboardingText = buildOnboardingText(
        firstName,
        answers.category || 'creator',
        answers.goal || 'audience',
        answers.contact?.location || '',
        isLocal,
        answers.link || ''
      );

      // Calculate delay until 9am tomorrow
      const now = new Date();
      const tomorrow9am = new Date();
      tomorrow9am.setDate(tomorrow9am.getDate() + 1);
      tomorrow9am.setHours(9, 0, 0, 0);
      const delayMs = tomorrow9am.getTime() - now.getTime();

      // Schedule via setTimeout (works for delays under 24hrs in Netlify functions)
      // For production reliability this should use a scheduled job
      // For now we send immediately if delay is reasonable, otherwise note it
      if (delayMs < 23 * 60 * 60 * 1000) {
        setTimeout(async () => {
          try {
            await twilioClient.messages.create({
              body: onboardingText,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: phone
            });
            console.log('Onboarding text sent to:', phone);
          } catch(e) {
            console.error('Onboarding text failed:', e.message);
          }
        }, delayMs);
      }
    }

    return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ success: true }) };

  } catch(error) {
    console.error('Intake error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

function buildOnboardingText(firstName, category, goal, location, isLocal, link) {
  const categorySettings = {
    fitness: { accountType: 'Health/Beauty', category: 'Fitness Trainer', topics: 'fitness, workout, health' },
    beauty: { accountType: 'Health/Beauty', category: 'Beauty, Cosmetic & Personal Care', topics: 'beauty, skincare, makeup' },
    food: { accountType: 'Food & Beverage', category: 'Restaurant', topics: 'food, cooking, recipes' },
    music: { accountType: 'Artist', category: 'Musician/Band', topics: 'music, artist, songs' },
    automotive: { accountType: 'Automotive', category: 'Automotive', topics: 'cars, automotive, vehicles' },
    business: { accountType: 'Entrepreneur', category: 'Entrepreneur', topics: 'business, entrepreneur, money' },
    education: { accountType: 'Education', category: 'Education', topics: 'education, learning, tips' },
    lifestyle: { accountType: 'Creator', category: 'Content Creator', topics: 'lifestyle, creator, content' },
  };

  const settings = categorySettings[category] || { accountType: 'Creator', category: 'Content Creator', topics: 'content, creator' };

  const locationLine = isLocal && location
    ? `📍 Add your location: ${location} — this is critical for local discovery`
    : `🌍 Leave location broad — your audience is everywhere`;

  const linkLine = link
    ? `🔗 Your link is set to: ${link} — make sure it works`
    : `🔗 Add a link — website, booking page, or Linktree`;

  const goalLine = goal === 'clients'
    ? `Your goal is getting clients — every setting below makes it easier for local people to find you.`
    : goal === 'branddeals'
    ? `Your goal is landing brand deals — these settings make you look professional to brand teams.`
    : `Your goal is growing your audience — these settings help the algorithm push you to the right people.`;

  return `Creator Copilot 🎬 Day 1 Setup

${goalLine}

Change these RIGHT NOW before you post anything:

— Go to your profile → Edit Profile:
📝 Category: set to "${settings.category}"
🏷 Bio: one sentence — what you do and who you help
${linkLine}

— Go to Settings → Account:
✅ Switch to Professional Account
✅ Account type: ${settings.accountType}

— Go to Settings → Creator/Business:
✅ Turn on Instagram Insights
${locationLine}

— Add to every new post:
🏷 Topics: ${settings.topics}
${isLocal ? `📍 Tag your location every time` : `📌 No location tag needed`}

Takes 3 minutes. Your first script arrives tomorrow morning. 🚀
Reply STOP to unsubscribe`;
}

function buildOnboardingText(firstName, category, goal, location, isLocal, link, isTier2) {
  const cats = {
    fitness: { type: 'Health/Beauty', cat: 'Fitness Trainer', topics: 'fitness, workout, health' },
    beauty: { type: 'Health/Beauty', cat: 'Beauty & Personal Care', topics: 'beauty, skincare, makeup' },
    food: { type: 'Food & Beverage', cat: 'Restaurant', topics: 'food, cooking, recipes' },
    music: { type: 'Artist', cat: 'Musician/Band', topics: 'music, artist, songs' },
    automotive: { type: 'Automotive', cat: 'Automotive', topics: 'cars, automotive, vehicles' },
    business: { type: 'Entrepreneur', cat: 'Entrepreneur', topics: 'business, entrepreneur, money' },
    education: { type: 'Education', cat: 'Education', topics: 'education, learning, tips' },
    lifestyle: { type: 'Creator', cat: 'Content Creator', topics: 'lifestyle, creator, content' },
  };
  const s = cats[category] || cats.lifestyle;
  const locationLine = isLocal && location
    ? '📍 Add your location: ' + location + ' — critical for local discovery'
    : '🌍 Leave location broad — your audience is everywhere';
  const linkLine = link
    ? '🔗 Your link: ' + link + ' — make sure it works'
    : '🔗 Add a link — website, booking page, or Linktree';

  return `Creator Copilot 🎬 Welcome, ${firstName}!

Change these Instagram settings right now — takes 3 minutes:

— Edit Profile:
📝 Category: "${s.cat}"
🏷 Bio: one sentence — what you do and who you help
${linkLine}

— Settings → Account:
✅ Switch to Professional Account
✅ Account type: ${s.type}
✅ Turn on Instagram Insights
${locationLine}

— Add to every post:
🏷 Topics: ${s.topics}
${isLocal ? '📍 Tag your location every time' : ''}

From tomorrow — your script arrives at 9am every single day. Read it. Film it. Post it.
${isTier2 ? 'Your brand deal pitches land in your email every Monday morning.' : 'Upgrade anytime to add weekly brand deal pitches.'}

Let's go. 🚀
Reply STOP to unsubscribe`;
}

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
