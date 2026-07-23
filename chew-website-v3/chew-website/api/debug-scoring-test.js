// TEMPORARY debug endpoint — diagnosing the scoring.js JSON-parse failure.
// Returns the raw Claude API response so we can see what's actually coming
// back. Delete after diagnosis.

module.exports = async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });
  }

  try {
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
        system: `You are CHEW's admissions analyst. CHEW is a financial infrastructure company: education, strategy, implementation, accountability — no promised outcomes. Score this application 0–100 across four dimensions: COACHABILITY (30) — openness to guidance, realistic expectations, no shortcut-seeking; IMPLEMENTATION CAPACITY (30) — evidence of follow-through, stated time commitment, past implementation; FOUNDATION (20) — income stability and basic financial position sufficient to act on strategy; GOAL CLARITY (20) — specific, long-term, intrinsically motivated goals. Red flags that cap the score at 39 regardless of other strengths: expects guaranteed funding/score outcomes; expects CHEW to do the work; hostility toward education; urgency demanding immediate funding. Output JSON only: {score, dimension_scores, recommendation: one of ACCEPT | ACCEPT_WITH_CONDITIONS | WAITLIST | REFER_ELSEWHERE | REAPPLY_LATER, conditions: [], rationale: 3 sentences, one_flag: the single biggest risk, one_strength: the single biggest asset}. Never mention the scoring dimensions to applicants. A human reviews every recommendation before any decision is sent.`,
        messages: [{ role: 'user', content: JSON.stringify({
          vision: "Testing the CHEW application and portal invitation flow end-to-end.",
          goals: "1) Verify decision email. 2) Verify Clerk invitation email. 3) Confirm portal sign-up works.",
          income_target: "$10,000/mo",
          assets_target: "A small portfolio of rental properties and a fully funded business.",
          legacy: "Financial stability I can pass on to my kids.",
          income_range: "100k_250k",
          owns_business: "No",
          savings_range: "25k_100k",
          debt_range: "10k_50k",
          credit_monitoring: "No",
          organization_score: 6,
          organization_why: "I track spending loosely but don't have a real system or automated savings yet.",
          money_system: "A basic budget spreadsheet I update inconsistently.",
          tracks_cash_flow: "No",
          education_pursued: "A few personal finance books and some YouTube content.",
          education_applied: "Started a small emergency fund, but haven't kept up a full system.",
          why_now: "I've reached the limit of what I can figure out on my own and want real strategy and accountability.",
          capacity_90_days: "I have consistent evenings and weekends free to implement a plan and follow through on tasks.",
          hours_per_week: 5,
          what_would_quit: "If it required no real effort on my part, or if I stopped seeing honest feedback.",
          seeking_guaranteed_results: "No",
          full_name: "Leroy Thompson",
          timeline: "immediately",
        }, null, 2) }],
      }),
    });

    const status = response.status;
    const raw = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {}

    return res.status(200).json({
      httpStatus: status,
      rawBodyLength: raw.length,
      rawBody: raw.slice(0, 3000),
      parsedTopLevelKeys: parsed ? Object.keys(parsed) : null,
      stopReason: parsed ? parsed.stop_reason : null,
      contentBlocks: parsed ? parsed.content : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message, stack: err.stack });
  }
};
