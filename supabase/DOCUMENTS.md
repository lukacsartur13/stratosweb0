# The document library (phase 3)

> The complete, current apply order for phases 1–5 is **`PORTAL_RELEASE.md`**.

The owner's private document store for paid and Impact projects: a
**Documents** screen with a folder per project, and the same files on each
project's own screen. Built on phases 1–2 (`OWNER_TRACKER.md`). Nothing here has
been applied to the production database or storage, nothing is deployed, and no
invitation was sent. This file is the runbook for doing so.

- Migration: `migrations/20260930000100_document_library.sql`
- Checks: `checks/documents-preflight.sql`, `checks/documents-verify.sql`
- Rollback: `checks/documents-rollback.sql`
- Portal: `portal/src/lib/documents.ts`, `lib/documentRules.ts`,
  `features/documents/ProjectLibrary.tsx`, `features/documents/ProjectFacts.tsx`,
  `pages/documents.tsx`; the panel in `pages/projects.tsx`
- Tests: three separate layers — see §8

---

## 1. The model

| Piece | Where | Rule |
| --- | --- | --- |
| Object key | `project_documents.storage_path` | **Generated**: `<project_id>/<document_id>`. No user-supplied name is ever part of a key. |
| Folders | `document_folders` | A tree per project; the project itself is the top. Composite FK `(project_id, parent_id)` → a parent in another project cannot be written; a trigger refuses cycles. |
| Documents | `project_documents` | One row per file; `name` is display only. `project_id`, `byte_size` and `content_kind` are fixed once written. |
| Lifecycle | `upload_state` | `pending` → `ready` \| `failed`; `failed` → `pending` (retry); `ready` is final. `ready` is only accepted when `storage.objects` holds the key at exactly `byte_size` and within the limit — checked by the row trigger, so a direct PATCH cannot claim it either. |
| Same name | unique index per folder, case-insensitive, excluding the trash | An upload, a move or a restore onto a taken name is **numbered** (`offer (2).pdf`); a typed rename or new folder that collides is **refused**. Nothing overwrites. |
| Type | `content_kind` + `project_documents_type_allowed` | Name and content must agree, on insert and on every rename (§3). |
| Trash | `trashed_at`, `trashed_by`, `trashed_with` | Reversible. A trashed folder takes its live contents with it and restoring it brings back exactly those. Restoring a file inside a trashed folder restores the folders above it. |
| Deletion | — | None. No DELETE grant on either table (for any role, the owner included), no DELETE or UPDATE policy on this bucket's objects. |
| Projects | `on delete restrict` | A project with documents or folders cannot be deleted (nor, therefore, its client, whose delete would cascade to it). Closing, reopening and archiving never touch a document row or object. |

`media_assets` (2026-08-01) is an older, unused scaffold — no bucket, no screen.
It is untouched and is **not** part of this library.

**Phase 4 builds on this library** — client accounts, sharing and client
uploads into each project's raw-material folder, with the same lifecycle,
types, limit and bucket. See `CLIENT_PORTAL.md`; its migration extends this
bucket's policies to a client's own pending uploads and to what is shared with
them, inside the same restrictive guards.

---

## 2. The bucket

Created — and forced back on every re-apply — by the migration. If it is ever
created or edited by hand in the dashboard, these are the values:

| Setting | Value | Why |
| --- | --- | --- |
| Name / id | `project-documents` | Referenced by the policies and the Portal. |
| Public | **off** | No object has a public URL; every read is a policy-checked request or a signed URL. |
| File size limit | **52428800** (50 MiB) | Enforced by Storage on the upload itself; the same number is `document_max_bytes()`, checked again at start and at finish. The project's global upload limit (Settings → Storage) must be at least this. |
| Allowed MIME types | **`application/octet-stream` only** | Storage checks each upload's `Content-Type` against this list, so nothing in the bucket can be stored as `text/html`, `image/svg+xml` or any other type a browser would render. The real type is decided from content (§3). |
| Policies | the six in the migration, §8 of it | Owner select; owner insert only at a pending row's key; four RESTRICTIVE guards. Nothing else is needed and nothing else should name this bucket. |

---

## 3. What may be uploaded

### The list

