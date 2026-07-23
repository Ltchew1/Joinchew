// lib/clerk.js
//
// Creates client-portal (chew-portal) access via Clerk's invitation system.
// The portal's sign-up is restricted to invitation-only in Clerk's dashboard,
// so this is the only way an applicant's email becomes able to sign up.
// Requires CLERK_SECRET_KEY and PORTAL_URL set in Vercel environment variables.
// chew-portal shares this same Clerk instance, so the secret key is the same
// value already configured on that project.

async function createPortalInvitation({ email, name }) {
  if (!process.env.CLERK_SECRET_KEY) {
    throw new Error('CLERK_SECRET_KEY environment variable is not set.');
  }
  const portalUrl = process.env.PORTAL_URL || 'https://chew-portal-gzpr.vercel.app';

  const response = await fetch('https://api.clerk.com/v1/invitations', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.CLERK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email_address: email,
      // Must point at the public sign-up page, not a protected route: the
      // ticket-bearing link needs to hit /sign-up while signed out so Clerk's
      // <SignUp/> can consume the ticket. Pointing this at /dashboard sends
      // unauthenticated ticket requests through middleware's auth().protect(),
      // which redirects to /sign-in and drops the ticket. chew-portal's own
      // NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL already sends them to /dashboard
      // once sign-up actually completes.
      redirect_url: `${portalUrl}/sign-up`,
      public_metadata: name ? { full_name: name } : undefined,
      notify: true,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Clerk invitation failed (${response.status}): ${body}`);
  }

  return response.json();
}

module.exports = { createPortalInvitation };
