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
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { email } = body;
  if (!email) return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing email' }) };

  try {
    const { data: client, error } = await supabase
      .from('clients')
      .select('demo_complete, demo_report')
      .eq('email', email)
      .single();

    if (error || !client || !client.demo_complete || !client.demo_report) {
      return {
        statusCode: 200,
        headers: HEADERS,
        body: JSON.stringify({ exists: false })
      };
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ exists: true, report: client.demo_report })
    };

  } catch(error) {
    console.error('Check profile error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
