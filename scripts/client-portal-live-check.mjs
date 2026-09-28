// =============================================================================
// Client portal (phase 4) — checks against a REAL, LOCAL Supabase: Auth
// (GoTrue), PostgREST and Storage. Runs the real invite function handler
// (netlify/functions/portal-invite.mjs) in-process against those services.
//
//     LIVE_SUPABASE_URL=http://127.0.0.1:54321 \
//     LIVE_SUPABASE_ANON_KEY=<local anon key> \
//     LIVE_SUPABASE_SECRET_KEY=<local server key> \
//     LIVE_CONFIRM_LOCAL=yes \
//     node scripts/client-portal-live-check.mjs
//
// LOCAL ONLY — refuses any host but localhost/127.0.0.1/[::1]/*.localhost, and
// needs LIVE_CONFIRM_LOCAL=yes. Creates test users (@example.invalid), two
// companies, projects and files, and leaves them (nothing is deleted). Keys,
// passwords, links and tokens are never printed.
//
// Preparing the local database: supabase/CLIENT_PORTAL.md §8.
// Exit 0 = all passed, 1 = a check failed, 2 = refused to run.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';

const URL_ = process.env.LIVE_SUPABASE_URL ?? '';
const ANON = process.env.LIVE_SUPABASE_ANON_KEY ?? '';
const SERVER = process.env.LIVE_SUPABASE_SECRET_KEY ?? '';
const BUCKET = 'project-documents';

const refuse = (why) => { console.error(`client-portal-live-check: refusing to run — ${why}`); process.exit(2); };
let host = '';
try { host = new URL(URL_).hostname; } catch { refuse('LIVE_SUPABASE_URL is missing or not a URL'); }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) && !host.endsWith('.localhost')) refuse(`${host} is not a local host`);
if (process.env.LIVE_CONFIRM_LOCAL !== 'yes') refuse('set LIVE_CONFIRM_LOCAL=yes to confirm this is a disposable local stack');
if (!ANON || !SERVER) refuse('LIVE_SUPABASE_ANON_KEY and LIVE_SUPABASE_SECRET_KEY are required');

