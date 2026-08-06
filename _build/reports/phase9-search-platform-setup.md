# Phase 9 — Workstream Q: Google Search Console and Bing Webmaster Tools

**Nothing here can be completed before the domain cutover, and this document
does not pretend otherwise.** `stratosweb.hu` is still served by Wix. Verifying
a property against a site we do not control would verify the wrong site.

**No verification token has been added anywhere.** A fake token is worse than an
absent one: it makes a property look configured, it fails silently, and it is
the kind of thing nobody re-checks.

This is a **Phase 10 domain-cutover dependency.**

---

## 1. The facts a setup needs

| | |
|---|---|
| Production origin | `https://stratosweb.hu` — resolved by `scripts/site-origin.mjs`, never hardcoded |
| `www` variant | `https://www.stratosweb.hu`. Whichever Netlify marks **primary** is the one every canonical will name, automatically |
| Current (pre-cutover) host | `stratosweb1.netlify.app` |
| Sitemap | `https://stratosweb.hu/sitemap.xml` — 60 URLs, three languages |
| Robots | `https://stratosweb.hu/robots.txt` |
| Locales | `hu` at the root, `en/`, `de/`, with reciprocal hreflang and `x-default` → Hungarian |
| Excluded from indexing | `/portal` (auth, `noindex`, `no-store`), `/api/` (`noindex`), the nine `noindex` summary case studies, the three 404 pages |

---

## 2. Verification methods, and which to choose

### Google Search Console

| Method | Works here? | Notes |
|---|---|---|
| **DNS TXT (domain property)** | **yes — recommended** | Covers `https://`, `http://`, `www` and every subdomain in one property. It is the only method that survives the apex/`www` question entirely, which matters because that decision has not been made |
| HTML file upload | yes | Drop the file at the repo root; `assemble.mjs` copies root files into `dist/`. Adds a file to version control that means nothing to anyone reading the repo later |
| HTML meta tag | yes | Would go in the `SHELL` head in `_build/build.py` — but that emits it on all 69 routes, which is 68 more than needed |
| Google Analytics | **yes, and available now** | The GA4 property already exists and the tag is on the site. Requires "Edit" on the GA4 property. **Simplest option if the same Google account owns both** |
| Google Tag Manager | no | GTM is not used |

**Recommendation: a DNS TXT domain property.** One property, every protocol and
subdomain, no artefact in the repository, and it does not have to be redone if
the primary host changes between apex and `www`.

### Bing Webmaster Tools

| Method | Works here? | Notes |
|---|---|---|
| **Import from Google Search Console** | **yes — recommended** | Once GSC is verified, Bing imports the property, the verification and the sitemap in one step. Do GSC first |
| DNS CNAME | yes | The standalone equivalent |
| XML file / meta tag | yes | Same trade-offs as Google's |

---

## 3. What is required from the user

> **REQUIRES USER FACTUAL INPUT — all four:**
>
> 1. **Which host is canonical**, apex or `www`. Set it as *primary* in Netlify;
>    every canonical, `og:url`, hreflang and sitemap entry follows from it with
>    no code change.
> 2. **DNS access** for `stratosweb.hu`, to add the TXT record.
> 3. **The Google account** that will own the property. If it is the same one
>    that owns GA4 property `15392224433`, the GA4 verification method needs no
>    DNS at all.
> 4. **A Microsoft account** for Bing.

**No token belongs in this repository until step 2 produces a real one.**

---

## 4. Post-cutover sequence

Order matters. Steps 1–3 must be complete before 4, or the property is verified
against a site that is still `Disallow: /`.

| # | Step | Verify with |
|---|---|---|
| 1 | Attach `stratosweb.hu` in Netlify and mark one host **primary** | Netlify domain settings |
| 2 | Deploy, so `SITE_URL`/`URL` resolves to the custom domain | the deploy log |
| 3 | **Confirm `robots.txt` is no longer `Disallow: /`** | `curl -s https://stratosweb.hu/robots.txt` |
| 4 | Verify the GSC domain property | GSC |
| 5 | Submit `https://stratosweb.hu/sitemap.xml` | GSC → Sitemaps |
| 6 | Import into Bing Webmaster Tools | Bing |
| 7 | Request indexing for the homepage and the four highest-value routes | GSC → URL Inspection |
| 8 | Wait 3–7 days, then work through §5 | — |

### Step 3 is the one that gets missed

`robots.txt` is `Disallow: /` on any `netlify.app` origin — deliberately, so the
pre-cutover copy does not compete with the real site. It stops being so **only
when the custom domain becomes Netlify's primary address.** Attach the domain
without marking it primary and the site stays uncrawlable, with nothing on any
page to say so and no error anywhere. A verified property over an uncrawlable
site reports "everything is fine" for weeks.

---

## 5. Indexing checklist, after verification

| # | Check | Where | Expected |
|---|---|---|---|
| 1 | `robots.txt` fetched and readable | GSC → Settings → robots.txt | `Allow: /`, with a `Sitemap:` line |
| 2 | Sitemap read, 60 URLs discovered | GSC → Sitemaps | 60, 0 errors |
| 3 | Homepage renders as Google sees it | URL Inspection → Test Live URL | The `<h1>` and body copy must appear. The homepage is a React application; this is the check that proves JavaScript rendering worked |
| 4 | Canonical agrees | URL Inspection | "User-declared" and "Google-selected" canonical must match, per locale |
| 5 | `/kkv.html` is **200**, not 301 | URL Inspection or curl | If it 301s, Netlify's *Pretty URLs* is on and every canonical points at a redirect — see `phase9-redirect-map.md` §3 |
| 6 | The nine summary case studies are **excluded by `noindex`** | Coverage → Excluded | Correct, not an error |
| 7 | `/portal` is not indexed | `site:stratosweb.hu/portal` | 0 results |
| 8 | hreflang recognised | International Targeting | No "no return tags" errors. Reciprocity is already asserted at build time on all 69 routes |
| 9 | `/no-such-page` returns 404 | curl | `HTTP/2 404` |
| 10 | The old Wix URLs | Coverage, on the **old** property | The source for the redirect map — see §6 |

### Locale checks

| | |
|---|---|
| `hu` | root. `x-default` points here |
| `en` | `/en/` |
| `de` | `/de/` |
| Each locale's pages self-reference in their own language | asserted at build time |
| Each locale is reachable from every other | the language switcher, on every page |

---

## 6. The one thing that must happen BEFORE the cutover

> **REQUIRES USER FACTUAL INPUT — and it is time-sensitive.**
>
> **Export the old site's URL inventory while the Wix site is still reachable.**
>
> Two sources:
> - Search Console's *Pages* report on the existing `media-stratos.com` property;
> - `https://media-stratos.com/sitemap.xml`.
>
> After DNS moves, the Wix site is unreadable and its URL structure is gone. The
> redirect map (`phase9-redirect-map.md` §3) is blocked on exactly this list,
> and it cannot be reconstructed afterwards.

If the old property is not accessible, the fallback is a third-party index
(`site:media-stratos.com` on a search engine, or the Wayback Machine's URL
listing). Both are incomplete. The Search Console export is the only complete
one, and only until the cutover.
