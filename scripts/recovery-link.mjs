/**
 * Print a password-recovery link without sending mail.
 *
 * The built-in Supabase SMTP is rate limited to a couple of messages an hour
 * and silently drops addresses outside the project's team, which makes the
 * portal's "a reset link is on its way" message unfalsifiable. This asks the
 * admin API for the link directly instead.
 *
 *   node --env-file=.env scripts/recovery-link.mjs you@example.com
 *
 * Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service role key
 * bypasses RLS entirely — keep it out of the shell history and out of git.
 */
import { createClient } from './../portal/node_modules/@supabase/supabase-js/dist/module/index.js';

const email = process.argv[2];
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SITE_URL } = process.env;

if (!email) {
  console.error('Usage: node --env-file=.env scripts/recovery-link.mjs <email>');
  process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).');
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// redirectTo still has to be on the project's allow-list, same as the portal's
// own reset request. If it is not, the generated link falls back to Site URL.
const redirectTo = `${VITE_SITE_URL ?? 'https://stratosweb1.netlify.app'}/portal/reset-password`;

const { data, error } = await admin.auth.admin.generateLink({
  type: 'recovery',
  email,
  options: { redirectTo },
});

if (error) {
  console.error('Failed:', error.message);
  process.exit(1);
}

console.log('\nOpen this once, within the hour:\n');
console.log(data.properties.action_link);
console.log('\nIt is a live credential. Do not paste it anywhere.\n');