// The invite function reads these at import.
Object.assign(process.env, { SUPABASE_URL: URL_, SUPABASE_SECRET_KEY: SERVER, SUPABASE_ANON_KEY: ANON, PORTAL_ORIGIN: 'http://localhost:5174' });
const invite = (await import('../netlify/functions/portal-invite.mjs')).default;

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVER, opts);
const run = randomUUID().slice(0, 8);
const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push(true); console.log(`  ok   ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push(false); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
const mail = (who) => `${who}-${run}@example.invalid`;

async function staff(label, role) {
  const email = mail(label);
  const pw = randomBytes(18).toString('base64url');
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) refuse(`create ${label}: ${error.message}`);
  await admin.from('profiles').update({ role }).eq('id', data.user.id);
  const client = createClient(URL_, ANON, opts);
  await client.auth.signInWithPassword({ email, password: pw });
  return { id: data.user.id, email, client, token: (await client.auth.getSession()).data.session.access_token };
}

/** The owner's invite, through the real function; then the client opens the link and sets a password. */
async function inviteAndAccept(owner, org, label, projects) {
  const email = mail(label);
  const res = await invite(new Request('http://localhost/api/portal-invite', {
    method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization_id: org, full_name: label, email, project_ids: projects }),
  }));
  const body = await res.json();
  if (!res.ok) throw new Error(`invite ${label}: ${res.status} ${body.code}`);
  const hash = new URLSearchParams(body.link.split('#')[1]).get('token_hash');
  const client = createClient(URL_, ANON, opts);
  const v = await client.auth.verifyOtp({ token_hash: hash, type: 'invite' });
  if (v.error) throw new Error(`verify ${label}: ${v.error.message}`);
  const u = await client.auth.updateUser({ password: randomBytes(18).toString('base64url') + 'aA1' });
  if (u.error) throw new Error(`password ${label}: ${u.error.message}`);
  return { email, client, kind: body.kind };
}

async function upload(client, begin, beginArgs, bytes, finishFn) {
  const { data, error } = await client.rpc(begin, beginArgs);
  if (error) throw new Error(`${begin}: ${error.message}`);
  const row = data[0];
  const s = await client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path);
  if (s.error) throw new Error(`sign: ${s.error.message}`);
  const put = await fetch(s.data.signedUrl, { method: 'PUT', body: bytes, headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false', apikey: ANON } });
  const fin = await client.rpc(finishFn, { p_id: row.id });
  return { row, put: put.status, finish: fin.data, signedUrl: s.data.signedUrl };
}

console.log(`client-portal-live-check against ${host} (run ${run})`);

// ------------------------------------------------------------------ setup
const owner = await staff('owner', 'super_admin');
const admin2 = await staff('admin', 'admin');
const d = await admin.rpc('portal_set_owner', { p_email: owner.email });
if (d.error) refuse(`portal_set_owner: ${d.error.message} — apply the runbook first`);
owner.token = (await owner.client.auth.refreshSession()).data.session?.access_token ?? owner.token;
const orgA = (await admin.from('organizations').insert({ name: `A ${run}`, slug: `a-${run}` }).select('id').single()).data.id;
const orgB = (await admin.from('organizations').insert({ name: `B ${run}`, slug: `b-${run}` }).select('id').single()).data.id;
const mk = async (org, name) => (await admin.from('projects').insert({ organization_id: org, name, slug: `${name}-${run}`.toLowerCase().replace(/\W+/g, '-'), status: 'active', value: 1000 }).select('id').single()).data.id;
const PA = await mk(orgA, 'A web');
const PB = await mk(orgB, 'B brand');

let anna; let bela; let cili;
await check('invite through the real function; the client verifies the link and sets a password', async () => {
  anna = await inviteAndAccept(owner, orgA, 'anna', [PA]);
  bela = await inviteAndAccept(owner, orgA, 'bela', [PA]);
  cili = await inviteAndAccept(owner, orgB, 'cili', [PB]);
  return `link kinds: ${anna.kind}`;
});

await check('inviting again: one account, a password link now', async () => {
  const res = await invite(new Request('http://localhost/api/portal-invite', {
    method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization_id: orgA, full_name: 'anna', email: anna.email, project_ids: [] }) }));
  const body = await res.json();
  assert(res.ok && body.kind === 'recovery', `${res.status} ${body.kind ?? body.code}`);
  const n = (await admin.from('client_accounts').select('id', { count: 'exact', head: true }).eq('email', anna.email)).count;
  assert(n === 1, `${n} accounts`);
});

await check('a staff address and another company are refused; roles untouched', async () => {
  for (const [email, org] of [[admin2.email, orgA], [cili.email, orgA]]) {
    const res = await invite(new Request('http://localhost/api/portal-invite', {
      method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ organization_id: org, full_name: 'x', email, project_ids: [] }) }));
    assert(res.status === 409, `${email}: ${res.status}`);
  }
  assert((await admin.from('profiles').select('role').eq('id', admin2.id).single()).data.role === 'admin', 'admin role changed');
});

await check('a non-owner cannot invite', async () => {
  const res = await invite(new Request('http://localhost/api/portal-invite', {
    method: 'POST', headers: { authorization: `Bearer ${admin2.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization_id: orgA, full_name: 'x', email: mail('x'), project_ids: [] }) }));
  assert(res.status === 403, `${res.status}`);
});

await check('a client reads no internal table through real PostgREST', async () => {
  for (const t of ['projects', 'project_milestones', 'project_documents', 'document_folders', 'client_accounts', 'document_shares']) {
    const r = await anna.client.from(t).select('*').limit(5);
    assert(r.error || r.data.length === 0, `${t}: ${r.data?.length} rows`);
  }
  const p = await anna.client.rpc('client_portal_projects');
  assert(!p.error && p.data.length === 1 && Object.keys(p.data[0]).sort().join() === 'project_id,project_name', JSON.stringify(p.data));
});

