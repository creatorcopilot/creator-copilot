const { createClient } = require('@supabase/supabase-js');
const { Resend } = require('resend');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
const resend = new Resend(process.env.RESEND_API_KEY);
const HEADERS = { 'Content-Type': 'application/json' };

exports.handler = async function(event, context) {
  try {
    // Get all active clients
    const { data: clients, error } = await supabase
      .from('clients')
      .select('*')
      .eq('status', 'active');

    if (error) throw error;
    if (!clients || clients.length === 0) {
      return { statusCode: 200, headers: HEADERS, body: JSON.stringify({ message: 'No active clients' }) };
    }

    console.log(`Processing ${clients.length} clients`);
    const results = [];

    for (const client of clients) {
      try {
        const isTier2 = client.tier && client.tier.includes('tier2');
        const firstName = client.name?.split(' ')[0] || 'there';
        const weekNumber = Math.ceil((new Date() - new Date(client.created_at)) / (7 * 24 * 60 * 60 * 1000));

        // Build the prompt
        const prompt = buildPrompt(client, isTier2, weekNumber);

        // Create a job in Supabase
        const { data: job, error: jobError } = await supabase
          .from('generation_jobs')
          .insert({
            client_email: client.email,
            type: 'weekly',
            status: 'processing',
            prompt: prompt
          })
          .select()
          .single();

        if (jobError) throw jobError;

        // Call Edge Function — it runs with no timeout limit
        const edgeUrl = process.env.SUPABASE_URL + '/functions/v1/generation';
        await fetch(edgeUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
            'apikey': process.env.SUPABASE_ANON_KEY
          },
          body: JSON.stringify({ jobId: job.id, prompt, type: 'weekly' })
        });

        // Poll for result — up to 3 minutes
        const result = await pollForResult(job.id, 180000);

        if (!result) {
          console.log('Timeout waiting for scripts:', client.email);
          continue;
        }

        // Save to deliveries
        await supabase.from('deliveries').insert({
          client_id: client.id,
          client_email: client.email,
          week_number: weekNumber,
          scripts: result.scripts,
          brand_report: result.brandReport || null,
          delivered_at: new Date().toISOString()
        });

        // Send Monday email
        await resend.emails.send({
          from: process.env.FROM_EMAIL,
          to: client.email,
          subject: `Week ${weekNumber} — your scripts start tomorrow morning, ${firstName}`,
          html: buildWeeklyEmail(result, firstName, weekNumber, isTier2, client.email)
        });

        results.push({ email: client.email, status: 'sent' });
        console.log('Weekly delivery complete:', client.email);

      } catch(clientErr) {
        console.error('Failed for', client.email, clientErr.message);
        results.push({ email: client.email, status: 'error', error: clientErr.message });
      }
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ processed: results.length, results })
    };

  } catch(error) {
    console.error('Weekly delivery error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};

async function pollForResult(jobId, maxMs) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    await new Promise(r => setTimeout(r, 5000));
    const { data: job } = await supabase
      .from('generation_jobs')
      .select('status, result')
      .eq('id', jobId)
      .single();

    if (job?.status === 'complete' && job?.result) return job.result;
    if (job?.status === 'error') return null;
  }
  return null;
}

function buildPrompt(client, isTier2, weekNumber) {
  const tier2Extra = isTier2 ? [
    'Also generate:',
    '- inroSetup: { triggerWord, message1, message2, message3 }',
    '- brandReport: { weeklyMarketRead, topBrands: [{name, score, tag, pitchAngle}] }'
  ].join('\n') : '';

  const tier2Keys = isTier2 ? '\n- inroSetup: { triggerWord, message1, message2, message3 }\n- brandReport: { weeklyMarketRead, topBrands: [{name, score, tag, pitchAngle}] }' : '';

  return [
    'You are the Creator Copilot AI. Generate Week ' + weekNumber + ' content for this client.',
    '',
    'CLIENT PROFILE:',
    'Name: ' + client.name,
    'Business: ' + (client.business_name || client.name),
    'Niche: ' + (client.niche || client.category),
    'Category: ' + client.category,
    'Platforms: ' + (client.platforms || 'TikTok, Instagram'),
    'Goal: ' + client.goal,
    'Targeting: ' + (client.targeting || 'anywhere'),
    'Location: ' + (client.location || 'Not specified'),
    'Style: ' + (client.content_style || 'conversational'),
    'Differentiator: ' + (client.differentiator || ''),
    'Off limits: ' + (client.off_limits || 'None'),
    '',
    'INSTRUCTIONS:',
    'Run the research engine first. Search TikTok and Instagram for what content formats are performing best in the ' + client.category + ' niche RIGHT NOW this week.',
    '',
    'Then generate 7 scripts (one per day Monday-Sunday) using dynamic format selection based on your research findings.',
    '',
    'Script format rules:',
    '- Script 1 (Monday): 30-45 seconds personal story format',
    '- Scripts 2-6: 15-17 seconds (3-10-3 format: hook + one value punch + CTA)',
    '- Script 7 (Sunday): 10 seconds max, high pattern-interrupt, designed to spread',
    '- NEVER fabricate personal stories — use [brackets] to prompt their real story',
    '- Each script title should describe what format it is AND why based on research',
    '',
    tier2Extra,
    '',
    'Return ONLY valid JSON with these keys:',
    '- scripts: array of 7 objects, each with: title, hook, structure, cta, tiktok_note, instagram_note, caption' + tier2Keys
  ].join('\n');
}

