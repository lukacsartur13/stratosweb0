import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  MILESTONE_LABEL, MILESTONE_STATES, SETTABLE_PROJECT_STATES, closeRefusal, isClosedProject,
  matchTemplate, trackerOf, type CheckpointLike,
} from '../portal/src/lib/pipeline';
import { OWNER_CAPABILITIES, canAccess } from '../portal/src/lib/permissions';

/**
 * The owner tracker — the pure rules and the structural contracts.
 *
 * `lib/pipeline.ts` and `lib/permissions.ts` import nothing, so they are
 * imported here and their answers asserted directly. The database half of the
 * same rules (blocked needs a reason, the close condition, owner-only RLS) is
 * asserted against a real Postgres in portal-owner-db.spec.ts; the rendered
 * half (the close button, the confetti events) by scripts/portal-tracker-check.mjs.
 */

const SRC = path.join(process.cwd(), 'portal', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

const NOW = new Date('2026-09-27T10:00:00');
const cp = (title: string, state: string, position: number, extra: Partial<CheckpointLike> = {}): CheckpointLike =>
  ({ title, state, position, due_on: null, ...extra });

test.describe('checkpoint vocabulary', () => {
  test('five states, in the order a checkpoint moves through them', () => {
    expect([...MILESTONE_STATES]).toEqual(['pending', 'in_progress', 'waiting_client', 'blocked', 'done']);
    expect(MILESTONE_STATES.map((s) => MILESTONE_LABEL[s]))
      .toEqual(['Not started', 'In progress', 'Waiting on client', 'Blocked', 'Done']);
  });

  test('closed is the close action\'s alone — the status control never offers it', () => {
    expect(SETTABLE_PROJECT_STATES).not.toContain('completed');
    expect(isClosedProject({ status: 'completed' })).toBe(true);
    for (const s of ['active', 'planned', 'archived', 'care', 'blocked']) {
      expect(isClosedProject({ status: s }), s).toBe(false);
    }
  });
});

test.describe('trackerOf', () => {
  test('counts, and the current step is the first open one in order', () => {
    const s = trackerOf([cp('Build', 'in_progress', 1), cp('Design', 'done', 0), cp('Launch', 'pending', 2)],
      { target_date: null }, NOW);
    expect(s).toMatchObject({ done: 1, total: 3, current: 'Build', closable: false, late: false });
  });

  test('closable only with at least one checkpoint and all of them done', () => {
    expect(trackerOf([], { target_date: null }, NOW).closable).toBe(false);
    expect(trackerOf([cp('A', 'done', 0)], { target_date: null }, NOW).closable).toBe(true);
    expect(trackerOf([cp('A', 'done', 0), cp('B', 'waiting_client', 1)], { target_date: null }, NOW).closable).toBe(false);
    expect(trackerOf([cp('A', 'done', 0), cp('B', 'blocked', 1)], { target_date: null }, NOW).closable).toBe(false);
  });

  test('late, waiting and blocked are three separate answers', () => {
    const s = trackerOf([
      cp('Copy', 'waiting_client', 0),
      cp('Hosting', 'blocked', 1, { blocked_reason: 'No DNS access', next_step: 'Ask for registrar login' }),
      cp('Launch', 'pending', 2),
    ], { target_date: '2026-10-30' }, NOW);
    expect(s.late).toBe(false);
    expect(s.waiting).toEqual(['Copy']);
    expect(s.blocked).toEqual([{ title: 'Hosting', reason: 'No DNS access', next: 'Ask for registrar login' }]);
  });

  test('late by the project deadline, or by an open checkpoint\'s due date', () => {
    expect(trackerOf([cp('A', 'pending', 0)], { target_date: '2026-09-26' }, NOW))
      .toMatchObject({ late: true, lateBecause: 'The target date has passed.' });
    expect(trackerOf([cp('A', 'pending', 0, { due_on: '2026-09-20' })], { target_date: '2026-12-01' }, NOW))
      .toMatchObject({ late: true, lateBecause: '“A” is past its due date.' });
    // A done checkpoint with a past date is not late, and today is not overdue.
    expect(trackerOf([cp('A', 'done', 0, { due_on: '2026-09-20' }), cp('B', 'pending', 1, { due_on: '2026-09-27' })],
      { target_date: '2026-09-27' }, NOW).late).toBe(false);
  });

  test('a closed project is none of late, waiting or blocked', () => {
    const s = trackerOf([cp('A', 'done', 0)], { target_date: '2026-01-01', closed: true }, NOW);
    expect(s).toMatchObject({ late: false, waiting: [], blocked: [] });
  });
});

test.describe('matchTemplate', () => {
  const T = [
    { id: 'g', name: 'General', service_keywords: [], position: 90, archived_at: null },
    { id: 'w', name: 'Website', service_keywords: ['web', 'oldal'], position: 10, archived_at: null },
    { id: 'a', name: 'Ads', service_keywords: ['ad', 'hirdet'], position: 20, archived_at: null },
    { id: 'x', name: 'Old web', service_keywords: ['web'], position: 1, archived_at: '2026-01-01' },
  ];

  test('first live keyword match by position, retired ones ignored', () => {
    expect(matchTemplate(T, 'Weboldal + hirdetés')?.id).toBe('w');
    expect(matchTemplate(T, 'Google Ads')?.id).toBe('a');
  });

  test('no match falls back to the keyword-less template; none at all is null', () => {
    expect(matchTemplate(T, 'Something else')?.id).toBe('g');
    expect(matchTemplate(T, null)?.id).toBe('g');
    expect(matchTemplate(T.filter((t) => t.id !== 'g'), 'Something else')).toBeNull();
    expect(matchTemplate([], 'web')).toBeNull();
  });
});

test('closeRefusal turns the database\'s own reasons into sentences, and nothing else', () => {
  expect(closeRefusal('stratos:project_close_no_checkpoints')).toMatch(/at least one checkpoint/);
  expect(closeRefusal('stratos:project_close_open_checkpoints')).toMatch(/Every checkpoint/);
  expect(closeRefusal('stratos:project_closed')).toMatch(/Reopen/);
  expect(closeRefusal('permission denied')).toBeNull();
  expect(closeRefusal(null)).toBeNull();
});

test.describe('owner-only capabilities', () => {
  test('only an account is_owner() answers for — the owner (super_admin) or a named delegate (admin) — reaches the tracker', () => {
    for (const cap of OWNER_CAPABILITIES) {
      expect(canAccess({ role: 'super_admin', is_owner: true }, cap)).toBe(true);
      // A named owner delegate (20261003000100_owner_delegates.sql).
      expect(canAccess({ role: 'admin', is_owner: true }, cap)).toBe(true);
      expect(canAccess({ role: 'super_admin', is_owner: false }, cap)).toBe(false);
      expect(canAccess({ role: 'super_admin' }, cap)).toBe(false);
      expect(canAccess({ role: 'admin', is_owner: false }, cap)).toBe(false);
      // The database never answers true for these roles; the screen agrees.
      expect(canAccess({ role: 'team_member', is_owner: true }, cap)).toBe(false);
      expect(canAccess({ role: 'client', is_owner: true }, cap)).toBe(false);
      expect(canAccess({ role: 'team_member', is_owner: false }, cap)).toBe(false);
      expect(canAccess({ role: 'client', is_owner: false }, cap)).toBe(false);
      expect(canAccess(null, cap)).toBe(false);
    }
  });

  test('every other capability is exactly what the role matrix says', () => {
    expect(canAccess({ role: 'admin', is_owner: false }, 'view_sales')).toBe(true);
    expect(canAccess({ role: 'admin', is_owner: false }, 'view_leads')).toBe(true);
    expect(canAccess({ role: 'team_member', is_owner: false }, 'view_sales')).toBe(false);
    expect(canAccess({ role: 'client', is_owner: false }, 'view_dashboard')).toBe(true);
  });

  test('no role\'s list carries a project capability', () => {
    const matrix = read('lib', 'permissions.ts').split('const MATRIX')[1].split('};')[0];
    expect(matrix).not.toContain("'view_projects'");
    expect(matrix).not.toContain("'manage_projects'");
  });

  test('the owner flag comes from is_owner(), and fails closed', () => {
    const auth = read('features', 'auth', 'AuthProvider.tsx');
    expect(auth).toContain("supabase.rpc('is_owner')");
    expect(auth).toContain('is_owner: owner.data === true');
  });

  test('every project route is guarded by an owner capability', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/path="projects" element=\{[\s\S]{0,120}capability="view_projects"/);
    expect(app).toMatch(/path="projects\/templates" element=\{[\s\S]{0,120}capability="manage_projects"/);
    expect(app).toMatch(/path="projects\/:id" element=\{[\s\S]{0,120}capability="view_projects"/);
  });

  test('screens outside the tracker do not even ask for projects unless owner', () => {
    expect(read('pages', 'dashboard.tsx')).toContain("useDashboardOperations(maySales || mayProjects, reloadToken, mayProjects)");
    expect(read('pages', 'clients.tsx')).toContain('useClientRollups(reloadToken, mayProjects)');
    expect(read('pages', 'clients.tsx')).toContain('useClientDetail(id, reloadToken, mayProjects)');
    expect(read('pages', 'opportunity-detail.tsx')).toContain("if (!isConfigured || !mayProjects) return;");
  });
});

test.describe('the celebration is an event, never a rendering of state', () => {
  const callers = () => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (/ \d+(\.|$)/.test(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(e.name) && !full.endsWith('celebrate.ts')) {
          const body = fs.readFileSync(full, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
          for (const m of body.matchAll(/^.*\bcelebrate\(.*$/gm)) out.push(`${path.relative(SRC, full)}: ${m[0].trim()}`);
        }
      }
    };
    walk(SRC);
    return out;
  };

  test('exactly two call sites, each behind a confirmed successful transition', () => {
    const calls = callers();
    expect(calls).toHaveLength(2);
    // An ended monthly contract is not celebrated (20261006000100_monthly_contracts.sql).
    expect(calls).toContain("pages/projects.tsx: if (result === true && !monthly) celebrate('project_closed', project.name);");
    expect(calls).toContain("lib/sales.ts: if (winning && Array.isArray(data) && data.length > 0) celebrate('deal_won', current.title);");
  });

  test('a won write only matches a deal that was not already won', () => {
    expect(read('lib', 'sales.ts')).toContain("await query.neq('stage', 'won').select('id')");
  });

  test('a close only matches a project that was not already closed', () => {
    const ops = read('lib', 'operations.ts');
    expect(ops).toMatch(/update\(\{ status: 'completed' \}\)\s*\.eq\('id', id\)\s*\.neq\('status', 'completed'\)\s*\.select\('id'\)/);
  });

  test('reduced motion gets the status line and no animation', () => {
    const c = read('lib', 'celebrate.ts');
    expect(c).toContain("matchMedia('(prefers-reduced-motion: reduce)')");
    expect(c).toMatch(/announce\([^)]*\);\s*if \(!prefersReducedMotion\(\)\) burst\(\);/);
    expect(c).toContain("setAttribute('role', 'status')");
  });
});
