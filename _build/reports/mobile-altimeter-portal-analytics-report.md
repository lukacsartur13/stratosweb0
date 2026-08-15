# Mobile Altimeter persistence + Portal Analytics

Continuation from `ec409f4`. Two objectives, one branch, no deploy.

Review package: `_build/reports/mobile-altimeter-portal-review/`
(`mobile/` — 30 stills, one unedited real-time recording, `cost.json`, `states.json`;
`portal/` — 17 stills, all labelled MOCK, plus their own README.)

Regenerate with `node scripts/mobile-altimeter-review.mjs` and `node scripts/portal-shots.mjs`.

---

# Part one — the mobile Altimeter

## 1. What it did before

The portrait Altimeter was one element in the opening section's block flow:
`MobileAltimeter` rendered a `<Canvas>` inside `.mv-alt__stage`, and the stage sat
between the headline and the lead paragraph. Its whole life was that section.

Measured at 390×844, the opening section is 1 000 px of a 14 193 px document. So the
signature object of the homepage was present for about **one screen of seventeen**, and
from `initial-ascent` onwards the page was typography over a gradient. The instrument's
own `IntersectionObserver` then stopped the renderer entirely once the slot left the
viewport — correct behaviour for that architecture, and precisely the thing that made
the disappearance total.

`_build/reports/mobile-cost-head.json` records the consequence as a number: **243 draw
calls over a full read of the document**, and 98 of those before the first scroll.

## 2. What it does now

The instrument is a **persistent overlay** that the journey moves between a small number
of authored positions. It is the same `<Canvas>`, the same `models/stratos-altimeter.glb`,
the same 26 nodes, the same twelve materials and the same needle mapping — moved, not
replaced. There is no second scene and no second object anywhere in the change.

```
experiments/src/full/mobile/
  anchors.ts            NEW — the authored state table, the resolver, the store
  MobileAltimeter.tsx   the reserve + the fixed overlay + the settle
  MobileInstrument.tsx  the scene: needles, power, attitude
  instrument.ts         the arithmetic — camera solve, needles, thresholds
  mobile.css            §05 the reserve, §05b the overlay
```

### The architecture, in the order a frame goes through it

```
native document scroll
  → ascent.ts            one passive listener, already there, coalesced to one pass/frame
  → stateAt(stage, …)    a discrete lookup — no measurement, no geometry
  → a plain target object
  → two settles          the overlay's transform (DOM), the case's attitude (three.js)
  → invalidate()         one frame requested, only while something is moving
```

Nothing on that path calls `setState`, reads a layout, or touches the document outside
one `transform` and one `opacity` on a `will-change` element.

## 3. The hero transition

Two phases, and only the first is scroll-linked.

**The launch.** For the first 0.6 of a screen the instrument is interpolated between two
frames of reference: at t=0 it is exactly where the opening section reserved it and moves
*with the document*; at t=1 it is exactly the `ascent` placement and is stationary. The
ease is symmetric, so it releases the page slowly, accelerates across and settles onto
the rail. Beyond t=1 no scroll position is ever consulted by the instrument's composition
again.

That is what makes it read as `hero object → flight instrument` rather than as an object
disappearing and a widget appearing. It is not a fade and it is not a jump: it is one
gesture, and the recording in the review package shows it unedited.

**The hero anchor is measured once, and this is deliberate.** `AltimeterReserve` publishes
the document offset of the block the hero keeps, on the shared `onMeasure` bus — fonts
settling, resize, orientation, `visualViewport`, bfcache — and never on a scroll frame.
Every other state is a viewport fraction; the hero is not, because the opening frame is
the one this page is judged on and a fraction would be *nearly* right in three locales at
four viewports. The measurement reads a block whose own size is a CSS constant, from an
overlay that is `position: fixed` and `pointer-events: none`. There is no code path by
which it could reach a layout quantity. **This is not a layout-feedback loop and cannot
become one.**

## 4. The authored states

`anchors.ts`, `PLACEMENTS`. Seven, plus the departure.

| State | Stages | Position | Scale | Opacity | Pitch / yaw |
|---|---|---|---|---|---|
| `hero` | calibration, first 26% of its band | the reserved band | 1.00 | 1.00 | −3.6° / 6.8° |
| `ascent` | initial-ascent, cloud-entry, stratosphere-transition | right rail, low | 0.30 | 0.74 | −1.6° / 9.5° |
| `capabilities` | lower-atmosphere, system | right rail, low | 0.30 | 0.68 | −1.2° / 8.0° |
| `summit` | cloud-breakthrough, full-stratosphere | centre, 50% | 0.52 | 0.50 | −2.4° / 4.0° |
| `work` | selected-work | right rail, low | 0.26 | 0.58 | −1.0° / 10.5° |
| `process` | process | right rail, low | 0.30 | 0.70 | −1.4° / 7.2° |
| `arrival` | destination | centre, 46% | 0.78 | 0.86 | −2.8° / 2.2° |
| `recede` | past the end marker | centre, 42% | 0.90 | 0.00 | −2.8° / 2.2° |

