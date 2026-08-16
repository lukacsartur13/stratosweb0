import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Phase P1 — the Control Room's structural contracts.
 *
 * ## Why so much of this is asserted at the source
 *
 * The built portal in `dist/` has no Supabase credentials, by design: that is
 * the artefact Netlify serves and the artefact this suite runs against, and it
 * therefore cannot sign anybody in. Every screen this phase rebuilt is behind
 * the auth guard, so a rendered test can reach exactly one of them — the sign-in
 * page — and nothing else.
 *
 * There are two honest ways to cover the rest. The first is what this file does:
 * assert the properties where they are DECIDED, in the source, so that they hold
 * for every render rather than for one fixture. The second is
 * `node scripts/portal-shots.mjs`, which builds a separate credentialled bundle,
 * intercepts every request, drives each screen with mock data and now asserts
 * the rendered contracts as it goes — see the assertions in that file. Neither
 * replaces the other and both run.
 *
 * What is NOT tested here, deliberately: pixel positions, exact class strings,
 * and the copy of any label that is not load-bearing. Those are the assertions
 * that make a design system unchangeable rather than correct.
 */

const SRC = path.join(process.cwd(), 'portal', 'src');
const read = (...parts: string[]) => fs.readFileSync(path.join(SRC, ...parts), 'utf8');

/** Comments stripped: a doc comment naming a hazard is not an occurrence of it. */
const code = (...parts: string[]) =>
  read(...parts).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ========================================================= navigation === */

