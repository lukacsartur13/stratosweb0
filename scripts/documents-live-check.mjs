// =============================================================================
// Document library — checks against a REAL, LOCAL Supabase (Storage, Auth,
// PostgREST). The only check in this repository that talks to real Supabase
// services; everything else is PGlite (tests/portal-documents-db.spec.ts) or a
// mock (scripts/portal-documents-check.mjs).
//
//     LIVE_SUPABASE_URL=http://127.0.0.1:54321 \
//     LIVE_SUPABASE_ANON_KEY=<local anon key> \
//     LIVE_SUPABASE_SECRET_KEY=<local server key> \
//     LIVE_CONFIRM_LOCAL=yes \
//     node scripts/documents-live-check.mjs
//
// LOCAL ONLY. It refuses to start unless the URL's host is localhost,
// 127.0.0.1, [::1] or *.localhost, and LIVE_CONFIRM_LOCAL=yes. It creates test
// users, a client, a project and files, and it leaves them there (it deletes
// nothing — that is the library's own rule). Never point it at production.
//
// Preparing the local database is described in supabase/DOCUMENTS.md §7: the
// migrations must be applied in the runbook's order, because the lockdown
// refuses to run before an owner exists.
//
// Keys and passwords are read from the environment or generated, and are never
// printed. Signed URLs are never printed either — only their lifetimes.
//
// Exit code 0 when every check passes, 1 otherwise, 2 when it refuses to run.
// =============================================================================
import { createClient } from '@supabase/supabase-js';
import { randomBytes, randomUUID } from 'node:crypto';

const URL_ = process.env.LIVE_SUPABASE_URL ?? '';
const ANON = process.env.LIVE_SUPABASE_ANON_KEY ?? '';
const SERVER = process.env.LIVE_SUPABASE_SECRET_KEY ?? '';
const BUCKET = 'project-documents';
const MAX = 52428800;

function refuse(why) {
  console.error(`documents-live-check: refusing to run — ${why}`);
  process.exit(2);
}
let host = '';
try { host = new URL(URL_).hostname; } catch { refuse('LIVE_SUPABASE_URL is missing or not a URL'); }
if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) && !host.endsWith('.localhost')) {
  refuse(`${host} is not a local host. This check never runs against a hosted project.`);
}
if (process.env.LIVE_CONFIRM_LOCAL !== 'yes') refuse('set LIVE_CONFIRM_LOCAL=yes to confirm this is a disposable local stack');
if (!ANON || !SERVER) refuse('LIVE_SUPABASE_ANON_KEY and LIVE_SUPABASE_SECRET_KEY are required');

const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(URL_, SERVER, opts);
const results = [];
async function check(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true }); console.log(`  ok   ${name}${note ? ` — ${note}` : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  FAIL ${name}\n       ${String(e.message).split('\n')[0]}`); }
}
const assert = (cond, msg) => { if (!cond) throw new Error(msg); };
const run = randomUUID().slice(0, 8);
const password = () => randomBytes(18).toString('base64url');

/** A user with a role, signed in with its own client. */
async function user(label, role) {
  const email = `docs-${label}-${run}@example.invalid`;
  const pw = password();
  const { data, error } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (error) throw new Error(`create ${label}: ${error.message}`);
  const up = await admin.from('profiles').update({ role }).eq('id', data.user.id);
  if (up.error) throw new Error(`role ${label}: ${up.error.message}`);
  const client = createClient(URL_, ANON, opts);
  const signIn = await client.auth.signInWithPassword({ email, password: pw });
  if (signIn.error) throw new Error(`sign in ${label}: ${signIn.error.message}`);
  return { id: data.user.id, email, client };
}

const tokenLifetime = (token) => {
  const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  return payload.exp - payload.iat;
};

/** PUT raw bytes to a signed upload URL, as the Portal does. */
async function put(signedUrl, body, contentType = 'application/octet-stream') {
  const res = await fetch(signedUrl, {
    method: 'PUT', body, headers: { 'content-type': contentType, 'x-upsert': 'false', apikey: ANON },
  });
  return res.status;
}

console.log(`documents-live-check against ${host} (run ${run})`);

