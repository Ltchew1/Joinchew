// /api/admin-auth-config.js
//
// Hands admin-applications.html the one piece of Clerk configuration a
// static HTML page can't otherwise get: the publishable key. This is NOT
// a secret — Clerk publishable keys are designed to be embedded in
// client-side code (same trust model as a Stripe publishable key) — this
// endpoint exists only because this project has no server-side templating
// step for static .html files, so the key can't be baked in at build time
// and has to be fetched at runtime instead. Contains no admin data, no
// session state, and requires no authentication itself.
//
// GET /api/admin-auth-config

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.CLERK_PUBLISHABLE_KEY) {
    return res.status(503).json({ error: 'Admin sign-in is not configured yet.' });
  }

  return res.status(200).json({ publishableKey: process.env.CLERK_PUBLISHABLE_KEY });
};