Switched by **discrete section state**, from the `stage` the shared ascent reader already
publishes — the "or equivalent" the brief allows beside `IntersectionObserver`. It adds no
listener, no observer and no geometry: the whole state machine is a lookup in a table.

The end of the homepage is a structural fact rather than an altitude, so it is a cached
document offset compared against `scrollY` — one `getBoundingClientRect` per measurement
event, on the pass that already measures the reserve and the eleven sections, and nothing at
all on a scroll frame. **This change adds no `IntersectionObserver` at all.** It was one
first, and §9 records why that was wrong.

Every yaw is under 11° and every pitch under 4°. There is no roll anywhere, no bounce, no
spin and no float. Rail states sit at the top of that range because a gauge mounted off to
one side of a panel *is* seen off-axis; the centred states square up.

### Why the alternation is not left/right

The brief asks for the composition to be authored around a known anchor, alternating side
where the composition wants it. On this page it does not want left. The copy column is
left-aligned and runs the full measure at all four portrait viewports, and three stages
(`lower-atmosphere`, `system`, `process`) hang their content off a Meridian rule on the
**left edge** of that column. A left dock would sit on that rule at every one of them.

So the authored alternation is: a right rail wherever the copy is left-aligned and long,
and the **centre**, larger, at the two centred statement beats and at Arrival — the three
stages whose copy is short, centred and has real air around it.

### And the instrument is painted *under* the copy

This is the composition decision the rest depends on, and it is worth stating plainly.

There is no position a fixed overlay can hold on a scrolling page that copy will not
eventually pass through. The two ways out are to narrow the copy column by the overlay's
width for the whole document — which costs every paragraph on every screen about a fifth
of its measure, in three locales, to buy a gutter that matters on one screen in six — or
to put the instrument behind the copy.

Behind is the answer. `.mv-flow` is `z-index: 2`, `.mv-inst` is `1`, the telemetry stays
at `4`. Consequences:

* **Not one word is ever obscured**, because words are on top. The first version painted
  the instrument over the copy and cut a sentence in half mid-word; the screenshot is what
  showed it.
* **The accepted typography is untouched.** The measure, the leading and the authored line
  breaks are exactly what the previous review passed, because the instrument arriving costs
  the flow nothing at all.
* The opacities in the table above are therefore not "how visible is it" but "how much does
  it compete with the line crossing it".

The instrument carries its own soft radial bloom (`.mv-alt__wait`, which doubles as the
loading silhouette) so a 100 px case on the rail reads as an object in a space rather than
a decal against near-black.

## 5. Arrival, and the one authored disappearance

At `destination` the needles have wound to 30 000 m, the copy is the closing statement, and
the instrument comes back to the **centre at 0.78 of its hero size, square to the viewer**.
That is the closure.

Then it leaves — deliberately, and only here. A marker at the foot of `.mv-flow` has its
document offset cached on the measurement bus, and the ascent reader compares `scrollY +
0.88 × viewport` against it. The instrument grows very slightly and fades to zero, so it
reads as receding from the frame rather than being switched off. Below that marker is the
site's shared Arrival panel and ground-control footer, which are not part of the journey.

The other authored disappearance is the navigation layer: while `.menu-open` is on the root
the instrument is at opacity 0 and the renderer draws nothing. Both edges are announced on
`stratos:menu`, which the overlay listens to directly because the ascent reader stands down
for the duration.

## 6. Rendering architecture

* `frameloop="demand"`, unchanged. Nothing draws unless something asked for a frame.
* The drawing buffer is created **once at the hero size** and reused at every state. A rail
  state is those same pixels scaled down by the compositor — sharper than re-rendering into
  a small buffer, and free. The canvas is never resized by a state change.
* The overlay moves by `transform` only. Never `top`/`left` (layout properties, per frame)
  and never `width` (a buffer reallocation).
* The scene now rotates the case and nothing else. Scale and position left three.js
  entirely and became the overlay's transform; `poseAt`, the entry/held/exit pose table and
  the slot-crossing calculation are gone, along with the scene's handle on any DOM element.
  That last one matters: **there is no longer any path by which code inside the renderer
  could reach a laid-out element on this page.**
* No terrain, no mountains, no clouds, no particles, no camera journey, no DRACO, no HDR.
  Asserted, not claimed — see §7.

## 7. Performance

`_build/reports/mobile-altimeter-portal-review/mobile/cost.json`. Chromium at 390×844 @2×
(Chromium because WebKit does not implement the `longtask` entry type, and a count that is
silently always zero is worse than one measured elsewhere and labelled).

