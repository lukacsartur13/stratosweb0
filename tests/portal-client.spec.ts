import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { OWNER_CAPABILITIES, canAccess } from '../portal/src/lib/permissions';

/**
 * Phase 4 — structural contracts (no database, no browser). The database half
 * is tests/portal-client-db.spec.ts (PGlite), the function half
 * tests/portal-invite.spec.ts (mocked Supabase), the rendered half
 * scripts/portal-client-check.mjs (mocked), the real-service half
 * scripts/client-portal-live-check.mjs (local Supabase only).
 */

const ROOT = process.cwd();
const src = (...p: string[]) => fs.readFileSync(path.join(ROOT, 'portal', 'src', ...p), 'utf8');
const fn = fs.readFileSync(path.join(ROOT, 'netlify', 'functions', 'portal-invite.mjs'), 'utf8');

test('the client side never queries a table — only the client_* functions and Storage', () => {
  const code = src('lib', 'clientPortal.ts') + src('features', 'client', 'ClientApp.tsx');
  expect(code).not.toMatch(/\.from\(\s*'/);
  const rpcs = [...code.matchAll(/\.rpc\(\s*'([a-z_]+)'/g)].map((m) => m[1]);
  expect(rpcs.length).toBeGreaterThan(0);
  for (const r of rpcs) expect(r).toMatch(/^client_/);
});

test('client accounts and sharing are owner capabilities', () => {
  expect(OWNER_CAPABILITIES).toContain('manage_client_accounts');
  expect(canAccess({ role: 'super_admin', is_owner: true }, 'manage_client_accounts')).toBe(true);
  for (const role of ['super_admin', 'admin', 'team_member', 'client'] as const) {
    expect(canAccess({ role, is_owner: false }, 'manage_client_accounts'), role).toBe(false);
  }
});

test('a client account renders the client portal instead of the staff shell', () => {
  const app = src('App.tsx');
  expect(app).toMatch(/if \(profile\?\.role === 'client'\) return <Suspense fallback=\{null\}><ClientApp \/><\/Suspense>;/);
  expect(app).toMatch(/<Route path="\/accept-invite"/);
});

test('the invitation link is never logged, stored or put in a query string', () => {
  // The function: every console call names a step and a status/code only.
  for (const m of fn.matchAll(/console\.\w+\(([^;]*)\);/g)) {
    expect(m[1], m[0]).not.toMatch(/link|hash|url|token|email/i);
  }
  expect(fn).toMatch(/accept-invite#token_hash=/);            // fragment, not ?query
  expect(fn).toMatch(/'cache-control': 'private, no-store, max-age=0'/);
  // The owner's screen: shown in a dialog, never persisted.
  const panel = src('features', 'client', 'ClientAccountsPanel.tsx') + src('lib', 'clientAccounts.ts');
  expect(panel).not.toMatch(/localStorage|sessionStorage|console\.\w+\([^)]*link/);
  // The acceptance page removes the fragment before verifying, and logs nothing.
  const accept = src('features', 'client', 'AcceptInvite.tsx');
  expect(accept.indexOf('history.replaceState')).toBeGreaterThan(-1);
  expect(accept.indexOf('history.replaceState')).toBeLessThan(accept.indexOf('supabase.auth.verifyOtp('));
  expect(accept).not.toMatch(/console\./);
});

test('the invite function uses the server key only for the auth user and the link', () => {
  const serverCalls = [...fn.matchAll(/headers: asServer\(\)/g)].length;
  expect(serverCalls).toBe(3);                               // generate_link, profile lookup, confirmed?
  expect(fn).toMatch(/rpc\(token, 'client_invite_prepare'/);  // the database work runs as the owner
  expect(fn).toMatch(/rpc\(token, 'client_invite_attach'/);
  expect(fn).not.toMatch(new RegExp(['service', 'role'].join('_')));
});

test('no payment schedule is introduced', () => {
  const migration = fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', '20261001000100_client_portal.sql'), 'utf8');
  expect(migration).not.toMatch(/instal|schedule_|payment_plan|due_amount/i);
});
