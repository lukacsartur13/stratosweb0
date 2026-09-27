# Client accounts, sharing and "Nyersanyag leadása" (phase 4)

> The complete, current apply order for phases 1–5 is **`PORTAL_RELEASE.md`**.

Client accounts invited from a client's page, a separate Hungarian client
portal, per-file and per-folder sharing, and client uploads into each
project's "Ügyféltől érkezett nyersanyagok" folder — all built on the owner's
document library (`DOCUMENTS.md`), not beside it. Nothing here has been applied
to production, deployed, or sent to anyone; no real invitation was created.

- Migration: `migrations/20261001000100_client_portal.sql`
- Checks: `checks/client-portal-verify.sql` (the phase-3 preflight still applies)
- Rollback: `checks/client-portal-rollback.sql`
- Server: `netlify/functions/portal-invite.mjs` (`POST /api/portal-invite`)
- Portal: `features/client/` (ClientApp, AcceptInvite, ClientAccountsPanel),
  `lib/clientPortal.ts`, `lib/clientAccounts.ts`; sharing in
  `features/documents/ProjectLibrary.tsx`; the uploader is the library's own
  (`lib/documents.ts → useUploader`, with a client adapter)
- Tests: four layers, §9

---

## 1. The model

| Piece | Rule |
| --- | --- |
| `client_accounts` | One per e-mail (unique, lower-case), bound to ONE company for good. `user_id` is set once, by `client_invite_attach`, and never changed. Revoking is `status = revoked`; re-inviting reuses the row. |
| `client_project_access` | Live assignments (`revoked_at is null`), at most one per account and project, only projects of the account's own company. Revoking is final for that row; granting again inserts a new row. |
| `document_shares` | A file **or** a folder, to one account, in one project (composite FKs make a cross-project share unwritable). Needs a live assignment. Revoking is final; share again to restore. |
| Raw-material folder | `document_folders.purpose = 'client_uploads'`, one live per project, created by the first client upload. **Not shared** by being written to. |
| Client uploads | Rows of `project_documents` with `client_account_id` set; same lifecycle, types, 50 MB limit and storage as the owner's (`DOCUMENTS.md` §3–4). |

### What a client can reach — and how that is decided

A client reads **no table**. The `client_portal_*` functions are the entire
client API, and each returns fixed columns:

| Function | Returns |
| --- | --- |
| `client_portal_me()` | full name, company name |
| `client_portal_projects()` | project id, project name — assigned, live projects only |
| `client_portal_documents()` | document id, project id/name, file name, size, date, and the folder it was shared through |
| `client_portal_uploads()` | the caller's **own** uploads: id, project, name, size, time, state, failure reason |

No checkpoint, note, blocker, money figure or Impact market value is in any of
those result types (asserted from the catalogue in
`tests/portal-client-db.spec.ts`), so nothing depends on a screen hiding it.
Every function re-checks, on every call, that the caller is a linked, active
`client` account with a **current** assignment. An id sent by the browser —
project, folder, document — grants nothing by itself: a foreign id answers
"not found" or "no access".

**Why these are SECURITY DEFINER.** A row policy on `projects` would hand a
client every column (RLS filters rows, not columns). So the client functions
run with the definer's rights and return only the columns above; the phase-1–3
rule "no API-callable definer function reads projects" now names exactly these
functions (`client-portal-verify.sql` fails if any other appears). The
definer's own role gets explicit policies on the library tables, which FORCE
row security, so this works whether or not that role has BYPASSRLS on the
hosted project (still unverified — `OWNER_TRACKER.md` §1).

### Sharing semantics

- **Private by default.** Nothing is visible to a client until shared with that
  account.
- **A folder share** covers the folder, its subfolders and every file added
  later, **through the current folder tree**: a file moved out loses that route
  at once; a direct share of the same file survives the move. The share dialog
  says so.
- **The trash hides everything**: a trashed file, and the files of a trashed
  folder, are neither listed nor downloadable.
- **Revoking a project assignment** ends every share of that account in that
  project and fails its uploads still in flight. **Assigning it again revives
  nothing**: shares must be made again. Revoking the account revokes every
  assignment.
- **Downloads** use a signed link valid **60 seconds**. A link already handed out
  keeps working until it expires even if the share is revoked in between, and
  **a copy the client already downloaded cannot be taken back.**

---

## 2. Inviting — and what happens when part of it fails

`POST /api/portal-invite`, from the owner's "Client accounts" panel:

1. **Verify the caller** — the owner's JWT with GoTrue, then `is_owner()` asked
   with that JWT.
2. **`client_invite_prepare`** (as the owner) — the account row and the chosen
   projects; refuses a staff address (its role is not changed), an address of
   another company's account (it is not moved), a project of another company;
   max **30 invitations an hour**. Idempotent per e-mail.
3. **The auth user** — the existing profile for that e-mail, or a new user made
   by `generate_link(invite)` (server key; creates the user, sends nothing).