| Group | Extensions | Content that must be there |
| --- | --- | --- |
| Documents | `pdf` | `%PDF-` |
| | `docx xlsx pptx odt ods odp` | ZIP container (`PK\x03\x04`) |
| | `doc xls ppt` | OLE compound file (`D0 CF 11 E0 A1 B1 1A E1`) |
| | `rtf` | `{\rtf` |
| | `txt csv md` | valid UTF-8, no NUL, not starting with markup (`<html`, `<!doctype`, `<script`, `<svg`, `<?xml`) |
| Images | `png jpg jpeg gif webp tif tiff` | the format's own signature |
| | `heic` | ISO media box (`ftyp` at byte 4) |
| | `svg` | UTF-8 text containing `<svg` — **stored, never previewed** |
| Design | `psd` | `8BPS` |
| | `ai` | PDF (`%PDF-`) or PostScript (`%!PS`) |
| | `eps` | PostScript (`%!PS`, or the binary EPS header) |
| Media | `mp4 mov m4a` | ISO media box (`ftyp`) |
| | `mp3` | `ID3` tag or an MPEG frame sync |
| Archive | `zip` | ZIP container — **never unpacked** by the Portal |

Everything else — executables, scripts, HTML, `rar`/`7z`, files with no
extension — is refused. Each file is at most **50 MB**.

The list lives in two places kept equal by a test: `document_kinds_for()` in the
migration and `ALLOWED_TYPES` in `portal/src/lib/documentRules.ts`
(`tests/portal-documents-db.spec.ts` → "the allowlist is the same list").
Changing it is a change to both, and to this table.

### How it is checked

1. **In the browser, before anything is sent:** the first 4 096 bytes of the
   file are read and matched against the signatures above (`sniffKind`). The
   extension alone, and the MIME type the browser declares, are never enough:
   a `.pdf` that is really HTML, or a `.docx` that is really a PDF, is refused
   with its own message, and no row or request is created for it.
2. **In the database:** the detected kind is stored as `content_kind`, and a
   CHECK requires that the name's extension allows that kind — at insert and at
   every rename. So a file cannot later be renamed into something else
   (`quote.pdf` → `quote.html`), and a mismatched pair cannot be written by any
   path.
3. **In Storage:** only `application/octet-stream` is accepted, and 50 MB is the
   ceiling (§2).

### The limits of that check — stated, not hidden

- **The content is inspected in the browser, not on a server.** Postgres cannot
  read an object's bytes. The database enforces that name and recorded kind
  agree; it cannot prove the recorded kind is true. The owner — the only
  uploader in this phase — could bypass the browser by calling the API
  directly. For an owner-only library that is an accepted limit. **Before
  clients can upload (next phase), a server-side check of the stored object's
  first bytes is required** (e.g. an Edge Function reading a byte range and
  marking the row), as `OWNER_TRACKER.md` §8 already records.
- **A signature says what a file is, not that it is harmless.** A genuine PDF can
  carry JavaScript, an Office file can carry macros, a ZIP can hold anything,
  an image can be malformed on purpose.
- **There is no virus scanning.** Nothing in the Portal or in Supabase scans
  these files, and nothing here claims they are virus-free. The Portal's upload
  hint says so. Open downloaded files with the same care as email attachments.

---

## 4. Upload, download, preview

### Upload — the bytes never pass through a Netlify function

1. `checkUploadable` in the browser (§3). Refused → that file fails, alone.
2. `document_begin_upload(project, folder, name, size, type, kind)` → a `pending`
   row under a free name; refuses anything over the limit or off the list.
3. `storage.createSignedUploadUrl(<key>)` → Storage runs the owner's INSERT
   policy for exactly that key. **One link = one document path**, and only while
   that row is `pending`.
4. The browser PUTs the file to that link (XHR, for per-file progress) as
   `application/octet-stream` with `x-upsert: false`.
5. `document_finish_upload(id)` → the database reads what Storage actually holds
   and answers `ready`, `missing` (left pending) or `failed` (`too_large` /
   `size_mismatch`). Idempotent: a repeat answers `ready`.

Every file is its own item with its own progress, error and **Retry**; up to two
upload at a time, and one failing never stops the others. The file picker
(**Upload**) and drag-and-drop do the same thing.

