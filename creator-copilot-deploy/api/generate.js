const { createClient } = require('@supabase/supabase-js');

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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: HEADERS, body: '' };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  // ── POLL MODE: check if job is complete ──────────────────────
  if (body.jobId && !body.prompt) {
    try {
      const { data: job } = await supabase
        .from('demo_jobs')
        .select('status, report')
        .eq('id', body.jobId)
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

  // ── SUBMIT MODE: create job and trigger edge function ────────
  const { prompt, email, answers } = body;
  if (!prompt || !email) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing prompt or email' }) };
  }

  // Create or update client record
  try {
    const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();
    if (!existing) {
      await supabase.from('clients').insert({ email, tier: 'demo', status: 'active' });
    }
  } catch(e) {}

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from('demo_jobs')
    .insert({ email, status: 'processing', answers })
    .select()
    .single();

  if (jobError) {
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create job' }) };
  }

  // Trigger Supabase Edge Function to run Claude in background
  // Replace YOUR_SUPABASE_PROJECT_ID with your actual project ID: twkmpnezpuchelblxjfs
  const edgeFunctionUrl = `${process.env.SUPABASE_URL}/functions/v1/demographic-builder`;

  fetch(edgeFunctionUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`
    },
    body: JSON.stringify({
      jobId: job.id,
      prompt,
      supabaseUrl: process.env.SUPABASE_URL,
      supabaseKey: process.env.SUPABASE_SERVICE_KEY
    })
  }).catch(e => console.error('Edge function trigger error:', e));

  // Return job ID immediately
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ jobId: job.id, status: 'processing' })
  };
};
