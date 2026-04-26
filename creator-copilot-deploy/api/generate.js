const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');
const { MASTER_REFERENCE } = require('./master-reference');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
};

exports.handler = async function(event, context) {
  // Extend function timeout
  context.callbackWaitsForEmptyEventLoop = false;

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { prompt, email, answers, jobId } = body;

  // ── POLL MODE: check if job is complete ──────────────────────
  if (jobId) {
    try {
      const { data: job } = await supabase
        .from('demo_jobs')
        .select('status, report')
        .eq('id', jobId)
        .single();

      if (!job) return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Job not found' }) };

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ status: job.status, report: job.report })
      };
    } catch(e) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── SUBMIT MODE: create job and start processing ──────────────
  if (!prompt || !email) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing prompt or email' }) };
  }

  // Create job record in Supabase
  const { data: job, error: jobError } = await supabase
    .from('demo_jobs')
    .insert({ email, status: 'processing', answers })
    .select()
    .single();

  if (jobError) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create job' }) };
  }

  const newJobId = job.id;

  // Return job ID immediately so client can start polling
  // Process Claude in background
  processInBackground(newJobId, prompt, email, answers);

  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ jobId: newJobId, status: 'processing' })
  };
};

// ── BACKGROUND PROCESSING ─────────────────────────────────────
async function processInBackground(jobId, prompt, email, answers) {
  try {
    // Call Claude with web search
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: MASTER_REFERENCE + `\n\nYou are running the DEMOGRAPHIC BUILDER system.

RESEARCH PROTOCOL — run before generating the report:
1. Search for the niche the client described to find what content is currently performing
2. Search for the reference creator or brand they named to find their current audience data  
3. Search Reddit and social platforms for communities where this audience gathers

Generate a seven-section demographic report. Return ONLY valid JSON with these exact keys:
- who: Who this audience is right now — age range, life stage, daily reality, specific and detailed
- psychology: Hidden fear, core desire, what they believe about themselves
- language: Exact phrases and hooks that stop this audience mid-scroll — from real research
- where: Specific subreddits, hashtag communities, platforms — from live research
- brands: 3-5 specific brands or categories actively spending to reach this audience
- hook: Single most powerful hook sentence ready to use as a video opening
- strategy: Object with key "angles" — array of exactly 3 objects each with "title" and "why"`,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
      messages: [{ role: 'user', content: prompt }]
    });

    // Extract text from response handling tool use
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') text += block.text;
    }

    // If Claude used tools and needs another turn
    if (!text && response.stop_reason === 'tool_use') {
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed' }));

      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: MASTER_REFERENCE + "\n\nNow generate the seven-section demographic report based on your research. Return ONLY valid JSON with keys: who, psychology, language, where, brands, hook, strategy (object with angles array of 3 objects each with title and why).",
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [
          { role: 'user', content: prompt },
          { role: 'assistant', content: response.content },
          { role: 'user', content: toolResults }
        ]
      });

      for (const block of followUp.content) {
        if (block.type === 'text') text += block.text;
      }
    }

    // Parse report
    const clean = text.replace(/```json|```/g, '').trim();
    const report = JSON.parse(clean);

    // Save client record
    const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();
    if (existing) {
      await supabase.from('clients').update({ demo_complete: true, demo_answers: answers, demo_report: report }).eq('email', email);
    } else {
      await supabase.from('clients').insert({ email, tier: 'demo', status: 'active', demo_complete: true, demo_answers: answers, demo_report: report });
    }

    // Save email to mark demo complete
    await supabase.from('clients').update({ demo_complete: true }).eq('email', email);

    // Mark job complete
    await supabase.from('demo_jobs').update({ status: 'complete', report }).eq('id', jobId);

  } catch(error) {
    console.error('Background processing error:', error);
    await supabase.from('demo_jobs').update({ status: 'error', error: error.message }).eq('id', jobId);
  }
}