| Failure | Handling |
| --- | --- |
| Type refused (§3) | Fails before any request; no Retry (it cannot help). |
| Database save fails at the start | That file fails with Retry; no row, no PUT. Retry starts it again. |
| Dropped connection / 5xx | Two automatic retries with backoff, each with a fresh link, then `failed: network` and Retry. |
| **Expired or refused link** (4xx) | A **fresh** link is requested on the next attempt; an old link is never reused. After the attempts: `failed: storage_refused`. |
| 413 | `failed: too_large`; no Retry. |
| 409 on PUT | An object is already at the key → `finish` decides whether it is the right one. |
| Finish call fails (database save after upload) | `failed: network`; **Retry asks `finish` first and does not send the file again** if it landed. |
| Tab closed mid-upload | The browser asks first. If closed anyway, the row stays `pending`; `document_reconcile()` finishes it if the object exists, or marks it `failed: expired` after `document_pending_ttl()` (3 h). |
| Cancelled | `failed: cancelled`. |
| Object missing / oversized / wrong size | Never `ready` (trigger); `failed` with the reason. |

### Links issued earlier cannot overwrite a finished document

- A link can only be **issued** for a `pending` row's key (the INSERT policy and
  its restrictive guard), and never again once the row is `ready`.
- **Correction (real local Supabase, Storage 1.77):** Storage DOES issue an
  *upsert* link for a pending key — it checks only the INSERT policy — and a
  token upload runs as its superuser, so with upsert it UPDATEs the object row.
  Before the fix, such a link overwrote a finished document. The migration now
  puts a trigger on `storage.objects` (`project_documents_no_overwrite`) that
  refuses every UPDATE in this bucket; the overwrite answers 400 and the
  original bytes stay (see `PORTAL_RELEASE.md` §7).