let shared;
await check('sharing through real Storage: only the account it was shared with can download', async () => {
  shared = await upload(owner.client, 'document_begin_upload', { p_project: PA, p_folder: null, p_name: 'offer.pdf', p_size: 9, p_type: null, p_kind: 'pdf' },
    Buffer.from('%PDF-1.4\n'), 'document_finish_upload');
  assert(shared.finish === 'ready', `owner upload ${shared.finish}`);
  const acct = (await admin.from('client_accounts').select('id').eq('email', anna.email).single()).data.id;
  const s = await owner.client.from('document_shares').insert({ account_id: acct, project_id: PA, document_id: shared.row.id });
  assert(!s.error, s.error?.message);
  assert(!(await anna.client.storage.from(BUCKET).createSignedUrl(shared.row.storage_path, 60)).error, 'anna cannot download');
  assert((await bela.client.storage.from(BUCKET).createSignedUrl(shared.row.storage_path, 60)).error, 'bela can download');
  assert((await cili.client.storage.from(BUCKET).download(shared.row.storage_path)).error, 'cili can download');
});

await check('Nyersanyag: a client upload through real Storage lands, and only its uploader sees it', async () => {
  const u = await upload(anna.client, 'client_begin_upload', { p_project: PA, p_name: 'logo.png', p_size: 8, p_type: null, p_kind: 'png' },
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'client_finish_upload');
  assert(u.put === 200 && u.finish === 'ready', `put ${u.put}, finish ${u.finish}`);
  assert(((await bela.client.rpc('client_portal_uploads')).data ?? []).length === 0, 'bela sees anna\'s upload');
  assert((await bela.client.storage.from(BUCKET).createSignedUploadUrl(u.row.storage_path)).error, 'bela could sign anna\'s path');
  assert((await put503(u.signedUrl)) >= 400, 'the used link overwrote the upload');
});
async function put503(url) { return (await fetch(url, { method: 'PUT', body: Buffer.from('x'), headers: { 'content-type': 'application/octet-stream', apikey: ANON } })).status; }

await check('access revoked mid-upload: no new link, and the late file never becomes a document', async () => {
  const { data } = await bela.client.rpc('client_begin_upload', { p_project: PA, p_name: 'late.pdf', p_size: 9, p_type: null, p_kind: 'pdf' });
  const row = data[0];
  const s = await bela.client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path);
  assert(!s.error, 'no link before revoke');
  const acct = (await admin.from('client_accounts').select('id').eq('email', bela.email).single()).data.id;
  await owner.client.from('client_project_access').update({ revoked_at: new Date().toISOString() }).eq('account_id', acct).is('revoked_at', null);
  assert((await bela.client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path)).error, 'a new link after revoke');
  const late = await fetch(s.data.signedUrl, { method: 'PUT', body: Buffer.from('%PDF-1.4\n'), headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'false', apikey: ANON } });
  const state = (await admin.from('project_documents').select('upload_state, failure_reason').eq('id', row.id).single()).data;
  assert(state.upload_state === 'failed' && state.failure_reason === 'access_revoked', JSON.stringify(state));
  return `the old link's PUT answered ${late.status} (the object, if stored, is reported as unfinished_object)`;
});


/* ============ the rest of the pre-release list (real Auth, PostgREST, Storage) */