4. **`client_invite_attach`** (as the owner) — links the account to that user
   only if the user's own profile has that e-mail, is a plain `client`, and
   belongs to no other company. **Access starts here, not before.**
5. **The link** — `invite` for an unconfirmed user, `recovery` (choose a new
   password) for one who has signed in before.

| Failure | Result |
| --- | --- |
| Any refusal in 2 | Nothing is created in Auth. |
| 3 fails | Nothing opened; retry. |
| 4 fails after 3 created the user | `PARTIAL`: an auth user with **no access**, and **no link returned**. Inviting again finds that user, attaches it, and returns a link. Nothing is duplicated. |
| 5 fails | The account is linked; inviting again returns a link. |

**The link** is `https://<site>/portal/accept-invite#token_hash=…&type=…`. The
token is in the **fragment**, so no server (Netlify's included) ever logs it. It
is returned once, shown once in a dialog, never stored, never logged (the
function logs step names and status codes only — asserted), and is not sent
anywhere by the Portal. The page removes it from the address bar and history
before exchanging it with `verifyOtp`, then the client chooses their own
password. It works **once** and expires with the project's e-mail link expiry
(1 hour by default); making a new link invalidates the previous one.

---

## 3. Uploads by clients

The library's lifecycle (`DOCUMENTS.md` §4), through the client's own
functions, each re-checking the **current** assignment:

- `client_begin_upload` — the type allowlist, 50 MB, and per-account limits:
  **10 in progress, 200 per day, 2 GB per day**. Creates the raw-material folder
  if needed; names are numbered, never overwritten.
- A signed upload link is issued only for the caller's **own pending** upload in
  a project they still have (storage INSERT policy + restrictive guard). One
  link = one key, no upsert. The owner cannot sign a client's pending key and a
  client cannot sign anyone else's.
- `client_finish_upload` — ready only if the object is there at the declared size
  **and** the assignment is still live. A trigger enforces the last part for
  every path (the owner's finish, the reconcile, a PATCH): a client file
  arriving after its access was withdrawn becomes `failed: access_revoked`,
  never a document. Its object is reported as `unfinished_object`.
- `client_mark_upload` — the client's own failed ↔ pending (retry), never a
  finished one. A client cannot rename, move, trash, delete or overwrite what
  they handed in; a new version is a new file.

---

## 4. Supabase Auth settings (dashboard → Authentication)

| Setting | Value | Why |
| --- | --- | --- |
| Allow new users to sign up | **Off** | Client accounts exist only by invitation. With it on, anyone could create a `client` profile (it would see nothing — no linked account — but it should not exist). Admin `generate_link` still works. |
| Confirm email | On (default) | An invited user is confirmed by using the link. |
| Email OTP / link expiry | 3600 s (default); **never above 86 400** | Supabase: longer is "strongly discouraged". This is the invite link's lifetime. |
| Minimum password length | **12** | Matches the Portal's password forms. |
| Site URL | `https://stratosweb.hu` | The existing reset flow. |
| Redirect URLs | `https://stratosweb.hu/portal/reset-password` (existing) | Invitations need **no** redirect entry: the link points at `/portal/accept-invite` directly and is verified in the page with `verifyOtp`. |
| Email templates | unchanged | No invitation e-mail is sent by Supabase in this phase. |

---

## 5. Environment variables (Netlify → Site settings → Environment)

| Variable | Scope | Value |
| --- | --- | --- |
| `SUPABASE_URL` | Functions | the project URL (already set) |
| `SUPABASE_SECRET_KEY` (or `SUPABASE_SERVICE_ROLE_KEY`) | Functions **only** | the server key (already set for the lead endpoint). Never `VITE_*`. |
| `SUPABASE_ANON_KEY` | Functions | the **public** anon/publishable key, so the function can act *as the owner*. May be omitted if `VITE_SUPABASE_ANON_KEY` is visible to functions. |
| `PORTAL_ORIGIN` | Functions | `https://stratosweb.hu` — where invite links point. Defaults to Netlify's `URL`; set it so a deploy preview never mints links to itself. |

Without them `/api/portal-invite` answers `503 NOT_CONFIGURED` and the panel says
so; nothing else is affected.

---

## 6. Provider behaviour relied on (official docs, checked 2026-09-27)

- `auth.admin.generateLink` "generates email links and OTPs to be sent via a
  custom email provider" — **it does not send e-mail**; server-side only, with
  the service key; returns `hashed_token` and `verification_type`
  (supabase.com/docs/reference/javascript/auth-admin-generatelink).
- `verifyOtp({ token_hash, type })` exchanges that hash for a session — the
  documented pattern for links to your own page
  (supabase.com/docs/guides/auth/auth-email-passwordless). `invite` and
  `recovery` are valid types (`EmailOtpType`, auth-js 2.x).
- E-mail links are **single-use** and **expire after 1 hour** by default;
  above one day is strongly discouraged (same page).
- Rate limits: token verification and sign-ins default to 30 requests per 5
  minutes (supabase.com/docs/guides/auth/rate-limits). Admin endpoints are not
  listed there — hence the invitation limit in the database (§2).
- Storage behaviour for signed uploads and downloads: `DOCUMENTS.md` §5.

---

## 7. Apply order

After phases 1–3 (`OWNER_TRACKER.md` §10, `DOCUMENTS.md` §7).

19. **Auth settings** (§4) — sign-ups off, expiry, password length.
20. `20261001000100_client_portal.sql` — refuses without the document library
    and an owner.
21. `checks/client-portal-verify.sql` — every row `ok`. Impersonates every
    profile; creates nothing (ends in ROLLBACK).
22. **Netlify environment** (§5), then **deploy the Portal and functions**. The
    library now reads `client_account_id` and the uploader's name, so the Portal
    must be deployed **after** step 20.
23. First real check by hand: invite a test address you control, open the link
    in a private window, set a password, see only the assigned project; share a
    file and download it; hand in a file; revoke the project and see it all go.
    Then revoke that test account.

**Rollback — data-preserving.** `checks/client-portal-rollback.sql` drops the
client storage policies, restores the bucket's guards and the owner's insert
policy exactly as phase 3 left them, and revokes every `client_*` function from
the API roles. **Nothing is deleted or changed**: accounts, assignments, shares,
the invite log, raw-material folders and their documents, stored objects, auth
users and profiles all stay. The owner's library keeps working. Re-applying the
migration restores the client paths exactly (tested). To also stop invitations,
remove `SUPABASE_ANON_KEY`/`PORTAL_ORIGIN` or redeploy without the function.

---

## 8. A local Supabase for the live check

Needs the Supabase CLI and Docker (**not available on the machine this was
built on**). `supabase start`, then apply every migration in the runbook order
through the local SQL editor (the lockdown refuses to run before an owner
exists, so `supabase db reset` cannot do it in one pass — see `DOCUMENTS.md`
§7), then:

```
LIVE_SUPABASE_URL=http://127.0.0.1:54321 LIVE_SUPABASE_ANON_KEY=… \
LIVE_SUPABASE_SECRET_KEY=… LIVE_CONFIRM_LOCAL=yes npm run check:client-portal:live
```

It refuses any non-local host. It creates its own owner, admin, two companies
and three clients, runs the real invite function in-process against real Auth,
PostgREST and Storage, and leaves everything in place.

---

## 9. Tests — four separate layers

| Layer | Command | Talks to | Proves |
| --- | --- | --- | --- |
| Contracts | `npx playwright test tests/portal-client.spec.ts` | nothing | the client code calls only `client_*`; the link is never logged/stored and travels in the fragment; owner-only capability; no payment schedule |
| **PGlite** | `npm run test:client-portal` → `tests/portal-client-db.spec.ts` | real Postgres 18.3 (WASM) + Storage catalogue stand-in | every rule with owner, second super_admin, admin, team member, a client of each of two companies, and two clients on one project: invites (idempotent, staff/other company refused, attach checks, limit), what a client can read, sharing and inheritance, moves, trash, share/assignment/account revocation and re-grant, foreign ids, own-upload isolation, types and limits, no delete/move/overwrite, revocation mid-upload, owner uploads unchanged, verify and rollback |
| **Mocked Supabase** | `npm run test:client-portal` → `tests/portal-invite.spec.ts`; `npm run check:client-portal:ui` → `scripts/portal-client-check.mjs` | scripted GoTrue/PostgREST/Storage | the invite function's order, auth, refusals before any user exists, partial failure and retry, no duplicates, no leaks; the rendered client portal and owner screens |
| **Real local Supabase** | `npm run check:client-portal:live` → `scripts/client-portal-live-check.mjs` | local Auth, PostgREST, Storage | invite → verify → password through the real services, repeat invites, refusals, a client against real PostgREST and Storage, sharing, uploads, revocation mid-upload. **Not run** (§8). |

---

## 10. What was verified, and what was not

**Update:** the real-Supabase layer has since run on a LOCAL stack
(`npm run check:client-portal:live` 19/19, `scripts/portal-live-browser-check.mjs`
15/15). Results, fixes and what remains open for the hosted project:
`PORTAL_RELEASE.md` §11. The text below is the earlier state.

**Verified locally, without real Supabase:** PGlite 33 tests; invite function 9
tests (mocked Supabase); contracts 6 tests; rendered client portal and owner
screens 11 checks (mocked). The phase-1–3 suites still pass.

**Not verified — needs a real Supabase (local first, then the hosted project):**

- GoTrue's `generate_link` creating an unconfirmed user and behaving as scripted
  for existing, confirmed and unconfirmed users; `verifyOtp` with `invite` and
  `recovery` hashes from it; the link's real lifetime and single use;
- real PostgREST calling the `client_*` functions with a client's JWT, and the
  definer role's policies on the hosted project (BYPASSRLS unknown);
- real Storage evaluating the client policies for signing, downloading and
  listing, and a late upload through an old link after revocation;
- CORS for the direct PUT from the Portal's origin;
- the Auth settings in §4 and the Netlify variables in §5 on the real project.