// --------------------------------------------------------------- setup
const owner = await user('owner', 'super_admin');
const second = await user('super2', 'super_admin');
const staff = await user('admin', 'admin');
const anon = createClient(URL_, ANON, opts);

const designate = await admin.rpc('portal_set_owner', { p_email: owner.email });
if (designate.error) refuse(`portal_set_owner failed (${designate.error.message}) — is the runbook applied? See DOCUMENTS.md §7`);

const org = await admin.from('organizations').insert({ name: `Docs check ${run}`, slug: `docs-check-${run}` }).select('id').single();
if (org.error) refuse(`seed client: ${org.error.message}`);
const project = await admin.from('projects').insert({
  organization_id: org.data.id, name: `Docs check ${run}`, slug: `docs-check-${run}`, status: 'active',
}).select('id').single();
if (project.error) refuse(`seed project: ${project.error.message}`);
const P = project.data.id;

const begin = async (name, size, kind) => {
  const { data, error } = await owner.client.rpc('document_begin_upload', {
    p_project: P, p_folder: null, p_name: name, p_size: size, p_type: null, p_kind: kind,
  });
  if (error) throw new Error(`begin ${name}: ${error.message}`);
  return data[0];
};
const sign = (client, path, upsert = false) => client.storage.from(BUCKET).createSignedUploadUrl(path, upsert ? { upsert: true } : undefined);
const finish = async (id) => (await owner.client.rpc('document_finish_upload', { p_id: id })).data;

// --------------------------------------------------------------- checks
await check('the bucket is private, 50 MB, octet-stream only', async () => {
  const { data, error } = await admin.storage.getBucket(BUCKET);
  assert(!error, error?.message);
  assert(data.public === false, 'bucket is public');
  assert(Number(data.file_size_limit) === MAX, `file_size_limit ${data.file_size_limit}`);
  assert(JSON.stringify(data.allowed_mime_types) === '["application/octet-stream"]', `allowed_mime_types ${JSON.stringify(data.allowed_mime_types)}`);
});

let first;
let firstUrl;
await check('owner: begin → signed URL → PUT → finish = ready; the link lifetime is reported', async () => {
  first = await begin('live.pdf', 9, 'pdf');
  const s = await sign(owner.client, first.storage_path);
  assert(!s.error, `sign: ${s.error?.message}`);
  firstUrl = s.data.signedUrl;
  const status = await put(firstUrl, Buffer.from('%PDF-1.4\n'));
  assert(status === 200, `PUT ${status}`);
  assert((await finish(first.id)) === 'ready', 'not ready');
  assert((await finish(first.id)) === 'ready', 'repeat finish not ready');
  return `signed upload URL lifetime observed: ${tokenLifetime(s.data.token)} s`;
});

await check('the SAME earlier link cannot overwrite the finished document', async () => {
  const status = await put(firstUrl, Buffer.from('%PDF-evil'));
  assert(status >= 400, `re-used link answered ${status}`);
  const dl = await owner.client.storage.from(BUCKET).download(first.storage_path);
  assert(!dl.error && (await dl.data.text()) === '%PDF-1.4\n', 'content changed');
  return `answered ${status}`;
});

await check('a finished path cannot get a new link, with or without upsert', async () => {
  assert((await sign(owner.client, first.storage_path)).error, 'new link issued for a finished path');
  assert((await sign(owner.client, first.storage_path, true)).error, 'upsert link issued for a finished path');
});

// Storage DOES issue an upsert link for a pending path (it checks only the
// INSERT policy then), and a token upload runs as Storage's superuser. What
// must hold is that such a link can never replace a FINISHED document: the
// no-overwrite trigger on storage.objects (20260930000100) refuses the update.
await check('an upsert link issued while pending cannot overwrite the finished document', async () => {
  const d = await begin('upsert.txt', 5, 'text');
  const s = await sign(owner.client, d.storage_path, true);
  const issued = !s.error;
  const url = issued ? s.data.signedUrl : (await sign(owner.client, d.storage_path)).data.signedUrl;
  const putUp = (body) => fetch(url, { method: 'PUT', body, headers: { 'content-type': 'application/octet-stream', 'x-upsert': 'true', apikey: ANON } }).then((r) => r.status);
  assert((await putUp(Buffer.from('hello'))) === 200, 'first upload failed');
  assert((await finish(d.id)) === 'ready', 'not ready');
  const second = await putUp(Buffer.from('EVIL!'));
  const dl = await owner.client.storage.from(BUCKET).download(d.storage_path);
  assert(!dl.error && (await dl.data.text()) === 'hello', 'the finished document was overwritten');
  assert(second >= 400, `overwrite answered ${second}`);
  return `upsert link issued: ${issued}; overwrite answered ${second}; content unchanged`;
});

