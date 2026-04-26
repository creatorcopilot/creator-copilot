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
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: HEADERS, body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: HEADERS, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); }
  catch(e) { return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

  const { prompt, email, answers } = body;
  if (!prompt || !email) {
    return { statusCode: 400, headers: HEADERS, body: JSON.stringify({ error: 'Missing prompt or email' }) };
  }

  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system: MASTER_REFERENCE + `\n\nYou are running the DEMOGRAPHIC BUILDER system.

RESEARCH PROTOCOL — run this before generating the report:
1. Search for the niche the client described to find what content is currently performing
2. Search for the reference creator/brand they named in Q5 to find their current audience data
3. Search Reddit and social platforms for communities where this audience gathers
4. Use all research findings to inform every section of the report

Generate a seven-section demographic report. Return ONLY valid JSON with these exact keys:
- who: Who this audience is right now — age range, life stage, daily reality, specific and detailed
- psychology: Hidden fear, core desire, what they believe about themselves — psychological precision
- language: Exact phrases, words, hooks that stop this audience mid-scroll — pulled from real audience language found in research
- where: Specific subreddits, hashtag communities, platform behaviors, accounts they follow — from live research
- brands: 3-5 specific brands or categories actively spending to reach this audience right now
- hook: Single most powerful hook sentence for this exact audience — ready to use as a video opening
- strategy: Object with key "angles" — array of exactly 3 objects, each with "title" and "why" explaining a specific content angle for Month 1 based on what is working in this niche right now

Be specific, psychological, research-driven. Never be vague or generic. Every insight must feel like it was built specifically for this person.`,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search"
        }
      ],
      messages: [{ role: 'user', content: prompt }]
    });

    // Extract text from response - may contain tool use blocks
    let text = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        text += block.text;
      }
    }

    // If no text found, check if we need another turn (tool use happened)
    if (!text && response.stop_reason === 'tool_use') {
      // Continue the conversation after tool use
      const toolResults = response.content
        .filter(b => b.type === 'tool_use')
        .map(b => ({ type: 'tool_result', tool_use_id: b.id, content: 'Search completed' }));

      const followUp = await anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 3000,
        system: MASTER_REFERENCE + "\n\nYou are running the DEMOGRAPHIC BUILDER system. Now generate the seven-section demographic report based on your research. Return ONLY valid JSON with keys: who, psychology, language, where, brands, hook, strategy (object with angles array of 3 objects each with title and why).",
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

    let report;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      report = JSON.parse(clean);
    } catch(e) {
      console.error('Parse error, text was:', text.substring(0, 500));
      return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: 'Failed to parse response' }) };
    }

    // Save to Supabase
    try {
      const { data: existing } = await supabase.from('clients').select('id').eq('email', email).single();
      if (existing) {
        await supabase.from('clients').update({ demo_complete: true, demo_answers: answers, demo_report: report }).eq('email', email);
      } else {
        await supabase.from('clients').insert({ email, tier: 'demo', status: 'active', demo_complete: true, demo_answers: answers, demo_report: report });
      }
    } catch(dbErr) {
      console.error('DB error:', dbErr);
    }

    return {
      statusCode: 200,
      headers: HEADERS,
      body: JSON.stringify({ content: [{ text: JSON.stringify(report) }] })
    };

  } catch (error) {
    console.error('Generate error:', error);
    return { statusCode: 500, headers: HEADERS, body: JSON.stringify({ error: error.message }) };
  }
};