| | |
|---|---|
| GLB requests | **1** — `models/stratos-altimeter.glb` |
| Terrain / mountain / DRACO requests | **0** |
| HDR / EXR / ENV requests | **0** |
| Desktop scene chunks (`JourneyScene`, `ScrollTrigger`) | **0** |
| Draw calls per rAF frame, during a full read | **13.7** |
| Triangles per draw call | **555** (≈ 14 400 per rendered frame, 26 calls) |
| Draw calls over 2.5 s idle | **0** |
| Scroll listeners on the page | **2** — neither is the instrument's |
| Forced layout reads over a 60-step warm read | **72**, none on the instrument's path |
| Long tasks / total | 103 / 5 400 ms |
| Median frame interval | 49.1 ms — see the caveat below |
| p95 frame interval | 66.7 ms |

**Render frequency.** 2 754 draws over 201 rAF frames = ~106 rendered frames, so the
instrument drew on roughly half the frames of a continuously-scrolled read and none at
rest. Against HEAD's 243 draw calls that is an 11× increase in total work, and that
increase *is* the feature: the instrument is on screen for seventeen screens instead of
one. What did not change is the per-frame cost and the idle cost, which are the two numbers
a phone actually feels.

**On the 72 layout reads.** Attributed by stack, on a warm pass (`experiments/.tmp-layout-probe.mjs`):

* **59 + 16 — `assets/js/motion.js`**, the site's shared chrome primitives. Pre-existing,
  untouched by this work.
* **30 — the `ResizeObserver` on the document**, calling `measureAscent`. Eleven section
  rects per pass, on the occasions a lazy case-study image lands and changes the height
  beneath it. This is the accepted design: measure on resize, never on scroll.
* **0 — the instrument.** Not one read comes from the overlay's settle or from the scene.

**On the long tasks.** These are a synthetic 60-step scroll on a headless browser, each step
jumping ~220 px and forcing reveals and image decodes at once. They are not a per-frame
figure.

**On the frame interval, and why it is not quoted as a frame budget.** It is the interval
between animation frames across the whole scripted read, *including* the 40 ms pauses between
scroll steps, and headless Chromium throttles its frame clock while nothing is invalidating.
Measured between 18.6 ms and 49.1 ms on the same build and the same machine, which is the
range of that throttling rather than a range of rendering cost. It is recorded in `cost.json`
with the same caveat. The figures that are stable, and that a phone actually feels, are the
per-frame draw calls and the zero at rest.

## 8. Mobile review package

`_build/reports/mobile-altimeter-portal-review/mobile/`

* **30 stills** — six moments (hero, post-hero, mid-journey, Work, Process, Arrival) at
  430×932, 390×844, 375×812, 360×800 and 844×390 landscape, captured on **WebKit** because
  the real-device gate is iPhone/Safari. Each waits on `data-settled`, so no capture is a
  frame on the way somewhere.
* **`states.json`** — the instrument's state, box, opacity and the altitude readout at every
  one of those 30 moments.
* **`journey-390x844-realtime.webm`** — one unedited 1× recording, hero through Arrival and
  the recede. Scrolled on a wall-clock cadence (34 px / 16 ms), nothing cut, nothing
  sped up, nothing stitched.
* **`cost.json`** — §7.

Spot-checked from `states.json` at 390×844: hero 335 px at (14, 321) — the accepted frame to
the pixel; ascent 101 px at (275, 669); work 87 px; arrival 250 px centred; recede opacity
0.00.

## 9. Mobile regressions

Nothing in the preserve list changed. Verified by the suites that own each:

| Preserved | Where it is asserted | Result |
|---|---|---|
| Native portrait-mobile scroll | `the document scrolls itself` | pass |
| Zero programmatic scroll restoration | `nothing moves the scroll position on the page's behalf` | pass |
| Native homepage history restoration | `homepage-history.spec.ts`, `a back navigation comes back with a live, agreeing readout` | pass |
| Modal navigation inertness | `the menu opens, locks only while it is open…` | pass |
| WebKit focus restoration | `homepage-modality.spec.ts` | pass |
| Desktop homepage | `a desktop viewport still gets the cinematic journey and its terrain`; `experiments/tests/full-ascent.spec.ts` | pass |
| Reduced motion | `the real instrument stays, and stops moving` | pass |
| No opaque plate over the instrument | `nothing paints an opaque plate across the altimeter` | pass |
| Instrument adds no scroll listener | `the instrument adds no scroll listener of its own` | pass |
| Fixed instrument box | `the slot has a fixed box that the instrument cannot change` | pass |

### Tests changed, and why

Three, and each is a case where the *asserted behaviour was the defect*.