test.describe('the shell', () => {
  test('the primary navigation is the four products, in order', () => {
    const shell = code('components', 'shell', 'PortalShell.tsx');
    const primary = /const PRIMARY: NavItem\[\] = \[([\s\S]*?)\];/.exec(shell);
    expect(primary, 'PRIMARY must exist').not.toBeNull();

    const labels = [...primary![1].matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    expect(labels).toEqual(['Dashboard', 'Analytics', 'Leads', 'System']);
  });

  test('records are a separate, subordinate group', () => {
    const shell = code('components', 'shell', 'PortalShell.tsx');
    const secondary = /const SECONDARY: NavItem\[\] = \[([\s\S]*?)\];/.exec(shell);
    expect(secondary, 'SECONDARY must exist').not.toBeNull();

    // Every record screen that still exists is reachable. Removing a working
    // screen from the product because its presentation changed is the failure
    // this asserts against.
    const labels = [...secondary![1].matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
    for (const expected of ['Projects', 'Clients', 'Case studies', 'Users', 'Activity', 'Settings']) {
      expect(labels, `${expected} must remain reachable`).toContain(expected);
    }

    // And they are drawn at a lower weight than the products.
    expect(shell, 'the records group must be marked subdued').toMatch(/label="Records[^"]*"\s+subdued/);
  });

  test('every navigation item is capability-guarded', () => {
    const shell = code('components', 'shell', 'PortalShell.tsx');
    const items = [...shell.matchAll(/\{ to: '[^']+',\s*label: '[^']+',\s*icon: \w+,\s*cap: '(\w+)' \}/g)];
    expect(items.length, 'every nav item declares a capability').toBeGreaterThanOrEqual(10);
    expect(shell).toMatch(/PRIMARY\.filter\(\(n\) => can\(profile\?\.role, n\.cap\)\)/);
    expect(shell).toMatch(/SECONDARY\.filter\(\(n\) => can\(profile\?\.role, n\.cap\)\)/);
  });

  test('the active route is marked by state, not only by colour', () => {
    const shell = read('components', 'shell', 'PortalShell.tsx');
    // NavLink's `isActive` drives both a background and a leading rule. A
    // marker that were only a colour would be invisible to anyone who cannot
    // distinguish it from the row above.
    expect(shell).toContain('isActive');
    expect(shell).toMatch(/isActive\s*\?\s*'bg-signal'/);
  });

  test('the sidebar footer shows the environment, the identity and sign out', () => {
    const shell = read('components', 'shell', 'PortalShell.tsx');
    expect(shell, 'the environment comes from the health endpoint, never a literal')
      .toMatch(/state\.kind === 'ready' \? state\.data\.environment : null/);
    expect(shell).toContain('Sign out');
    expect(shell).toContain('ROLE_LABELS[profile.role]');
  });

  test('the command bar carries the page heading and the global scope only', () => {
    const shell = code('components', 'shell', 'PortalShell.tsx');
    const bar = shell.slice(shell.indexOf('function CommandBar'));

    // One h1 per page, and it lives here.
    expect(bar).toContain('<h1 className="t-page">{title}</h1>');
    // The two controls that change what every data screen shows, and nothing
    // page-specific.
    expect(bar).toContain('scope-range');
    expect(bar).toContain('scope-environment');
    expect(bar, 'refresh is a scope action, not a per-panel one').toContain('onClick={refresh}');
  });

  test('the mobile drawer is still a focus-trapped dialog', () => {
    const shell = read('components', 'shell', 'PortalShell.tsx');
    expect(shell).toContain('role="dialog"');
    expect(shell).toContain('aria-modal="true"');
    expect(shell).toContain("e.key === 'Escape'");
    expect(shell, 'focus moves into the drawer').toContain('closeRef.current?.focus()');
    expect(shell, 'the page behind must not scroll').toContain("document.body.style.overflow = 'hidden'");
  });
});

/* ============================================================= routes === */

test.describe('routes', () => {
  const app = code('App.tsx');

  test('the four products and the lead detail all have routes', () => {
    for (const route of ['analytics', 'leads', 'leads/:id', 'system']) {
      expect(app, `${route} must be routed`).toContain(`path="${route}"`);
    }
    expect(app, 'the Dashboard is the index route').toContain('<Route index element={<DashboardScreen />} />');
  });

  test('every route behind the shell is capability-guarded', () => {
    const guards = [...app.matchAll(/<Route path="([^"]+)" element=\{\s*<ProtectedRoute capability="(\w+)"/g)];
    const guarded = Object.fromEntries(guards.map((m) => [m[1], m[2]]));

    expect(guarded['analytics']).toBe('view_analytics');
    expect(guarded['leads']).toBe('view_leads');
    expect(guarded['leads/:id']).toBe('view_leads');
    expect(guarded['system']).toBe('view_system');
  });

  test('the whole shell is behind the session guard', () => {
    expect(app).toMatch(/<ProtectedRoute>\s*[\s\S]{0,400}?<ScopeProvider><PortalShell \/><\/ScopeProvider>/);
  });

  test('System is a distinct capability from Analytics', () => {
    const permissions = code('lib', 'permissions.ts');
    expect(permissions).toContain("| 'view_system'");
    // The same two roles as the server enforces in portal-health.mjs.
    expect(permissions).toMatch(/super_admin: \[[\s\S]*?'view_system'/);
    expect(permissions).toMatch(/admin: \[[\s\S]*?'view_system'/);
    expect(permissions, 'a team member has no business reading integration state')
      .toMatch(/team_member: \[(?:(?!view_system)[^\]])*\]/);
  });
});

/* ========================================================== dashboard === */

test.describe('the Dashboard hierarchy', () => {
  const dashboard = code('pages', 'dashboard.tsx');

  test('the six sections appear in the prescribed order', () => {
    const order = ['ExecutiveStrip', 'TrafficPulse', 'LivePanel', 'ConversionPath', 'Acquisition',
      'RecentLeads', 'Attention', 'SystemLine'];
    // Where each component is USED, not where it is defined.
    const render = dashboard.slice(
      dashboard.indexOf('export function DashboardScreen'),
      dashboard.indexOf('/* ================================================== 01'),
    );
    const positions = order.map((name) => ({ name, at: render.indexOf(`<${name}`) }));
    for (const { name, at } of positions) {
      expect(at, `${name} must be rendered on the Dashboard`).toBeGreaterThan(-1);
    }
    const ats = positions.map((p) => p.at);
    expect(ats, 'the Dashboard reads business → traffic → conversion → work → action → systems')
      .toEqual([...ats].sort((a, b) => a - b));
  });

  test('the executive summary is one surface, not five cards', () => {
    // A MetricStrip is one bounded region with internal dividers. Five `Panel`s
    // in a row is the shape this phase removed and must not come back.
    expect(dashboard).toContain('<MetricStrip label="Executive summary">');
    const strip = dashboard.slice(
      dashboard.indexOf('<MetricStrip label="Executive summary">'),
      dashboard.indexOf('</MetricStrip>'),
    );
    expect(strip, 'no cell may be its own panel').not.toContain('<Panel');
    expect([...strip.matchAll(/<MetricCell/g)].length).toBeGreaterThanOrEqual(5);
  });

  test('Traffic takes eight columns and Live takes four', () => {
    expect(dashboard).toMatch(/Panel className="col-span-12 min-w-0 lg:col-span-8"[\s\S]{0,400}?title="Traffic"/);
    expect(dashboard).toMatch(/Panel className="col-span-12 min-w-0 lg:col-span-4"[\s\S]{0,400}?title="Live"/);
  });

  test('yellow is scarce: it marks live, the last funnel stage and nothing else', () => {
    // Every `text-signal` on the Dashboard, counted. This is a budget rather
    // than a ban: the accent means something only while it is rare.
    const yellows = [...dashboard.matchAll(/text-signal/g)].length;
    expect(yellows, 'the Dashboard must not paint figures yellow by default').toBeLessThanOrEqual(4);
  });

  test('the system status on the Dashboard is one line, not the full readout', () => {
    const section = dashboard.slice(dashboard.indexOf('function SystemLine'));
    expect(section, 'the Dashboard must not draw per-service rows').not.toContain('HealthRow');
    expect(section, 'it links to the screen that explains it').toContain('to="/system"');
    expect(section).toContain('All systems operational');
  });

  test('attention items are derived from data, never invented', () => {
    const section = dashboard.slice(
      dashboard.indexOf('function Attention'), dashboard.indexOf('function SystemLine'),
    );
    // Everything it can say is computed from a lead's status and age, an
    // analytics failure kind, or a health service state.
    expect(section).toContain("l.status === 'new'");
    expect(section).toContain("l.status === 'proposal'");
    expect(section).toContain("analytics.kind === 'unconfigured'");
    expect(section).toContain('health.data.services');
    // The categories that have no source of truth in this system.
    for (const invented of ['invoice', 'deadline', 'overdue', 'renewal']) {
      expect(section.toLowerCase(), `${invented} has no data behind it`).not.toContain(invented);
    }
    expect(section, 'an empty attention list is one restrained line')
      .toContain('Nothing requires attention.');
  });
});

/* ====================================================== data honesty === */

test.describe('zero, empty, unavailable and not configured are four things', () => {
  test('the primitive names all four and refuses to conflate them', () => {
    const ui = code('components', 'ui', 'index.tsx');
    expect(ui).toMatch(/kind: 'empty' \| 'unavailable' \| 'unconfigured'/);
    // The state is exposed to the DOM so a rendered check can tell them apart.
    expect(ui).toContain('data-state={kind}');
    expect(ui, 'an unmeasurable figure is an em dash with a reason').toContain('function NoFigure');
  });

  test('an unconfigured analytics property never renders as a zero', () => {
    const dashboard = code('pages', 'dashboard.tsx');
    // The strip's fallback is NoFigure plus a reason, for every analytics cell.
    expect(dashboard).toContain('<NoFigure reason="Analytics not configured" />');
    expect(dashboard).toContain('<NoFigure reason="Analytics unavailable" />');
    expect(dashboard).toContain('<NoFigure reason="Realtime unavailable" />');
    // And the Live panel says which of the two it is.
    expect(dashboard).toContain('title="Analytics not configured"');
    expect(dashboard).toContain('title="Realtime unavailable"');
  });

  test('every screen distinguishes not-connected from empty', () => {
    for (const screen of ['pages/leads.tsx', 'pages/screens.tsx', 'pages/lead-detail.tsx']) {
      const body = code(...screen.split('/'));
      expect(body, `${screen} must render an unconfigured state`).toContain("kind=\"unconfigured\"");
    }
  });

  test('no screen ships a plausible hard-coded figure', () => {
    // The failure this guards against is a demo number surviving into
    // production. Every figure in the product comes from `n()`, `pct()`,
    // `duration()`, a `.length`, or a field of a response.
    const screens = ['pages/dashboard.tsx', 'pages/leads.tsx', 'pages/lead-detail.tsx',
      'pages/analytics.tsx', 'pages/system.tsx', 'pages/screens.tsx'];
    for (const screen of screens) {
      const body = code(...screen.split('/'));
      // A literal of three or more digits, or a formatted thousand, inside JSX
      // text. Tailwind's arbitrary values (`text-[11px]`, `min-h-[60dvh]`) and
      // `maxLength={4000}` are attributes, not rendered figures.
      const literals = [...body.matchAll(/>\s*([\d]{1,3}(?:[,.\s]\d{3})+|\d{3,})\s*</g)].map((m) => m[1]);
      expect(literals, `${screen} renders a hard-coded figure`).toEqual([]);
    }
  });
});

/* ============================================================== leads === */

test.describe('Leads is one table, and the detail is a route', () => {
  const leads = code('pages', 'leads.tsx');

  test('the status summary is one strip of real counts', () => {
    expect(leads).toContain('function StatusStrip');
    expect(leads, 'counts come from the rows, never from a constant')
      .toContain('counts[id] ?? 0');
    expect(leads, 'each cell is a toggle and says so').toContain('aria-pressed={selected}');
  });

  test('the control row offers the filters the brief asks for', () => {
    for (const id of ['filter-days', 'filter-form', 'filter-source', 'filter-locale', 'filter-sort']) {
      expect(leads, `${id} must exist`).toContain(id);
    }
    expect(leads, 'search is labelled').toContain('aria-label="Search leads"');
    expect(leads, 'filters can be cleared').toContain('onClick={filter.reset}');
  });

  test('filter options are built from the rows, not hard-coded', () => {
    const lib = code('lib', 'leads.ts');
    expect(lib).toContain('const distinct =');
    expect(lib).toMatch(/forms: distinct\(\(l\) => l\.form_type\)/);
    expect(lib).toMatch(/sources: distinct\(leadSource\)/);
    expect(lib).toMatch(/locales: distinct\(\(l\) => l\.locale\)/);
  });

  test('a row is clickable AND carries a real link', () => {
    // The row handler is an enhancement; the anchor is what a keyboard reaches.
    expect(leads).toMatch(/onClick=\{\(\) => navigate\(`\/leads\/\$\{lead\.id\}`\)\}/);
    expect(leads).toMatch(/<Link to=\{`\/leads\/\$\{lead\.id\}`\}/);
  });

  test('the leads list carries no analytics dashboard', () => {
    expect(leads, 'attribution analysis belongs on Analytics').not.toContain('useAnalytics');
    expect(leads, 'the list is not a chart surface').not.toContain('TrendChart');
  });

  test('the detail is an 8/4 split with the metadata on the right', () => {
    const detail = code('pages', 'lead-detail.tsx');
    expect(detail).toContain('lg:col-span-8');
    expect(detail).toContain('lg:col-span-4');
    // The one control that changes anything is on the right, above the facts.
    expect(detail.indexOf('title="Stage"')).toBeLessThan(detail.indexOf('title="Origin"'));
    expect(detail, 'the message is the largest thing on the screen').toContain('{lead.message}');
  });

  test('the detail no longer fights a table for its width', () => {
    // `code`, not `read`: the module's doc comment explains the `w-0 min-w-full`
    // hack it exists to have removed, and a check that cannot tell an
    // explanation from an occurrence punishes writing the explanation down.
    const detail = code('pages', 'lead-detail.tsx');
    expect(detail, 'the colSpan width hack is gone with the accordion').not.toContain('w-0 min-w-full');
    expect(detail, 'it is a route, not a row').not.toContain('colSpan');
  });
});

/* ============================================================= system === */

test.describe('System is diagnostics and nothing else', () => {
  const system = code('pages', 'system.tsx');

  test('it reports states, and states are all it can hold', () => {
    expect(system).toContain('STATE_LABEL[state.data.services.supabase.state]');
    expect(system).toContain('STATE_LABEL[state.data.services.ga4.state]');
    expect(system).toContain('STATE_LABEL[state.data.services.notifications.state]');
    expect(system).toContain('state.data.environment');
  });

  test('it never renders a secret, and has no field that could hold one', () => {
    // The GA4 block prints variable NAMES from `missing`. Anything that looked
    // like a value would be a new field on the response type as well as a new
    // line here, and `lib/health.ts` has no such field.
    expect(system).toContain('state.data.services.ga4.missing.map((name)');

    // The structural guarantee, asserted on the RESPONSE TYPE rather than on
    // the module: `Health` is what the screen can render, and if no field of it
    // can hold a credential then no render of it can leak one. The module also
    // holds an access token and a cache key, which are inputs to the request
    // and reach no screen — checking the whole file would flag those and say
    // nothing about what is drawn.
    const health = code('lib', 'health.ts');
    const shape = /export interface Health \{([\s\S]*?)\n\}/.exec(health);
    expect(shape, 'the Health response type must exist').not.toBeNull();

    for (const field of shape![1].matchAll(/(\w+)\s*:\s*([\w[\]'| ]+);/g)) {
      const [, name, type] = field;
      const safe =
        /^(boolean|ServiceState)$/.test(type.trim())
        || /^string\[\]$/.test(type.trim())            // `missing`: variable NAMES
        || ['checkedAt', 'environment', 'transport', 'state'].includes(name);
      expect(safe, `Health.${name}: ${type} could carry a value`).toBe(true);
    }
  });

  test('it is not a second business dashboard', () => {
    for (const business of ['useAnalytics', 'useRows', 'Funnel', 'TrendChart', 'MetricStrip']) {
      expect(system, `System must not draw ${business}`).not.toContain(business);
    }
  });
});

/* ======================================================= the chrome ==== */

test.describe('one design system', () => {
  test('there are three surfaces and the tokens name them', () => {
    const tailwind = fs.readFileSync(path.join(process.cwd(), 'portal', 'tailwind.config.ts'), 'utf8');
    for (const token of ['ink:', 'deck:', 'flare:', 'hair:', 'hairline:']) {
      expect(tailwind, `${token} must be a token`).toContain(token);
    }
  });

  test('the fonts are the self-hosted three, and no Google Fonts link returns', () => {
    const tailwind = fs.readFileSync(path.join(process.cwd(), 'portal', 'tailwind.config.ts'), 'utf8');
    expect(tailwind).toContain("mark: ['Aboreto'");
    expect(tailwind).toContain("body: ['Archivo'");
    expect(tailwind).toContain('data: [\'"JetBrains Mono"\'');

    const shell = fs.readFileSync(path.join(process.cwd(), 'portal', 'index.html'), 'utf8');
    expect(shell, 'the CSP blocks it and it was never actually loading')
      .not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
    expect(shell).toContain('/assets/css/type.css');
  });

  test('the mark is the only Aboreto in the product', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (/ \d+(\.|$)/.test(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) files.push(full);
      }
    };
    walk(SRC);

    const sites = files.flatMap((file) =>
      [...fs.readFileSync(file, 'utf8').matchAll(/font-mark/g)]
        .map(() => path.relative(SRC, file)));
    // The sidebar lockup, the mobile top bar, the drawer header and the
    // sign-in lockup. Four places, all of them the brand, none of them a page
    // title, a section label or a figure.
    expect(sites.length, `font-mark appears in ${sites.join(', ')}`).toBeLessThanOrEqual(4);
  });

  test('charts share one system and no chart library was added', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'portal', 'package.json'), 'utf8'));
    const deps = Object.keys(pkg.dependencies ?? {});
    for (const library of ['recharts', 'chart.js', 'd3', 'victory', 'nivo', 'echarts', 'apexcharts']) {
      expect(deps.some((d) => d.includes(library)), `${library} must not be a dependency`).toBe(false);
    }
    const charts = code('components', 'charts.tsx');
    // One accent, one axis colour, declared once and used by every chart.
    expect(charts).toContain("const AXIS = ");
    expect(charts).toContain("const ACCENT = '#FFEE25'");
  });

  test('the typographic ladder is six levels and they are defined once', () => {
    const styles = fs.readFileSync(path.join(SRC, 'styles.css'), 'utf8');
    for (const level of ['.t-page', '.t-section', '.t-metric', '.t-row', '.t-meta', '.t-note']) {
      expect(styles, `${level} must be defined`).toContain(level);
    }
  });
});