- A link issued while the row was pending and **used again later** meets the
  existing object: Storage's upload has no upsert, so it fails with `409
  Duplicate`. Per the Storage source, the new bytes are written under a new
  version key and deleted on that failure — the finished document's bytes are
  never touched (§5).
- Residual case, documented rather than hidden: if a finished document's object
  were **removed by hand** in the dashboard while a link issued for it was still
  valid, that link could create a new object at the same key. It cannot touch
  any other key, and `document_storage_report()` flags it as `missing_object`
  (while gone) or `changed_object` (if the size differs). Removing objects by
  hand is only ever done after the report (§6).

### Download

`createSignedUrl(key, 60, { download: name })` — valid one minute, served as an
**attachment** under the display name, with the stored type
`application/octet-stream`. Held in a local variable for the one click; not
stored, not put in the app's URL, not logged.

### Preview — deliberately narrow

Only two things are ever shown inside the Portal:

- **Raster images** (PNG, JPEG, GIF, WebP) whose first bytes prove the format:
  an `<img>` of a `blob:` the page creates, re-typed to the sniffed image type.
- **Plain text** (`.txt`, `.csv`, `.md`) that is valid UTF-8 and does not start
  with markup: shown as React text in a `<pre>`, never parsed as HTML.

**PDF, SVG, HTML, Office files, archives and everything else download only.**
No iframe, `object`, `embed` or HTML injection exists in the library's code (a
test asserts it), no ZIP is unpacked, no archive or document-rendering library
is a dependency, and the site's CSP was not loosened for this feature (an
earlier `frame-src blob:` for a PDF preview was removed with the preview).

**On `blob:`.** The existing CSP allows `img-src … blob:`; the library uses it
for image previews. Allowing `blob:` proves nothing about a document's safety —
a blob is whatever bytes were put in it, and the same blob in another element
could be active content. What makes the preview safe is the combination above:
the bytes are sniffed first, only raster images and text qualify, the blob is
re-typed from the sniff (never from the stored or declared type), and it is only
ever put in an `<img>` or rendered as text.

---

## 5. The provider's actual behaviour (checked 2026-09-27, from source)

From the Supabase Storage server source (`supabase/storage`, `master`) and the
bundled `@supabase/storage-js` 2.111.0 — **not observed on a running
Supabase** (§9):

- **Issuing a signed upload link** runs `canUpload` — the INSERT policy, as the
  caller — for that one path. It does not check whether an object exists.
- **Uploading with the token** runs `asSuperUser()`: RLS is not re-checked at
  upload time. The permission is decided when the link is issued.
- **Upsert comes from the token**, fixed when the link is issued. The Portal
  never asks for it; the policies do NOT refuse it (observed) — the
  no-overwrite trigger does.
- **A duplicate is refused without touching the original**: the upload writes
  its bytes under a fresh version key, then fails the database step with
  `KeyAlreadyExists` (`409 Duplicate — The resource already exists`) and deletes
  the version it just wrote.
- **Size and type** are checked by `fileUploadFromRequest`: the size against the
  bucket's limit (from `Content-Length`, and while streaming), the MIME type —
  the request's `Content-Type` for a raw upload — against `allowed_mime_types`.
- **Expiry of upload links is server configuration**, not chosen by the client
  (`UPLOAD_SIGNED_URL_EXPIRATION_TIME`; open-source default 60 s; the client
  library documents 2 hours for the hosted service). The design does not depend
  on the value; `document_pending_ttl()` (3 h) exceeds the documented 2 h, and
  `scripts/documents-live-check.mjs` reports the value it observes.
- **Download links** take `expiresIn` from the caller: 60 s here.

---

## 6. Storage use, the trash and backups

**Files in the trash still occupy storage** — the trash is reversible because
the bytes are kept. Trashed and unfinished objects count against the Storage
quota until removed by hand in the dashboard (Storage → `project-documents`),
after checking `document_storage_report()` (Documents → Storage housekeeping →
Check uploads). The row of a document removed that way stays (it cannot be
deleted through the API) and is then reported as `missing_object`.

**Backups — what is and is not covered.** Supabase's database backups (daily,
or point-in-time on the plans that have it) cover the **rows**: documents,
folders, and Storage's own `storage.objects` catalogue. They do **not** contain
the **files**; the bytes live in Storage's object store and are not part of a
database backup or restore. Therefore:

1. Back the bucket up separately, on a schedule, with Supabase's S3-compatible
   Storage API (Settings → Storage → S3 access keys) and any S3 tool — e.g.
   `rclone sync` or `aws s3 sync` of the `project-documents` bucket to storage
   you control. The keys are server secrets: never in the repository or the
   Portal.
2. Keep the file copy and the database backup from the **same point in time**
   close together; a restore needs both, matched on `storage_path`.
3. After any restore, run **Check uploads**: `missing_object` means a row whose
   file did not come back, `orphan_object` a file whose row did not.
4. Nothing in this repository deletes a file, so the only way to lose one is by
   hand or by the provider. There is no automatic purge of the trash.

---

## 7. Apply order

After phases 1–2 (`OWNER_TRACKER.md` §10, steps 1–11). Each step is a separate
run in the Supabase SQL editor unless marked.

12. **Settings → Storage:** confirm the project's upload size limit is at least
    50 MB (the Free plan's maximum is 50 MB).
13. `checks/documents-preflight.sql` — read-only. First result all `true`.
    Review **every policy on `storage.objects`** it lists (the guards neutralise
    them for this bucket, but a policy that does not pin `bucket_id` is worth
    knowing about for the buckets it does open).
14. `20260930000100_document_library.sql` — refuses to run without the owner,
    the lockdown and the Impact migration. Creates the bucket with §2's values.
15. `checks/documents-verify.sql` — every row `ok`. Runs as the owner and as every
    other profile inside a transaction that ends in `ROLLBACK`; creates no object.
16. **Deploy the Portal** (not SQL). Deployed before step 14, the Documents screen
    and the project panel show "could not be read"; nothing else is affected.
17. First real check by hand (owner, on the deployed Portal): upload a small PDF,
    a PNG and a `.txt`; try a renamed `.exe` (refused); download, preview the
    image, trash and restore; sign in as any other account and confirm there is
    no Documents entry.
18. Set up the bucket backup (§6).

**Rollback — data-preserving.** `checks/documents-rollback.sql` drops the
owner's storage policies, **replaces the guards with one restrictive policy that
seals the bucket** (so no other policy can open it once the owner's are gone),
keeps the bucket private, and revokes every API grant. It deletes **no file, no
row and no metadata**: `project_documents`, `document_folders`, `storage.objects`
and the objects themselves stay exactly as they were. Re-applying the migration
restores access exactly (tested).

### A local Supabase for the live check

`supabase db reset` cannot apply this repository's migrations in one go: the
lockdown refuses to run before an owner exists (by design). For a disposable
local stack (`supabase start`, Docker):

1. `supabase start` with an empty migrations folder, then in the local SQL
   editor (Studio, port 54323) run the files of `OWNER_TRACKER.md` §10 and §7
   above in order. For step 4, first create and sign in a local account, set its
   role to `super_admin`, and designate it; the live check creates its own owner
   afterwards and re-designates.
2. Run `npm run check:documents:live` with `LIVE_SUPABASE_URL`,
   `LIVE_SUPABASE_ANON_KEY`, `LIVE_SUPABASE_SECRET_KEY` (from `supabase status`)
   and `LIVE_CONFIRM_LOCAL=yes`. It refuses any non-local host.

---

## 8. Tests — three separate layers

| Layer | Command | Talks to | Proves |
| --- | --- | --- | --- |
| Rules and contracts | `npm run test:documents` (with the next) → `tests/portal-documents.spec.ts` | nothing | content detection, the allowlist verdicts, preview rules, key classification, the build refusing a secret key, no iframe/HTML injection/unzipping, no server function touching documents, no CSP loosening |
| Database (PGlite) | `npm run test:documents` → `tests/portal-documents-db.spec.ts` | real Postgres 18.3 in WebAssembly, with a stand-in `storage` catalogue | every SQL rule and policy: lifecycle, links per path, no overwrite, types, names, folders, trash, access for every role, the SQL-editor checks, rollback |
| Rendered UI (mock) | `npm run check:documents:ui` → `scripts/portal-documents-check.mjs` | a fake PostgREST **and** Storage in the browser | the screens and the upload client's behaviour: per-file errors and retries, fresh links, keyboard and phone use |
| **Live (real Supabase)** | `npm run check:documents:live` → `scripts/documents-live-check.mjs` | a **local** Supabase: Auth, PostgREST, Storage | what only the real services can: the bucket's limits and MIME rule, link lifetime, reuse of an old link, upsert refusal, expiry of download links, every role against real Storage |

The first three never reach a real service. The fourth never reaches a
non-local one.

---

## 9. The browser key vs the server key

The anon key (a JWT whose role is `anon`) or the publishable key
(`sb_publishable_…`) is a public identifier: it ships in every Portal bundle and
RLS decides what it can do. The server key (`sb_secret_…`, or a JWT with any
other role) bypasses RLS.

- `scripts/supabase-key-kind.mjs` decides which is which from what the key says
  (prefix, or the JWT's role); an undecodable JWT counts as secret.
- **Build**: `portal/vite.config.ts` stops if `VITE_SUPABASE_ANON_KEY` holds a
  secret key, naming the variable and never printing the value.
- **Runtime**: `portal/src/lib/keyKind.ts` (asserted identical) — a secret key
  that reached a bundle is not used; the Portal reports "not configured".
- **Secret scan**: the `jwt` rule does not report an anon-role JWT (the built
  Portal legitimately contains one); every other JWT and `sb_secret_…` remain
  findings.

---

## 10. What was verified, and what was not

**Verified locally without real Supabase** — PGlite and the mocked UI; see §8
for what each layer can and cannot prove. Totals at the end of this phase: 39
database tests, 18 rule/contract tests, 18 rendered checks, all passing.

**Since verified on a real LOCAL Supabase** (Colima + Supabase CLI, 2026-09-27):
`npm run check:documents:live` 13/13 — see `PORTAL_RELEASE.md` §11. The list
below was the state before that run; what remains open for the HOSTED project is
in `PORTAL_RELEASE.md` §11.

**Not verified at the time — no real Supabase was available** (no Supabase CLI or Docker on
the machine this was built on, and production was not to be touched). The live
check exists and refuses non-local hosts, but **has not been run**. Unverified
until it is:

- Storage enforcing the bucket's 50 MB limit and `application/octet-stream`
  rule on a real upload;
- the real lifetime of an upload link, and a re-used link answering 409;
- Storage evaluating these policies (including `is_owner()` and the restrictive
  guards) for signing, download, list, update and remove;
- download links expiring, and being served as attachments;
- CORS for the direct PUT from the Portal's origin;
- that the SQL editor's role may create policies on `storage.objects` and insert
  into `storage.buckets` in this project (Supabase documents that it may);
- anything on the hosted project. No real file was uploaded anywhere.