1. **`nothing renders while the instrument is off screen` → deleted, replaced by two.**
   It scrolled four screens past the hero and confirmed the renderer had stopped. That was
   exactly right for a hero-only instrument and exactly the behaviour this workstream exists
   to remove. Replaced by:
   * `nothing renders while the instrument is deliberately hidden` — the menu is open, and
     zero draws over two seconds. The guarantee that still holds.
   * `the instrument is still there, and still reading, well below the hero` — walks every
     screen of the document and asserts, at each, that the overlay names an **authored**
     state, that it is settled, that it is on screen at a real size and opacity, and that the
     altitude has advanced. This is "where did the Altimeter go?" as an assertion.
   * `the instrument never sits on the telemetry readout` — the page's two fixed objects,
     at every screen.

2. **`the renderer is not requested at all when there is no WebGL`** — one line added. It
   walks the whole document and jumps back to the top, so it measured effective opacity
   *inside the return transition* and read a value that was true for one frame. It now waits
   for `data-settled`, the placement settle's own "I am where I am supposed to be" and the
   counterpart to `data-ready` on a path where nothing ever renders a frame. The assertion
   is unchanged.

3. **`no chapter contains a tall run of nothing`** (`experiments/tests/portrait-journey.spec.ts`)
   — the only *new* failure `validate:full` produced, and a correct catch. The canvas used to
   be a replaced element inside the hero's flow and counted as content; what is left there is
   an empty block reserving the space the overlay draws into, which the walk reported as a
   335 px run of nothing. The fix measures the overlay's rectangle and offers it to whichever
   section it overlaps — **not** an exemption for the reserve. If the instrument ever stopped
   being drawn, or moved away from the space the hero keeps for it, the gap reappears and the
   test fails again.

### Three defects found and fixed during the work

All three were in the recede, and all three were found by the tests written for it.

1. **The recede inverted at the bottom of the document.** `isIntersecting` is true while the
   end marker crosses the frame and false once it has passed above it, so at the very bottom
   the instrument read "not ended" and came back at full size over the footer. Fixed by
   comparing rectangles rather than reading a boolean.
2. **A stale `ended` blanked the instrument after any jump to the top.** The observer is
   asynchronous, so a `scrollTo(0)` left `ended` true for a frame and the hero rendered at
   zero opacity. `stateAt` now scopes the recede to the closing stage, so the synchronous
   ascent reader decides everything else.
3. **The recede never fired on a jump to the bottom at all**, which is what finally retired
   the observer. An `IntersectionObserver` delivers a callback when the intersection RATIO
   changes, and a single `scrollTo(scrollHeight)` takes the marker from "below the frame,
   ratio 0" to "far above the frame, ratio 0" without ever crossing it — no ratio change, no
   callback, and the instrument stayed at Arrival size over the footer. A fragment link or an
   end-key jump reproduced it every time and a normal scroll never did, which is the shape of
   bug that ships. Replaced by the cached offset described in §5, which has no such window.

A fourth was mine and not the product's: moving that block left a `let` declared after the
subscriber that reads it, and `onAscent` calls its subscriber synchronously at registration.
The temporal dead zone took the whole page down with `Cannot access 'I' before initialization`,
and the mobile suite went from 52 green to 20 s timeouts across the board. Caught, moved above
the reader, verified green again.

---

# Part two — Portal Analytics

## 10. GA4 configuration state — read this first

**No Google service account exists in this repository or in any environment reachable from
it.** Checked: no `.env` at the repo root, in `portal/` or in `netlify/`; no
`GA4_PROPERTY_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL` or `GOOGLE_PRIVATE_KEY` in the shell; no
`.netlify` link directory; nothing in `netlify.toml` beyond the CSP entries for the public
measurement tag.

So **no real authenticated Portal Analytics request was made**, because there is nothing to
authenticate with. The feature is built end to end and lands in its `Analytics not configured`
state, which names exactly which variables are outstanding. §16 lists what remains, and the
review package includes `MOCK-analytics-not-connected.png` and `MOCK-command-center-no-ga4.png`
— the two screens a reviewer opening the real Portal today would actually see.

The intended Property ID remains `15392224433`. The public site's Measurement ID
(`G-JZD43PHJ41`) is a separate identifier for a separate job and neither substitutes for the
other.

## 11. The endpoint

`netlify/functions/portal-analytics.mjs`. The architecture is unchanged and was not replaced:

```
browser → authenticated same-origin GET → this function → Google Analytics Data API
```

**Nine sections, four Google calls.** Two `batchRunReports` batches of five (the API's
maximum) plus a third of five, and two realtime reports. A fetch per widget would be twelve
round trips and twelve times the property quota for one page load; the suite asserts the
count rather than the intention.

| Gate | Status | Note |
|---|---|---|
| method | 405 | GET only |
| authentication | 401 | one message for every failure mode |
| authorization | 403 | `super_admin` / `admin` only, mirroring `view_analytics` |
| parameters | 400 | `range` and `environment` are allow-lists |
| configured | 200 | `configured: false` + missing variable **names** |
| cache | 200 | per `range|environment`, 5 min; realtime 60 s on its own shelf |
| Google | 200 / 502 | no upstream detail ever reaches the browser |

## 12. What the dashboard shows

