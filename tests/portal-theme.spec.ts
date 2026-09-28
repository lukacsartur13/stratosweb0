import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { THEME_KEY, resolveTheme } from '../portal/src/lib/theme';

/**
 * The portal's System / Light / Dark theme — the rules and the contracts.
 * The rendered half (switching, persistence, live system changes, contrast on
 * every screen in both themes) is in scripts/portal-client-check.mjs and
 * scripts/portal-tracker-check.mjs.
 */

const read = (...p: string[]) => fs.readFileSync(path.join(process.cwd(), 'portal', ...p), 'utf8');

test('System resolves to the device; an explicit choice wins', () => {
  expect(resolveTheme('system', 'light')).toBe('light');
  expect(resolveTheme('system', 'dark')).toBe('dark');
  expect(resolveTheme('light', 'dark')).toBe('light');
  expect(resolveTheme('dark', 'light')).toBe('dark');
});

test('the boot script and the module agree, and the boot script is a file, not inline (CSP)', () => {
  const boot = read('public', 'theme-boot.js');
  expect(boot).toContain(`'${THEME_KEY}'`);
  expect(boot).toMatch(/prefers-color-scheme: light/);
  const html = read('index.html');
  expect(html).toMatch(/<script src="\/portal\/theme-boot\.js"><\/script>/);
  // It must come before the app, and no script in the page may be inline.
  expect(html.indexOf('theme-boot.js')).toBeLessThan(html.indexOf('/src/main.tsx'));
  for (const tag of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)) expect(tag[1].trim()).toBe('');
  expect(html).not.toMatch(/<html[^>]*class="dark"/);
});

test('both palettes define every token, and the device preference is honoured without script', () => {
  const css = read('src', 'styles.css');
  const block = (sel: string) => css.slice(css.indexOf(sel)).split('}')[0];
  const tokens = ['--c-ink', '--c-deck', '--c-panel', '--c-fg', '--a-hair', '--a-hairline', '--c-field', '--c-signal', '--c-signal-ink', '--c-chrome', '--c-paper', '--c-haze', '--c-danger', '--c-good'];
  for (const sel of [':root {', ":root[data-theme='light'] {", ":root:not([data-theme='dark']) {"])
    for (const t of tokens) expect(block(sel), `${sel} ${t}`).toContain(`${t}:`);
  expect(css).toMatch(/@media \(prefers-color-scheme: light\)/);
});

test('no hard-coded brand colour left in components (they would not follow the theme)', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/ 2\./.test(e.name) ? [path.join(dir, e.name)] : []);
  for (const f of walk(path.join(process.cwd(), 'portal', 'src'))) {
    const code = fs.readFileSync(f, 'utf8');
    expect(code, f).not.toMatch(/#(FFEE25|F4F4F4|CBDCE9|3ECF8E|0B0F16|10161F|141C27|8A98A8|FF5A47)\b/i);
    expect(code, f).not.toMatch(/rgba\(244,\s*244,\s*244|bg-white\/|bg-black\/30|text-haze\/[78]0/);
  }
});

test('the switch is on the owner sidebar, the client header and the sign-in page', () => {
  expect(read('src', 'components', 'shell', 'PortalShell.tsx')).toMatch(/<ThemeSwitch\b/);
  expect(read('src', 'features', 'client', 'ClientApp.tsx')).toMatch(/<ThemeSwitch lang="hu"/);
  expect(read('src', 'features', 'auth', 'pages.tsx')).toMatch(/<ThemeSwitch\b/);
});
