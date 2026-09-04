// lib/admin-auth.js
//
// The real admin authentication boundary for CHEW's admissions review
// queue, replacing the shared-secret bridge that admin-applications.html
// used before this. Uses Clerk's own backend verification (the same
// Clerk instance already configured via CLERK_SECRET_KEY for portal
// invitations — see lib/clerk.js) rather than hand-rolled JWT/JWKS
// verification: getting signature verification wrong is a real security
// bug, and Clerk's own SDK is the only trustworthy way to do it here.
//
// Deliberately no RBAC, no roles table, no multi-admin support: exactly
// one CHEW admin identity is authorized, pinned by Clerk user id via
// ADMIN_CLERK_USER_ID. Every admin API route (read AND write) calls
// requireAdmin() independently and returns immediately if it resolves to
// null — the client-side "signed in" state is never trusted on its own.
//
// Requires CLERK_SECRET_KEY and ADMIN_CLERK_USER_ID set in Vercel
// environment variables. See ADMIN_AUTH_SETUP.md for how to find a
// Clerk user id and wire this up.

const { verifyToken } = require('@clerk/backend');

function authorizedParties() {
  // Restricts accepted session tokens to ones actually issued for CHEW's
  // own site, so a Clerk session token from a different application on
  // the same shared Clerk instance (e.g. chew-portal) can't be replayed
  // against these admin APIs. If SITE_URL isn't set, verifyToken skips
  // this check entirely rather than rejecting everything.
  const parties = [];
  if (process.env.SITE_URL) parties.push(process.env.SITE_URL);
  return parties.length ? parties : undefined;
}

// requireAdmin(req, res) resolves to the verified Clerk user id on
// success. On any failure it writes the appropriate 401/403/503 response
// itself and resolves to null — callers MUST check for null and return
// immediately without touching the database or sending anything.
async function requireAdmin(req, res) {
  if (!process.env.CLERK_SECRET_KEY || !process.env.ADMIN_CLERK_USER_ID) {
    res.status(503).json({ error: 'Admin access is not configured yet.' });
    return null;
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  let claims;
  try {
    claims = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: authorizedParties(),
    });
  } catch (err) {
    // Expired, malformed, revoked, wrong-instance, or wrong-party tokens
    // all land here — Clerk's verifier throws rather than returning an
    // ambiguous partial result, so there's nothing further to inspect.
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }

  const userId = claims && claims.sub;
  if (!userId || userId !== process.env.ADMIN_CLERK_USER_ID) {
    // A real, currently-valid Clerk session -- just not the one CHEW
    // admin identity this deployment authorizes. Logged distinctly from
    // a bad/expired token so an unexpected 403 is easy to tell apart
    // from a client bug during setup.
    console.error(`Admin auth: valid Clerk session for non-admin user ${userId || '(unknown)'}`);
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }

  return userId;
}

// The pre-Clerk shared-secret bridge, kept ONLY for local `vercel dev`
// iteration before Clerk is configured locally — never active in a real
// deployment. VERCEL_ENV is set by Vercel itself on every deployed
// invocation (production AND preview); it is absent only for local dev,
// so this check can't be flipped on by any environment variable in an
// actual deployment. ADMIN_ALLOW_LEGACY_SECRET must ALSO be explicitly
// set, so simply having a leftover ADMIN_SECRET configured doesn't
// silently reactivate this path even locally.
function legacySecretAuthorized(candidateSecret) {
  if (process.env.VERCEL_ENV === 'production') return false;
  if (process.env.ADMIN_ALLOW_LEGACY_SECRET !== 'true') return false;
  if (!process.env.ADMIN_SECRET) return false;
  return candidateSecret === process.env.ADMIN_SECRET;
}

module.exports = { requireAdmin, legacySecretAuthorized };
