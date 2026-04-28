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

  // ── POLL MODE ────────────────────────────────────────────────
  if (body.jobId && !body.prompt) {
    try {
      const { data: job, error } = await supabase
        .from('demo_jobs')
        .select('status, report')
        .eq('id', body.jobId)
        .single();

      if (error || !job) {
        return { statusCode: 404, headers: HEADERS, body: JSON.stringify({ error: 'Job not found' }) };
      }

      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ status: job.status, report: job.report })
      };
    } catch(e) {
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: e.message }) };
    }
  }

  // ── SUBMIT MODE ──────────────────────────────────────────────
  const { prompt, email, answers } = body;
  if (!prompt || !email) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing prompt or email' }) };
  }

  // Ensure client record exists
  try {
    const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();
    if (!existing) {
      await supabase.from('clients').insert({ email, tier: 'demo', status: 'active' });
    }
  } catch(e) { /* ignore - client may already exist */ }

  // Create job record
  const { data: job, error: jobError } = await supabase
    .from('demo_jobs')
    .insert({ email, status: 'processing', answers })
    .select()
    .single();

  if (jobError) {
    console.error('Job creation error:', jobError);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to create job: ' + jobError.message }) };
  }

  console.log('Job created:', job.id, 'calling edge function...');

  // Call Supabase Edge Function
  // Use the anon key for the Authorization header when calling edge functions
  const edgeFunctionUrl = process.env.SUPABASE_URL + '/functions/v1/demographic-builder';
  
  try {
    const edgeResponse = await fetch(edgeFunctionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + process.env.SUPABASE_SERVICE_KEY,
        'apikey': process.env.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({
        jobId: job.id,
        prompt: prompt
      })
    });

    const edgeText = await edgeResponse.text();
    console.log('Edge function response:', edgeResponse.status, edgeText);

    if (!edgeResponse.ok) {
      console.error('Edge function call failed:', edgeResponse.status, edgeText);
    }
  } catch(fetchErr) {
    console.error('Edge function fetch error:', fetchErr.message);
  }

  // Return job ID regardless - polling will handle the result
  return {
    statusCode: 200,
    headers: HEADERS,
    body: JSON.stringify({ jobId: job.id, status: 'processing' })
  };
};
