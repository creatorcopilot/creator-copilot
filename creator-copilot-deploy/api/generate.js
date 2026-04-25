const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { prompt, email, answers } = req.body;

  if (!prompt || !email) {
    return res.status(400).json({ error: 'Missing prompt or email' });
  }

  try {
    // Call Claude API
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: `You are the Creator Copilot demographic intelligence system. 
You build precise psychological audience profiles from craft-based answers.
You have deep expertise in content strategy, audience psychology, and brand intelligence.
Always respond with valid JSON only — no preamble, no markdown, no explanation.
Your audience profiles are specific, psychologically precise, and built from real intelligence about how audiences think and behave.`,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = response.content[0].text;
    let report;

    try {
      const clean = text.replace(/```json|```/g, '').trim();
      report = JSON.parse(clean);
    } catch (e) {
      // If JSON parse fails return a structured error
      return res.status(500).json({ error: 'Failed to parse Claude response' });
    }

    // Save to Supabase
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('email', email)
      .single();

    if (existing) {
      await supabase
        .from('clients')
        .update({
          demo_complete: true,
          demo_answers: answers,
          demo_report: report,
        })
        .eq('email', email);
    } else {
      await supabase
        .from('clients')
        .insert({
          email,
          tier: 'demo',
          status: 'active',
          demo_complete: true,
          demo_answers: answers,
          demo_report: report,
        });
    }

    return res.status(200).json({ content: [{ text: JSON.stringify(report) }] });

  } catch (error) {
    console.error('Demographic builder error:', error);
    return res.status(500).json({ error: 'Failed to generate demographic report' });
  }
}
