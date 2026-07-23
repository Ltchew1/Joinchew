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
        system: 'You are CHEW\'s admissions analyst. Output JSON only: {score, recommendation}.',
        messages: [{ role: 'user', content: 'Sample application: income $10k/mo, no business, 6/10 organized.' }],
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