/* ======================================================== rendered ===== */

test.describe('what the built artefact does', () => {
  test('the shell boots and the sign-in page is what an anonymous visitor gets', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto('/portal/index.html');
    await expect(page).toHaveURL(/\/portal\/login/);
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    // No Control Room chrome leaks to an unauthenticated visitor.
    await expect(page.getByRole('navigation', { name: /portal sections/i })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: /records/i })).toHaveCount(0);
    expect(errors, errors.join('\n')).toEqual([]);
  });

  test('the lead detail route is guarded like the list', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page).toHaveURL(/\/portal\/login/);

    await page.evaluate(() => history.pushState({}, '', '/portal/leads/a0000000-0000-4000-8000-000000000001'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
  });

  test('the System route is guarded', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page).toHaveURL(/\/portal\/login/);

    await page.evaluate(() => history.pushState({}, '', '/portal/system'));
    await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate')));

    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    // Not "the word Supabase is absent" — the sign-in page legitimately says
    // it is not connected to one. What must be absent is the READOUT.
    await expect(page.getByRole('heading', { name: /system status/i })).toHaveCount(0);
    await expect(page.getByText(/deploy context/i)).toHaveCount(0);
  });

  test('no bundle carries a Google identifier or a service role key', async ({ request }) => {
    const shell = await (await request.get('/portal/index.html')).text();
    const scripts = [...shell.matchAll(/src="([^"]+\.js)"/g)].map((m) => m[1]);
    expect(scripts.length).toBeGreaterThan(0);

    for (const src of scripts) {
      const body = await (await request.get(src)).text();
      expect(body, `${src} leaks a service role key`).not.toMatch(/service_role/);
      expect(body, `${src} leaks a private key`).not.toMatch(/BEGIN PRIVATE KEY/);
      expect(body, `${src} leaks a GA4 property id`).not.toMatch(/GA4_PROPERTY_ID|properties\/\d{6,}/);
    }
  });

  test('nothing scrolls sideways at any tested width', async ({ page }) => {
    await page.goto('/portal/index.html');
    await expect(page.getByRole('heading', { name: /sign in/i })).toBeVisible();
    await page.evaluate(() => window.scrollTo(9999, 0));
    expect(await page.evaluate(() => window.scrollX)).toBe(0);
  });
});