await check('Storage refuses any Content-Type but application/octet-stream', async () => {
  const d = await begin('typed.txt', 5, 'text');
  const s = await sign(owner.client, d.storage_path);
  const status = await put(s.data.signedUrl, Buffer.from('<b>x'), 'text/html');
  assert(status >= 400, `text/html upload answered ${status}`);
  return `answered ${status}`;
});

await check('Storage refuses one byte over 50 MB even when the row said 50 MB', async () => {
  const d = await begin('big.mp4', MAX, 'isobmff');
  const s = await sign(owner.client, d.storage_path);
  const status = await put(s.data.signedUrl, Buffer.alloc(MAX + 1));
  assert(status === 413 || status === 400, `oversized upload answered ${status}`);
  assert((await finish(d.id)) === 'missing', 'an oversized object was stored');
  return `answered ${status}`;
});

await check('a wrong-size object fails the finish', async () => {
  const d = await begin('short.txt', 10, 'text');
  const s = await sign(owner.client, d.storage_path);
  assert((await put(s.data.signedUrl, Buffer.from('123456789'))) === 200, 'PUT failed');
  assert((await finish(d.id)) === 'failed', 'wrong size accepted');
});

await check('a download link expires when it says', async () => {
  const s = await owner.client.storage.from(BUCKET).createSignedUrl(first.storage_path, 2, { download: 'live.pdf' });
  assert(!s.error, s.error?.message);
  const before = await fetch(s.data.signedUrl);
  assert(before.status === 200, `fresh link ${before.status}`);
  assert(/attachment/.test(before.headers.get('content-disposition') ?? ''), 'not served as an attachment');
  await new Promise((r) => setTimeout(r, 3500));
  const after = await fetch(s.data.signedUrl);
  assert(after.status >= 400, `expired link answered ${after.status}`);
  return `after expiry: ${after.status}; content-type served: ${before.headers.get('content-type')}`;
});

await check('the owner cannot delete or replace a stored object through the API', async () => {
  const rm = await owner.client.storage.from(BUCKET).remove([first.storage_path]);
  const still = await owner.client.storage.from(BUCKET).download(first.storage_path);
  assert(!still.error, `object gone after remove (${rm.error?.message ?? 'no error'})`);
  const upd = await owner.client.storage.from(BUCKET).update(first.storage_path, Buffer.from('x'), { contentType: 'application/octet-stream' });
  assert(upd.error, 'update succeeded');
});

for (const [label, who] of [['second super_admin', second], ['admin', staff], ['anon', { client: anon }]]) {
  await check(`${label}: no row, no link, no download, no list`, async () => {
    const rows = await who.client.from('project_documents').select('id');
    assert(rows.error || rows.data.length === 0, `${rows.data?.length} rows visible`);
    const pending = await begin(`probe-${label.replace(/\W/g, '')}.txt`, 1, 'text');
    assert((await sign(who.client, pending.storage_path)).error, 'upload link issued');
    assert((await who.client.storage.from(BUCKET).download(first.storage_path)).error, 'download worked');
    assert((await who.client.storage.from(BUCKET).createSignedUrl(first.storage_path, 60)).error, 'download link issued');
    const list = await who.client.storage.from(BUCKET).list(P);
    assert(list.error || list.data.length === 0, `${list.data?.length} objects listed`);
    const started = await who.client.rpc('document_begin_upload', { p_project: P, p_folder: null, p_name: 'x.txt', p_size: 1, p_type: null, p_kind: 'text' });
    assert(started.error, 'begin succeeded');
  });
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} live document checks passed`);
console.log(`left in place (local): client "Docs check ${run}", its project, test users docs-*-${run}@example.invalid`);
process.exit(failed.length ? 1 : 0);