**Overview.** Active users, sessions, page views, new users, lead events, lead events per
session, engagement rate and average engagement time — each with **Compare with previous
period**, which is the same number of days immediately before, including the same partial
day at the end. Ranges: Today, 7, 30, 90 days.

GA4's terms are used as GA4 defines them. A session is not a visitor. Average engagement
time is `userEngagementDuration / activeUsers`, which is GA4's own definition — dividing by
sessions instead is the most common way to publish a different number under GA4's name, and
the suite asserts the divisor.

**Realtime.** Last 30 minutes: active users, the pages being viewed and the events firing.
Cached for 60 s on its own shelf, so changing the range refetches the report and reuses
realtime. Two honest caveats are on the panel itself: the total is summed across pages, so a
visitor who moved between two is counted on both; and `hostName` is not in GA4's realtime
dimension schema, so **the realtime panel is whole-property and the production filter does
not apply to it.**

**Traffic trend.** A selectable time series — users, sessions, views — over the chosen range,
hourly for Today and daily otherwise. One series at a time by design: three counts of
different things on wildly different scales either need three axes or squash two of them flat.

**Acquisition.** `sessionSource`, `sessionMedium` and `sessionCampaignName` as three
dimensions rather than GA4's joined string, with sessions, users, engagement and leads joined
by source **and** medium. `(not set)` is left exactly as GA4 returned it; rewriting it to a
friendlier word would be the endpoint inventing attribution.

**Pages.** Top Pages ↔ Landing Pages, switchable. These are joined differently and the screen
says so: top-page leads are enquiries sent *from* that path (`pagePath`), landing-page leads
are attributed to the session that *started* there (`landingPagePlusQueryString`). For judging
a campaign only the second means anything.

**Devices.** Mobile / desktop / tablet with sessions, users, engagement and their own
conversion rate — a separate report, because "sessions on mobile" and "lead events on mobile"
are different aggregations. This is the only place the public site's two genuinely different
compositions are measurable against each other, and the panel says so.

**Conversion funnel.** Built **only from events that exist**, every one of them in
`_build/reports/phase9-event-taxonomy.md` and sent by `assets/js/analytics.js`:

```
sessions                    (the session count — the taxonomy has no "session" event)
→ CTA interaction           cta_click, project_start_click, service_contact_click,
                            work_explore_click, impact_apply_click
→ Form started              form_start, questionnaire_start
→ Form submitted            form_submit_attempt
→ Lead confirmed            form_submit_success, questionnaire_submit_success
```

Stage-to-stage and cumulative conversion are both reported. The panel states its own
limitation: stages after the first are **event counts, not unique users** — one visitor
clicking two CTAs is counted twice — because GA4's user-scoped funnel is an Exploration and
the Data API does not expose it. A test reads `assets/js/analytics.js` and fails if the
endpoint ever names an event the site does not send.

## 13. Production vs staging

**Default: Production.** Selector: Production / Staging / All.

Implemented on **`hostName`**, and that choice is the point. The site tags every event with an
`environment` parameter and sets GA4's `traffic_type`, and neither is usable from a server:
a custom parameter is only queryable once somebody has registered it as a custom dimension in
the GA4 interface, and `traffic_type` drives the internal-traffic filter — both are console
settings this repository cannot make, cannot see and cannot test against. `hostName` is a
standard GA4 dimension, present on every property from creation, needing no configuration at
all.

So the separation this dashboard promises is one it can actually deliver rather than one that
depends on a checkbox. The response states the mechanism and the host list, and the screen
prints both, so a reader can check the claim rather than believe it. `Staging` is a
`notExpression` — everything that is *not* the real website — rather than a second allow-list
somebody would have to maintain. The suite asserts that **every** reporting request carries the
filter, because a dashboard whose KPI cards are filtered and whose tables are not is worse than
one that filters nothing.

Configurable without a deploy via `GA4_PRODUCTION_HOSTS`; defaults to
`stratosweb.hu,www.stratosweb.hu`, the same list `_build/build.py` ships to the browser.

## 14. Consent note

On the dashboard, beside the numbers rather than in a document:

> **Analytics reflects traffic where analytics measurement was permitted.** Google Analytics
> loads only after a visitor accepts it, and a visitor who declines is never contacted by
> Google at all — so real traffic is higher than every figure above by an amount this property
> cannot know.

`basis: 'consented'` travels on every payload so the caveat cannot be separated from the
numbers by a later refactor.

## 15. The Portal

### Command Center (`pages/overview.tsx`)

Answers "what is happening in Stratos right now?" in one screen:

* **Leads** — today, 7 days, 30 days, unanswered, and the six-stage pipeline as counts.
* **Analytics** — users, sessions and views today, active users right now, and lead events
  per session with its comparison.
* **Acquisition** — strongest current sources. Falls back to the Portal's **own** lead
  attribution when GA4 is not connected, which needs no Google at all.