function buildWeeklyEmail(output, firstName, weekNumber, isTier2, clientEmail) {
  return `<!DOCTYPE html><html><head><style>
    body{font-family:Arial,sans-serif;background:#06060F;color:#F4F4EF;margin:0;padding:0}
    .wrap{max-width:600px;margin:0 auto;padding:40px 24px}
    .logo{font-size:20px;font-weight:900;letter-spacing:4px;margin-bottom:32px}
    .logo span{color:#FF2424}
    h1{font-size:24px;font-weight:900;margin-bottom:16px}
    p{font-size:14px;line-height:1.8;color:#8888AA;margin-bottom:16px}
    p strong{color:#F4F4EF}
    .info-box{background:#0E0E1C;border-left:4px solid rgba(255,36,36,0.3);padding:16px 20px;margin-bottom:16px}
    .info-label{font-family:monospace;font-size:10px;letter-spacing:2px;color:#FF2424;text-transform:uppercase;margin-bottom:4px}
    .brand-card{background:#0E0E1C;border:1px solid rgba(255,255,255,0.08);padding:20px;margin-bottom:12px}
    .brand-name{font-weight:700;font-size:15px;color:#F4F4EF;margin-bottom:4px}
    .brand-tag{font-family:monospace;font-size:10px;color:#FF2424;letter-spacing:1px;margin-bottom:8px}
    .brand-angle{font-size:13px;color:#8888AA;line-height:1.6;margin-bottom:12px}
    .btn-pitch{display:inline-block;background:#FF2424;color:white;font-weight:700;font-size:13px;padding:10px 20px;text-decoration:none}
    .divider{height:1px;background:rgba(255,255,255,0.06);margin:24px 0}
    .footer{font-size:11px;color:#444466;margin-top:40px}
  </style></head><body><div class="wrap">
    <div class="logo">CREATOR<span>COPILOT</span></div>
    <h1>Week ${weekNumber} scripts are on the way.</h1>
    <p>Hey ${firstName} — your scripts for this week are built. They hit your phone every morning at 9am. Read it. Film it. Post it.</p>
    <div class="info-box">
      <div class="info-label">This week</div>
      <p style="margin:0;font-size:13px;color:#8888AA">Mon–Sun · 9am daily · One script per text · Caption and posting instructions included</p>
    </div>
    ${isTier2 && output.brandReport ? `
    <div class="divider"></div>
    <p style="font-size:18px;font-weight:900;color:#F4F4EF;margin-bottom:8px;">This week's brand opportunities.</p>
    <p>${output.brandReport.weeklyMarketRead || ''}</p>
    ${(output.brandReport.topBrands || []).slice(0,5).map(brand => `
    <div class="brand-card">
      <div class="brand-name">${brand.name || ''}</div>
      <div class="brand-tag">${brand.tag || 'Good Money'} · Score: ${brand.score || ''}</div>
      <div class="brand-angle">${brand.pitchAngle || ''}</div>
      <a href="https://creatorcopilot.org/pitch?email=${encodeURIComponent(clientEmail)}&brand=${encodeURIComponent(brand.name || '')}&angle=${encodeURIComponent(brand.pitchAngle || '')}" class="btn-pitch">Generate My Pitch Email →</a>
    </div>`).join('')}
    ` : ''}
    <div class="divider"></div>
    <p>See you in your texts tomorrow morning.</p>
    <p style="color:#FF2424;font-weight:700">You create. We make you unstoppable.</p>
    <div class="footer">Creator Copilot · marketing@creatorcopilot.org</div>
  </div></body></html>`;
}
