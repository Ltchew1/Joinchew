// lib/scoring.js
//
// AI readiness scoring for the /apply admissions system, via the Claude API.
// Requires ANTHROPIC_API_KEY set in Vercel environment variables. Scoring is
// advisory only — a human reviews every recommendation before any decision
// is sent (see api/send-decision.js). Never expose these scores/dimensions
// to applicants.

const SYSTEM_PROMPT = `You are CHEW's admissions analyst. CHEW is a financial infrastructure company: education, strategy, implementation, accountability — no promised outcomes. Score this application 0–100 across four dimensions: COACHABILITY (30) — openness to guidance, realistic expectations, no shortcut-seeking; IMPLEMENTATION CAPACITY (30) — evidence of follow-through, stated time commitment, past implementation; FOUNDATION (20) — income stability and basic financial position sufficient to act on strategy; GOAL CLARITY (20) — specific, long-term, intrinsically motivated goals. Red flags that cap the score at 39 regardless of other strengths: expects guaranteed funding/score outcomes; expects CHEW to do the work; hostility toward education; urgency demanding immediate funding. Output JSON only: {score, dimension_scores, recommendation: one of ACCEPT | ACCEPT_WITH_CONDITIONS | WAITLIST | REFER_ELSEWHERE | REAPPLY_LATER, conditions: [], rationale: 3 sentences, one_flag: the single biggest risk, one_strength: the single biggest asset}. Never mention the scoring dimensions to applicants. A human reviews every recommendation before any decision is sent.`;

const VALID_RECOMMENDATIONS = ['ACCEPT', 'ACCEPT_WITH_CONDITIONS', 'WAITLIST', 'REFER_ELSEWHERE', 'REAPPLY_LATER'];

async function scoreApplication(answers) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set.');
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: 1024,
      thinking: { type: 'disabled' },
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: JSON.stringify(answers, null, 2) },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Claude API error (${response.status}): ${errText.slice(0, 300)}`);
  }

  const data = await response.json();
  const text = (data.content || []).map((block) => block.text || '').join('').trim();

  let parsed;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
  } catch (err) {
    throw new Error(`Could not parse scoring response as JSON: ${err.message}`);
  }

  if (typeof parsed.score !== 'number' || !VALID_RECOMMENDATIONS.includes(parsed.recommendation)) {
    throw new Error('Scoring response missing required fields (score/recommendation).');
  }

  return {
    score: parsed.score,
    dimensionScores: parsed.dimension_scores || {},
    recommendation: parsed.recommendation,
    conditions: parsed.conditions || [],
    rationale: parsed.rationale || '',
    oneFlag: parsed.one_flag || '',
    oneStrength: parsed.one_strength || '',
  };
}

module.exports = { scoreApplication, VALID_RECOMMENDATIONS };