const MAILPIT = process.env.LIVE_MAILPIT_URL ?? '';
const put = (url, body, upsert = false) => fetch(url, { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream', 'x-upsert': String(upsert), apikey: ANON } }).then((r) => r.status);
const acctOf = async (email) => (await admin.from('client_accounts').select('id').eq('email', email).single()).data.id;
const ownerUpload = (name, bytes, folder = null, project = PA) => upload(owner.client, 'document_begin_upload',
  { p_project: project, p_folder: folder, p_name: name, p_size: bytes.length, p_type: null, p_kind: name.endsWith('.pdf') ? 'pdf' : 'text' }, bytes, 'document_finish_upload');
const docsOf = async (who) => ((await who.client.rpc('client_portal_documents')).data ?? []).map((d) => d.name).sort();

await check('sign in with a password, sign out: the session and its refresh token end', async () => {
  const pw = randomBytes(18).toString('base64url') + 'aA1';
  const dora = await inviteAndAccept(owner, orgA, 'dora', [PA]);
  assert(!(await dora.client.auth.updateUser({ password: pw })).error, 'password change');
  const c = createClient(URL_, ANON, opts);
  const signIn = await c.auth.signInWithPassword({ email: dora.email, password: pw });
  assert(!signIn.error, `sign in: ${signIn.error?.message}`);
  const bad = await createClient(URL_, ANON, opts).auth.signInWithPassword({ email: dora.email, password: 'wrong-password-123' });
  assert(bad.error, 'a wrong password signed in');
  const refresh = signIn.data.session.refresh_token;
  const access = signIn.data.session.access_token;
  assert(!(await c.auth.signOut()).error, 'sign out');
  assert(!(await c.auth.getSession()).data.session, 'session kept after sign out');
  const reuse = await createClient(URL_, ANON, opts).auth.refreshSession({ refresh_token: refresh });
  assert(reuse.error, 'the refresh token still works after sign out');
  const stale = createClient(URL_, ANON, { ...opts, global: { headers: { authorization: `Bearer ${access}` } } });
  const r = await stale.rpc('client_portal_projects');
  // Access tokens are stateless JWTs: until they expire (JWT expiry, 3600 s by
  // default) PostgREST accepts them. Recorded, not hidden.
  return `after sign-out the old access token ${r.error ? 'is refused' : 'still works until it expires (stateless JWT)'}`;
});

await check('five simultaneous invitations of one new address: one auth user, one account, then a clean retry', async () => {
  const email = mail('ella');
  const call = () => invite(new Request('http://localhost/api/portal-invite', {
    method: 'POST', headers: { authorization: `Bearer ${owner.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ organization_id: orgA, full_name: 'ella', email, project_ids: [PA] }) }));
  const statuses = await Promise.all(Array.from({ length: 5 }, () => call().then(async (r) => `${r.status}${r.ok ? '' : `:${(await r.json()).code}`}`)));
  const accounts = (await admin.from('client_accounts').select('id', { count: 'exact', head: true }).eq('email', email)).count;
  const users = (await admin.from('profiles').select('id', { count: 'exact', head: true }).ilike('email', email)).count;
  assert(accounts === 1 && users === 1, `accounts ${accounts}, users ${users}; ${statuses}`);
  const again = await call();
  assert(again.ok, `retry ${again.status}`);
  const linked = (await admin.from('client_accounts').select('user_id').eq('email', email).single()).data.user_id;
  assert(linked, 'account not linked');
  return statuses.join(', ');
});

let folderDoc; let direct; let parent; let child;
await check('a folder share reaches subfolders and later files; moving out removes it; a direct share survives', async () => {
  parent = (await owner.client.from('document_folders').insert({ project_id: PA, name: 'Átadás' }).select('id').single()).data.id;
  child = (await owner.client.from('document_folders').insert({ project_id: PA, parent_id: parent, name: 'Végleges' }).select('id').single()).data.id;
  folderDoc = await ownerUpload('arculat.pdf', Buffer.from('%PDF-1.4\n'), child);
  const a = await acctOf(anna.email);
  assert(!(await owner.client.from('document_shares').insert({ account_id: a, project_id: PA, folder_id: parent })).error, 'folder share');
  const later = await ownerUpload('kesobbi.txt', Buffer.from('later'), child);
  assert(JSON.stringify(await docsOf(anna)).includes('arculat.pdf') && (await docsOf(anna)).includes('kesobbi.txt'), `anna sees ${await docsOf(anna)}`);
  assert((await docsOf(bela)).length === 0, 'bela sees the folder');
  assert(!(await anna.client.storage.from(BUCKET).createSignedUrl(later.row.storage_path, 60)).error, 'no download through the folder');
  direct = later;
  assert(!(await owner.client.from('document_shares').insert({ account_id: a, project_id: PA, document_id: later.row.id })).error, 'direct share');
  assert((await owner.client.rpc('document_move', { p_id: folderDoc.row.id, p_folder: null })).error === null, 'move');
  assert((await owner.client.rpc('document_move', { p_id: later.row.id, p_folder: null })).error === null, 'move 2');
  const now = await docsOf(anna);
  assert(!now.includes('arculat.pdf') && now.includes('kesobbi.txt'), `after moving out: ${now}`);
  assert((await anna.client.storage.from(BUCKET).createSignedUrl(folderDoc.row.storage_path, 60)).error, 'moved-out file still downloadable');
});

await check('the trash hides a shared file; restoring brings it back; revoking the share ends it', async () => {
  await owner.client.from('project_documents').update({ trashed_at: new Date().toISOString() }).eq('id', direct.row.id);
  assert(!(await docsOf(anna)).includes('kesobbi.txt'), 'trashed file listed');
  assert((await anna.client.storage.from(BUCKET).createSignedUrl(direct.row.storage_path, 60)).error, 'trashed file downloadable');
  assert(!(await owner.client.rpc('document_restore', { p_id: direct.row.id })).error, 'restore');
  assert((await docsOf(anna)).includes('kesobbi.txt'), 'restored file not listed');
  const a = await acctOf(anna.email);
  await owner.client.from('document_shares').update({ revoked_at: new Date().toISOString() }).eq('account_id', a).eq('document_id', direct.row.id).is('revoked_at', null);
  assert(!(await docsOf(anna)).includes('kesobbi.txt'), 'revoked share still listed');
  assert((await anna.client.storage.from(BUCKET).createSignedUrl(direct.row.storage_path, 60)).error, 'revoked share still downloadable');
});

await check('a foreign id grants nothing: another company\'s client, another client\'s upload', async () => {
  const mine = (await anna.client.rpc('client_portal_uploads')).data[0];
  const path = (await admin.from('project_documents').select('storage_path').eq('id', mine.document_id).single()).data.storage_path;
  assert((await cili.client.rpc('client_finish_upload', { p_id: mine.document_id })).error, 'cili finished anna\'s upload');
  assert((await cili.client.rpc('client_mark_upload', { p_id: mine.document_id, p_state: 'failed', p_reason: 'cancelled' })).error, 'cili marked anna\'s upload');
  assert((await cili.client.rpc('client_begin_upload', { p_project: PA, p_name: 'x.pdf', p_size: 9, p_type: null, p_kind: 'pdf' })).error, 'cili uploaded into A');
  assert((await cili.client.storage.from(BUCKET).createSignedUrl(path, 60)).error, 'cili got a download link');
  assert((await cili.client.storage.from(BUCKET).download(shared.row.storage_path)).error, 'cili downloaded a shared file of A');
  const list = await cili.client.storage.from(BUCKET).list(PA);
  assert(list.error || list.data.length === 0, `cili listed ${list.data?.length}`);
});

await check('client limits: over 50 MB, a forbidden type and a mismatched content are refused before any link', async () => {
  const big = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'huge.mp4', p_size: 52428801, p_type: null, p_kind: 'isobmff' });
  assert(big.error, 'over 50 MB accepted');
  const exe = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'setup.exe', p_size: 10, p_type: null, p_kind: 'pdf' });
  assert(exe.error, '.exe accepted');
  const html = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'page.pdf', p_size: 10, p_type: null, p_kind: 'html' });
  assert(html.error, 'html content as .pdf accepted');
  // And Storage itself: a row that says 5 bytes, bytes that are 50 MB + 1.
  const { data } = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'liar.pdf', p_size: 5, p_type: null, p_kind: 'pdf' });
  const s = await anna.client.storage.from(BUCKET).createSignedUploadUrl(data[0].storage_path);
  const status = await put(s.data.signedUrl, Buffer.alloc(52428801));
  assert(status >= 400, `oversized PUT answered ${status}`);
  assert((await anna.client.rpc('client_finish_upload', { p_id: data[0].id })).data === 'missing', 'oversized object stored');
  return `Storage answered ${status} to 50 MB + 1`;
});

await check('an interrupted upload stays pending, can be marked failed, retried and finished', async () => {
  const { data } = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'megszakadt.pdf', p_size: 9, p_type: null, p_kind: 'pdf' });
  const row = data[0];
  assert((await anna.client.rpc('client_finish_upload', { p_id: row.id })).data === 'missing', 'finish without bytes');
  assert((await anna.client.rpc('client_mark_upload', { p_id: row.id, p_state: 'failed', p_reason: 'network' })).data === 'failed', 'mark failed');
  assert((await anna.client.rpc('client_mark_upload', { p_id: row.id, p_state: 'pending' })).data === 'pending', 'retry');
  const s = await anna.client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path);
  assert((await put(s.data.signedUrl, Buffer.from('%PDF-1.4\n'))) === 200, 'retry PUT');
  assert((await anna.client.rpc('client_finish_upload', { p_id: row.id })).data === 'ready', 'retry finish');
  assert((await anna.client.rpc('client_mark_upload', { p_id: row.id, p_state: 'failed', p_reason: 'network' })).error, 'a finished upload marked failed');
});

await check('a client\'s upsert link cannot overwrite their finished upload', async () => {
  const { data } = await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'vegleges.txt', p_size: 5, p_type: null, p_kind: 'text' });
  const row = data[0];
  const s = await anna.client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path, { upsert: true });
  const url = s.error ? (await anna.client.storage.from(BUCKET).createSignedUploadUrl(row.storage_path)).data.signedUrl : s.data.signedUrl;
  assert((await put(url, Buffer.from('hello'), true)) === 200, 'first PUT');
  assert((await anna.client.rpc('client_finish_upload', { p_id: row.id })).data === 'ready', 'not ready');
  const second = await put(url, Buffer.from('EVIL!'), true);
  const dl = await owner.client.storage.from(BUCKET).download(row.storage_path);
  assert((await dl.data.text()) === 'hello', 'overwritten');
  return `upsert link issued: ${!s.error}; overwrite answered ${second}`;
});

await check('no internal project or finance field in anything a client receives', async () => {
  const allowed = {
    client_portal_me: ['company', 'full_name'],
    client_portal_projects: ['project_id', 'project_name'],
    client_portal_documents: ['byte_size', 'document_id', 'name', 'project_id', 'project_name', 'shared_at', 'via_folder'],
    client_portal_uploads: ['byte_size', 'document_id', 'failure_reason', 'name', 'project_id', 'project_name', 'state', 'uploaded_at'],
  };
  for (const [fn, keys] of Object.entries(allowed)) {
    const r = await anna.client.rpc(fn);
    assert(!r.error && r.data.length > 0, `${fn}: ${r.error?.message ?? 'empty'}`);
    for (const row of r.data) assert(JSON.stringify(Object.keys(row).sort()) === JSON.stringify(keys), `${fn} returned ${Object.keys(row)}`);
  }
  const raw = JSON.stringify(await Promise.all(Object.keys(allowed).map((f) => anna.client.rpc(f).then((x) => x.data))));
  assert(!/1000|paid|invoice|market|milestone|blocked|value/i.test(raw.replace(/"(name|project_name)":"[^"]*"/g, '')), 'an internal figure leaked');
  for (const t of ['project_instalments', 'project_payments', 'project_finance_legacy', 'project_costs', 'record_notes', 'activity_logs', 'opportunities', 'impact_applications']) {
    const r = await anna.client.from(t).select('*').limit(3);
    assert(r.error || r.data.length === 0, `${t}: ${r.data?.length} rows`);
  }
  const o = await anna.client.rpc('project_payment_overview', { p_project: null });
  assert(o.error || o.data.length === 0, 'payment overview returned rows');
});

await check('revoking the account ends everything at once', async () => {
  await owner.client.from('client_accounts').update({ status: 'revoked' }).eq('email', anna.email);
  assert(((await anna.client.rpc('client_portal_projects')).data ?? []).length === 0, 'projects still listed');
  assert(((await anna.client.rpc('client_portal_documents')).data ?? []).length === 0, 'documents still listed');
  assert((await anna.client.storage.from(BUCKET).createSignedUrl(shared.row.storage_path, 60)).error, 'download after revoke');
  assert((await anna.client.rpc('client_begin_upload', { p_project: PA, p_name: 'x.pdf', p_size: 9, p_type: null, p_kind: 'pdf' })).error, 'upload after revoke');
});

await check('password reset e-mail through the local mail catcher, to the allowed redirect', async () => {
  if (!MAILPIT) throw new Error('LIVE_MAILPIT_URL not set');
  const email = bela.email;
  const redirect = process.env.LIVE_RESET_REDIRECT ?? 'http://127.0.0.1:4322/portal/reset-password';
  const r = await createClient(URL_, ANON, opts).auth.resetPasswordForEmail(email, { redirectTo: redirect });
  assert(!r.error, r.error?.message);
  let msg;
  for (let i = 0; i < 20 && !msg; i += 1) {
    const list = await (await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)).json();
    msg = list.messages?.[0];
    if (!msg) await new Promise((res) => setTimeout(res, 500));
  }
  assert(msg, 'no e-mail arrived at the local mail catcher');
  const full = await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json();
  const link = /href="([^"]+verify[^"]+)"/.exec(full.HTML ?? '')?.[1]?.replace(/&amp;/g, '&');
  assert(link && new URL(link).hostname === host, 'no local verify link in the e-mail');
  const res = await fetch(link, { redirect: 'manual' });
  const location = res.headers.get('location') ?? '';
  assert(location.startsWith(redirect) && /access_token=/.test(location), `redirected to ${location.split('#')[0]}`);
  const token = new URLSearchParams(location.split('#')[1]).get('access_token');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert(claims.email === email, 'the reset session is for another account');
  const me = await (await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, authorization: `Bearer ${token}` } })).json();
  assert(me.email === email, 'GoTrue does not accept the reset session');
  return `redirect ${redirect} honoured`;
});


/* ========== phase 7: demo links, meetings, help — real PostgREST, real Auth */

await check('phase 7: published demos and upcoming meetings reach only the assigned client; revoking the assignment ends both', async () => {
  const eva = await inviteAndAccept(owner, orgA, 'eva', [PA]);
  const iris = await inviteAndAccept(owner, orgB, 'iris', [PB]);
  const d = await owner.client.from('project_demos').insert({ project_id: PA, title: 'Weboldal demó', url: 'https://demo.example.com/a', client_note: 'Nézd meg', published: true }).select('id').single();
  assert(!d.error, d.error?.message);
  const hidden = await owner.client.from('project_demos').insert({ project_id: PA, title: 'Rejtett', url: 'https://demo.example.com/h' }).select('id').single();
  assert(!hidden.error, hidden.error?.message);
  const soon = new Date(Date.now() + 86400e3).toISOString(); const end = new Date(Date.now() + 90000e3).toISOString();
  const m = await owner.client.from('project_meetings').insert({ project_id: PA, title: 'Egyeztetés', starts_at: soon, ends_at: end, join_url: 'https://meet.example.com/x' }).select('id').single();
  assert(!m.error, m.error?.message);
  const demos = await eva.client.rpc('client_portal_demos');
  assert(!demos.error && demos.data.map((x) => x.title).join() === 'Weboldal demó', JSON.stringify(demos.data ?? demos.error));
  const meets = await eva.client.rpc('client_portal_meetings');
  assert(!meets.error && meets.data.length === 1 && meets.data[0].title === 'Egyeztetés', JSON.stringify(meets.data ?? meets.error));
  for (const [label, c] of [['other company', iris.client], ['anon', createClient(URL_, ANON, opts)]]) {
    const x = await c.rpc('client_portal_demos'); const y = await c.rpc('client_portal_meetings');
    assert((x.error || x.data.length === 0) && (y.error || y.data.length === 0), `${label} sees them`);
    const direct = await c.from('project_demos').select('*');
    assert(direct.error || direct.data.length === 0, `${label} reads the table`);
  }
  const bad = await owner.client.from('project_demos').insert({ project_id: PA, title: 'x', url: 'javascript:alert(1)' });
  assert(bad.error, 'javascript: URL accepted');
  const acct = (await admin.from('client_accounts').select('id').eq('email', eva.email).single()).data.id;
  await owner.client.from('client_project_access').update({ revoked_at: new Date().toISOString() }).eq('account_id', acct).is('revoked_at', null);
  const after = await eva.client.rpc('client_portal_demos'); const after2 = await eva.client.rpc('client_portal_meetings');
  assert(after.data.length === 0 && after2.data.length === 0, 'revoked client still sees demos or meetings');
});

await check('phase 7: a client reads published help articles only, without source or review note', async () => {
  const cl = await inviteAndAccept(owner, orgA, 'hanna', [PA]);
  const r = await cl.client.rpc('client_help_articles');
  assert(!r.error && r.data.length > 0, r.error?.message ?? 'empty');
  assert(JSON.stringify(Object.keys(r.data[0]).sort()) === JSON.stringify(['alt_questions', 'answer', 'article_id', 'question', 'topic']), Object.keys(r.data[0]).join());
  const drafts = (await admin.from('help_articles').select('id').eq('status', 'draft')).data.map((x) => x.id);
  assert(!r.data.some((x) => drafts.includes(x.article_id)), 'a draft reached a client');
  const direct = await cl.client.from('help_articles').select('*');
  assert(direct.error || direct.data.length === 0, 'client reads the table');
  return `${r.data.length} published, ${drafts.length} drafts withheld`;
});


/* ============== phase 8: demo feedback and reschedule — real PostgREST, real Auth */

await check('phase 8: feedback under a demo reaches the owner; a proposed time is accepted and moves the meeting; others see nothing', async () => {
  const zoe = await inviteAndAccept(owner, orgA, 'zoe', [PA]);
  const kim = await inviteAndAccept(owner, orgB, 'kim', [PB]);
  const d = (await owner.client.from('project_demos').insert({ project_id: PA, title: 'Demó 8', url: 'https://demo.example.com/8', published: true }).select('id').single()).data.id;
  const s0 = new Date(Date.now() + 2 * 86400e3).toISOString(); const e0 = new Date(Date.now() + 2 * 86400e3 + 3600e3).toISOString();
  const m = (await owner.client.from('project_meetings').insert({ project_id: PA, title: 'Egyeztetés 8', starts_at: s0, ends_at: e0, location: 'Iroda' }).select('id').single()).data.id;
  const fb = await zoe.client.rpc('client_send_demo_feedback', { p_demo: d, p_body: 'Tetszik, de a gomb legyen zöld.' });
  assert(!fb.error, fb.error?.message);
  assert((await kim.client.rpc('client_send_demo_feedback', { p_demo: d, p_body: 'x' })).error, 'another company sent feedback');
  const seen = await owner.client.from('demo_feedback').select('body, account:client_accounts(full_name)').eq('demo_id', d);
  assert(!seen.error && seen.data.length === 1 && seen.data[0].body === 'Tetszik, de a gomb legyen zöld.', JSON.stringify(seen.error ?? seen.data));
  assert((await kim.client.from('demo_feedback').select('*')).data?.length === 0, 'client reads the table');
  const s1 = new Date(Date.now() + 3 * 86400e3).toISOString(); const e1 = new Date(Date.now() + 3 * 86400e3 + 3600e3).toISOString();
  const rq = await zoe.client.rpc('client_request_meeting_change', { p_meeting: m, p_starts: s1, p_ends: e1, p_time_zone: 'Europe/Budapest', p_message: 'Szerda jobb.' });
  assert(!rq.error, rq.error?.message);
  assert((await zoe.client.from('meeting_change_requests').update({ status: 'accepted' }).eq('id', rq.data)).error
    || (await admin.from('meeting_change_requests').select('status').eq('id', rq.data).single()).data.status === 'pending', 'client decided its own request');
  const direct = await owner.client.from('meeting_change_requests').update({ status: 'accepted' }).eq('id', rq.data).select('id');
  assert(direct.error || direct.data.length === 0, 'the owner bypassed the decision function');
  const dec = await owner.client.rpc('owner_decide_meeting_request', { p_request: rq.data, p_accept: true, p_note: null });
  assert(!dec.error && dec.data === 'accepted', JSON.stringify(dec.error ?? dec.data));
  const now = await zoe.client.rpc('client_portal_meetings');
  const moved = now.data.find((x) => x.meeting_id === m);
  assert(new Date(moved.starts_at).getTime() === new Date(s1).getTime(), `meeting at ${moved.starts_at}`);
  const mine = await zoe.client.rpc('client_portal_meeting_requests');
  assert(mine.data.length === 1 && mine.data[0].status === 'accepted', JSON.stringify(mine.data));
  assert(((await kim.client.rpc('client_portal_meeting_requests')).data ?? []).length === 0, 'another company sees the request');
});

console.log(`\n${results.filter(Boolean).length}/${results.length} live client-portal checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
