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
    // Get all active Tier 2 clients only
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active')
      .in('tier', ['tier2_monthly', 'tier2_annual']);

    if (error) throw error;

    console.log(`Sending monthly reports to ${clients.length} Tier 2 clients`);

    const results = [];
    const monthName = new Date().toLocaleString('default', { month: 'long' });
    const year = new Date().getFullYear();

    for (const client of clients) {
      try {
        const firstName = client.name?.split(' ')[0] || 'there';

        // Generate niche intelligence report using Claude with web search
        const prompt = `Generate a monthly niche intelligence report for this Creator Copilot client.

CLIENT PROFILE:
Name: ${client.name}
Niche: ${client.niche}
Category: ${client.category}
Audience: ${JSON.stringify(client.micro_audience || '')}
Content Fingerprint: ${client.content_fingerprint || ''}
Goal: ${client.goal}
Month: ${monthName} ${year}

RESEARCH PROTOCOL:
1. Search for what content formats are performing best in this niche RIGHT NOW this month
2. Search for trending topics and conversations in this niche this month
3. Search for what hooks and angles are getting the most engagement
4. Identify any shifts in what the algorithm is rewarding in this space

Generate a monthly intelligence report. Return ONLY valid JSON with these keys:
{
  "whatWorking": "2-3 sentences on what content formats and angles are winning in this niche this month — specific and research-driven",
  "trendingTopics": ["topic 1", "topic 2", "topic 3"],
  "hookInsight": "One specific insight about what hooks are stopping the scroll in this niche right now",
  "audienceShift": "Any notable shift in what this audience is talking about or caring about this month — or 'No significant shifts detected this month' if stable",
  "nextMonthAngles": [
    { "title": "Angle 1 title", "why": "Why this will work next month based on research" },
    { "title": "Angle 2 title", "why": "Why this will work next month based on research" },
    { "title": "Angle 3 title", "why": "Why this will work next month based on research" }
  ],
  "algorithmNote": "One specific note about what the algorithm is rewarding in this niche right now"
}`;

        const response = await anthropic.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 2000,
          system: MASTER_REFERENCE,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{ role: 'user', content: prompt }]
        });

        let text = '';
        for (const block of response.content) {
          if (block.type === 'text') text += block.text;
        }

        const clean = text.replace(/```json|```/g, '').trim();
        const report = JSON.parse(clean);

        // Send monthly report email
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: client.email,
          subject: `Your ${monthName} niche intelligence report is ready`,
          html: buildReportEmail(report, firstName, monthName, year, client.niche)
        });

        results.push({ email: client.email, status: 'sent' });
        console.log(`Monthly report sent to ${client.email}`);

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
    console.error('Monthly report error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

function buildReportEmail(report, firstName, monthName, year, niche) {
  return `<!DOCTYPE html>
<html>
<head><style>
  body { font-family: Arial, sans-serif; background: #06060F; color: #F4F4EF; margin: 0; padding: 0; }
  .wrap { max-width: 600px; margin: 0 auto; padding: 40px 24px; }
  .logo { font-size: 20px; font-weight: 900; letter-spacing: 4px; margin-bottom: 8px; }
  .logo span { color: #FF2424; }
  .month-tag { font-family: monospace; font-size: 10px; letter-spacing: 3px; color: #FF2424; text-transform: uppercase; margin-bottom: 32px; display: block; }
  h1 { font-size: 28px; font-weight: 900; margin-bottom: 8px; line-height: 1.1; }
  h1 em { color: #FF2424; font-style: normal; }
  .niche-tag { font-size: 12px; color: #6666AA; margin-bottom: 32px; }
  .section { background: #0E0E1C; border-left: 4px solid #FF2424; padding: 20px 24px; margin-bottom: 16px; }
  .section-label { font-family: monospace; font-size: 10px; letter-spacing: 2px; color: #FF2424; text-transform: uppercase; margin-bottom: 8px; }
  .section-content { font-size: 14px; font-weight: 300; color: rgba(244,244,239,0.85); line-height: 1.7; }
  .topic-pill { display: inline-block; background: rgba(255,36,36,0.1); border: 1px solid rgba(255,36,36,0.2); color: #FF2424; font-size: 12px; padding: 4px 12px; margin: 4px 4px 4px 0; font-family: monospace; letter-spacing: 1px; }
  .angle-card { padding: 14px 0; border-bottom: 1px solid rgba(255,255,255,0.06); }
  .angle-card:last-child { border-bottom: none; }
  .angle-title { font-weight: 700; font-size: 14px; color: #F4F4EF; margin-bottom: 4px; }
  .angle-why { font-size: 13px; font-weight: 300; color: #6666AA; line-height: 1.6; }
  .divider { height: 1px; background: rgba(255,255,255,0.06); margin: 28px 0; }
  .footer { font-size: 11px; color: #444466; margin-top: 40px; }
</style></head>
<body>
<div class="wrap">
  <div class="logo">CREATOR<span>COPILOT</span></div>
  <span class="month-tag">${monthName} ${year} — Niche Intelligence Report</span>

  <h1>What's working in your niche <em>right now.</em></h1>
  <p class="niche-tag">Research compiled for: ${niche}</p>

  <div class="section">
    <div class="section-label">What's Working This Month</div>
    <div class="section-content">${report.whatWorking}</div>
  </div>

  <div class="section">
    <div class="section-label">Trending Topics in Your Niche</div>
    <div class="section-content">
      ${(report.trendingTopics || []).map(t => `<span class="topic-pill">${t}</span>`).join('')}
    </div>
  </div>

  <div class="section">
    <div class="section-label">Hook Intelligence</div>
    <div class="section-content">${report.hookInsight}</div>
  </div>

  <div class="section">
    <div class="section-label">Audience Shift</div>
    <div class="section-content">${report.audienceShift}</div>
  </div>

  <div class="section">
    <div class="section-label">Algorithm Note</div>
    <div class="section-content">${report.algorithmNote}</div>
  </div>

  <div class="section">
    <div class="section-label">Three Angles to Lead With Next Month</div>
    <div class="section-content">
      ${(report.nextMonthAngles || []).map(a => `
        <div class="angle-card">
          <div class="angle-title">${a.title}</div>
          <div class="angle-why">${a.why}</div>
        </div>
      `).join('')}
    </div>
  </div>

  <div class="divider"></div>
  <p style="font-size:14px;color:#8888AA;line-height:1.7;">Your weekly scripts for next month are already being built around these angles. See you Monday.</p>
  <p style="color:#FF2424;font-weight:700;font-size:14px;">You create. We make you unstoppable.</p>
  <div class="footer">Creator Copilot · marketing@creatorcopilot.org · creatorcopilot.org</div>
</div>
</body>
</html>`;
}