* **System** — Supabase, lead API, GA4 Data API, notification adapter, environment.
* Latest enquiries, and a link into the pipeline.

Three sources, three parallel requests, three independent failures: a Google outage does not
blank the lead figures. A `team_member` reaches this screen and the analytics request is **not
made at all** — a 403 rendered as an error is a screen telling somebody they are broken when
they are simply not an admin.

### Lead pipeline (`pages/leads.tsx`, `lib/leads.ts`)

New → Contacted → Qualified → **Proposal** → Won / Lost. Filter by stage (clickable tiles),
search across name, company, email, message, interest and route, sort by newest / oldest /
name / stage — stage sorting in **pipeline order**, not alphabetical. Status changes are one
click for anyone with `manage_leads`; the database decides whether they take.

`spam` renders and is deliberately **not** offered as a destination: rows already carry it,
and "this was junk" is a triage judgement rather than a step towards a sale.

### Lead detail

Contact, budget; form type, locale, submitted-from route, landing route, referrer host,
received timestamp; the five UTM fields and the submission id; the message; questionnaire
answers; and **every remaining `meta` key under its own raw name**. That last part is a
property the suite guards: the authored groups are a reading order, not an allow-list, and a
lead written by an older or newer client must never become partly invisible because this file
has not caught up with it.

### Internal notes

`lead_notes` — plain text, 1–4 000 characters, timestamped, with a **real** author.

No identity is invented: every writer is an authenticated Portal user with a row in
`profiles`, the author is that row's id, and the RLS `with check` requires
`author_id = auth.uid()` — so an admin cannot write a note in a colleague's name even by
editing the request. Notes can be withdrawn by their author and **cannot be edited by anyone**:
a note that can be rewritten after the fact is not a record, and the timeline it appears in is
meant to be one.

Rendered as a text node inside `white-space: pre-wrap`. No markup, no markdown, no HTML
execution — the portal-wide XSS suite asserts there is no `dangerouslySetInnerHTML`,
`innerHTML`, `outerHTML` or `document.write` anywhere in `portal/src`.

### Activity timeline

Only what was recorded:

| Event | Source | Available from |
|---|---|---|
| Enquiry received | `leads.created_at` | every row, always |
| Notification sent / not sent | `activity_logs` row written by `POST /api/lead` | **this migration onwards** |
| Status changed | `activity_logs` row written by a database **trigger** | **this migration onwards** |
| Note added | `lead_notes` | this migration onwards |

Nothing is inferred. Leads that predate the trigger show their arrival and nothing else, and
the screen says so rather than reconstructing a plausible history from the current status.

A trigger rather than an application write, because the Portal is not the only thing that can
change a status — the Supabase table editor can, an automation can, an SQL fix can. A trigger
records all of them; an insert in the React app records the ones that went through the React
app and leaves gaps that look like nothing happened.

### Lead attribution (aggregate only)

Leads by source / medium / campaign / landing page / form / locale, from each lead's **own
submission** — the UTM parameters and landing route the browser sent with it — and never from
GA4. **No GA4 user is ever associated with a named lead, and no lead's personal data is ever
sent to GA4.** The panel states this where the data is.

### System Health

New endpoint: `netlify/functions/portal-health.mjs`. Separate from analytics on purpose —
`/api/portal-analytics` stops at `configured: false` when Google is missing, which is exactly
the moment somebody most needs to know whether everything else is fine.

Drawn on the Command Center and on Settings — the same component in both places, because two
copies would be two things to keep in step and the one that got out of date would be the one
somebody read. Reports Supabase (probed live against PostgREST's root, which touches no table),
the lead API, the GA4 Data API, the notification adapter and the Netlify deploy context. `disabled` is a
neutral state, not a warning: the notification adapter defaults to sending nothing, leads land
in the Portal either way, and painting a deliberate configuration red trains whoever reads the
screen to ignore the colour.

**Every field is a boolean, an enum or a variable name.** `configured()` takes a variable and
returns whether it is a non-empty string; the value goes out of scope in the same expression.
The webhook URL is reported as `destinationConfigured: true/false` and never as a host, a path
or a length — even the host names the service.

### Design

No chart library. The CSP ships no third-party runtime, a charting dependency would be
50–150 KB to draw four shapes, and its defaults — rainbow categorical palettes, drop shadows,
animated tooltips, a legend for one series — are precisely what this design is trying not to
look like. `components/charts.tsx` is inline SVG: a line, a bar row, a funnel, a meter.

One accent (`signal`, the site's yellow) marking the series being read; everything else is the
chrome greys the rest of the Portal already uses. A second series is drawn in `chrome` at lower
opacity, which reads as "the same measurement, less important" rather than as a different
category. Compact KPI tiles — label, figure, one line of context — so eight fit above the fold
on a laptop rather than eight postcards of air.

### Responsive

Large desktop, MacBook, tablet, phone. Tables scroll inside their own container and never give
the document a horizontal scrollbar. Captured at 1440, 834 and 390 in the review package.

Two real layout defects were found and fixed while capturing:

* The Leads attribution panel sat beside the table at `xl`, leaving ~800 px for seven columns;
  the table overflowed its scroll container and the Name column ended up off the left edge
  whenever a control inside it took focus. It now goes beside the table only at `2xl`.
* The expanded lead detail widened the table it lives in — a `colSpan` cell's min-content width
  is a floor on the table. `w-0 min-w-full` removes it from that calculation entirely.

A third was found by a **test** rather than a screenshot: the acquisition table rendered
`row.campaign` with no break class, so a long UTM campaign name would have set that column's
min-content width. Fixed, and the check now runs over every dimension render site on the screen.

## 16. Security

| | |
|---|---|
| Google credentials | server-side only. Never in any bundle, never in any response. |
| Assertion, in the browser bundle | no Property ID, no `GOOGLE_PRIVATE_KEY`, no `GOOGLE_SERVICE_ACCOUNT_EMAIL`, no `gserviceaccount`, no `analyticsdata.googleapis.com`, no `oauth2.googleapis.com` — checked file by file against `dist/portal` |
| Assertion, in every response | none of the above, plus `ya29.`, `BEGIN PRIVATE KEY`, the Supabase secret key |
| PII | asserted on the **requests**: the endpoint never asks GA4 for `userId`, `clientId`, `userAgeBracket`, `userGender`, `city`, `latitude`, `longitude` or `streamId`. A response can only contain what a request asked for, so checking the requests checks the whole surface. |
| Health endpoint | never returns a value, only whether one exists — asserted against deliberately distinctive fixtures so a leak is unmistakable in a diff |
| Response headers | `private, no-store, max-age=0` on both endpoints |
| Upstream errors | Google's error body can quote the request, the property and the service account address. It goes to the function log; the caller gets a status. |
| Suite ↔ Google | `no request leaves this process when the seams are mocked` replaces `globalThis.fetch` and fails if anything calls it. **The automated suite never contacts Google.** |

## 17. Caching

* Report: 5 minutes, keyed on `range|environment`. Each combination cached separately — one
  shared entry would serve production KPIs to somebody who asked to see staging.
* Realtime: 60 seconds, its own shelf. A realtime panel served from a five-minute cache is not
  realtime; a fresh call on every report miss is a call the quota does not need.
* Honest about what it is: a `Map` in one warm Lambda. It does not survive a cold start and does
  not coordinate between instances, so the TTL means "at most one Google call per five minutes
  **per warm instance**". It is not a rate limiter and is not load-bearing for anything but cost.
* The cache sits **behind** the guards: a cached payload is still refused to an account that may
  not read it, and that is asserted.

## 18. Database migration

`supabase/migrations/20260814000100_lead_pipeline.sql` — **additive, and not applied by this
work.**

1. `alter type lead_status add value if not exists 'proposal' after 'qualified'` — adding an
   enum value takes no lock. Replacing the type would rewrite the table, which means an
   exclusive lock on `leads` and a window in which `POST /api/lead` fails.
2. `lead_notes` — new table, RLS enabled and forced, staff select, admin insert with
   `author_id = auth.uid()`, author-only delete, no update policy at all.
3. `log_lead_status_change()` + an `after update of status` trigger on `leads`. `security
   definer` with `set search_path = public` pinned, because an unpinned `security definer`
   function lets a caller who can create a schema choose which `activity_logs` it writes to.
4. An index on `activity_logs (entity_type, entity_id, created_at desc)`.

No column is dropped, no type replaced, no row touched by a data migration. Every existing lead
keeps its status, payload and attribution, and every existing `select` list keeps working.
**Running it is a deliberate operator action and has not been performed.**

`netlify/functions/submit-lead.mjs` gained one call: an `activity_logs` insert after the
notification attempt, optional-chained on the store seam (so a test mocking the store without it
is unaffected) and `.catch`ed to a log line. **A submission can never fail because an audit row
could not be written.** `lead-endpoint.spec.ts` and `lead-notify.spec.ts` pass unchanged.

---

# Gates

Run against the current working tree.

| Gate | Result |
|---|---|
| `npm run typecheck` | **pass** — portal and experiments |
| `npm run build` | **pass** |
| `npm test` (full Playwright suite) | **950 passed / 1 failed / 122 skipped** — see below |
| `npm run validate:full` | **131 passed / 0 failed / 34 skipped** — the documented baseline, exactly |
| Route audit | **792 checks, 0 failing, 0 broken internal links** |
| `npm run scan:secrets` | **clean** — 679 files, 12 rules |
| `npm run audit:seo:check` | **0 failing**, 43 warnings (unchanged) |
| `npm run audit:conversion:check` | **OK, no CTA integrity failures** |
| `npm run draco:check` | **pass** |
| `npm run fingerprint:check` | **72 pages, 25 assets, 0 unstamped** |
| Mobile Altimeter suite (`mobile-homepage-simple.spec.ts`) | **pass** at `mobile-390` and `mobile-430` |
| Menu / modality / history | **pass** |
| Portal authentication + XSS (`portal.spec.ts`) | **21 passed** |
| Portal Analytics (`portal-analytics.spec.ts`) | **76 passed** |
| Portal Health (`portal-health.spec.ts`) | **19 passed** |
| Lead regression (`lead-endpoint`, `lead-notify`, `lead-forms`) | **pass** |
| GA4 credential leak scan | **pass** — bundle, responses and requests |

## The `npm test` failure

`tests/homepage-chrome.spec.ts`, the `full-screen menu on the homepage` describe block,
`Test timeout of 30000ms exceeded`, on the **desktop** homepage — a composition this work did
not touch. It is the documented load-dependent timeout, and it was investigated rather than
inherited, because the documented baseline was three and any change in that number has to be
accounted for.

Four full-suite runs on this branch, and the identical pattern each time:

| Run | Failures | Which |
|---|---|---|
| Full suite (during other work) | 4 | all `homepage-chrome` menu timeouts |
| Full suite | **0** | — |
| Full suite (final) | 1 | `opens from every header state` |
| `homepage-chrome.spec.ts` alone, default workers | 2 | menu timeouts |
| `homepage-chrome.spec.ts`, `--project=desktop-1920 --workers=1` | **0** | 36/36 pass |

The set is not stable between runs of the same build on the same machine, it is empty at one
worker, and one full run of the whole suite produced no failures at all. That is contention on
a suite whose desktop projects drive a ~1 MB WebGL bundle close to a 30 s timeout.

No timeout was raised, no retry added, no forced click used, no GPU flag set and no worker
count changed to obtain a result. The single-worker run is diagnostic evidence, reported as
such, and is not how the gate was run.

## `validate:full`

**131 passed / 0 failed / 34 skipped — the documented baseline, exactly.**

An earlier run produced 129 / 2 / 34. Both failures were `no chapter contains a tall run of
nothing`, at `mobile-390` and `mobile-landscape` — a genuine, correct catch of this change
(§9.3), fixed by teaching the walk to measure the overlay's rectangle rather than by exempting
the reserve. The suite that owns that test then ran 91/91, and the full re-run above restored
the baseline.

---

# External requirements

Nothing below is done. Nothing below can be done from this repository, and none of it is marked
complete because there is no evidence to mark it with.

### Google Cloud

1. Enable the **Google Analytics Data API** on the project.
2. Create a **service account** for reporting, and a JSON key for it.
3. Keep the key out of the repository. It goes into Netlify and nowhere else.

### GA4 Console

4. Add the service account's address as a **Viewer** on property `15392224433`.
5. *Optional.* Production/staging separation works on `hostName` and needs nothing here. If a
   custom-dimension route is ever wanted instead, `environment` would have to be registered as
   a custom dimension — not required by anything shipped, and deliberately not depended on.

### Netlify environment variables

6. `GA4_PROPERTY_ID` = `15392224433`
7. `GOOGLE_SERVICE_ACCOUNT_EMAIL`
8. `GOOGLE_PRIVATE_KEY` (Netlify stores the multi-line value with literal `\n`; the function
   already handles that)
9. *Optional.* `GA4_PRODUCTION_HOSTS` if the production hostnames ever change.
10. Confirm `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `IP_HASH_SALT` are present — System
    Health reports each, and a deploy missing the salt is a privacy fact worth seeing.

### Production deployment

11. Apply `supabase/migrations/20260814000100_lead_pipeline.sql`. Additive; review it first.
12. Redeploy so the functions pick up the new variables.
13. Open Portal → Analytics and confirm it leaves the `Not connected` state. **This is the first
    real authenticated request and it has not happened.**
14. Open Portal → Overview and confirm System Health reads `ok` for all four services.

### Legal review

15. The privacy policy already covers GA4 measurement on the public site. **Portal Analytics
    introduces a new processing relationship** — a Google service account reading the property
    from a server — and whether the existing text covers it is a question for whoever owns that
    document. Aggregate only, no personal data, nothing joining a GA4 user to a named lead.
16. `lead_notes` is a new store of internal commentary about identifiable people. It falls
    under the same retention and access policy as `leads`; confirm that policy says so
    explicitly.
17. `activity_logs` now records lead status changes and notification outcomes with an actor id.
    No personal data of the lead, but it is a new record about staff activity.

---

# Not done

* Not pushed, not deployed, not merged.
* The migration is written and **not applied**.
* No real GA4 request was made, because no credentials exist to make one with.
* Phase 10 not begun.

---

MOBILE ALTIMETER + PORTAL ANALYTICS READY FOR REVIEW
