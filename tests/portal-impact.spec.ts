import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  IMPACT_QUESTIONS, IMPACT_STATUSES, SETTABLE_IMPACT_STATUSES, impactAnswers, impactCloseBlockers,
  impactRefusal, isImpactLead, parseMarketValue,
} from '../portal/src/lib/impactRules';
import { IMPACT_SETTABLE_STATES, SETTABLE_PROJECT_STATES, closeRefusal, isLiveProject } from '../portal/src/lib/pipeline';
import { OWNER_CAPABILITIES, canAccess } from '../portal/src/lib/permissions';

/**
 * The Impact Program — the pure rules and the structural contracts.
 *
 * `lib/impactRules.ts`, `lib/pipeline.ts` and `lib/permissions.ts` import
 * nothing, so their answers are asserted directly. The database half (capture,
 * the wall, free, the close rule, the counters, owner-only RLS) is asserted
 * against a real Postgres in portal-impact-db.spec.ts; the rendered half by
 * scripts/portal-tracker-check.mjs.
 */

const SRC = path.join(process.cwd(), 'portal', 'src');
const read = (...p: string[]) => fs.readFileSync(path.join(SRC, ...p), 'utf8');

test.describe('the application pipeline', () => {
  test('seven states, and "project started" is never offered by hand', () => {
    expect([...IMPACT_STATUSES]).toEqual(
      ['applied', 'review', 'consultation', 'accepted', 'project_started', 'rejected', 'deferred']);
    expect(SETTABLE_IMPACT_STATUSES).not.toContain('project_started');
    expect(SETTABLE_IMPACT_STATUSES).toHaveLength(6);
  });

  test('the migration defines the same seven, in the same order', () => {
    const sql = fs.readFileSync(path.join(process.cwd(), 'supabase', 'migrations', '20260929000300_impact_program.sql'), 'utf8');
    const m = sql.match(/create type impact_status as enum\s*\(([^)]*)\)/);
    expect(m?.[1].split(',').map((s) => s.trim().replace(/'/g, ''))).toEqual([...IMPACT_STATUSES]);
  });

  test('an Impact lead is the form\'s fact, never a guess from free text', () => {
    expect(isImpactLead({ form_type: 'impact' })).toBe(true);
    expect(isImpactLead({ form_type: null, source: 'impact' })).toBe(true);
    expect(isImpactLead({ form_type: null, source: ' IMPACT ' })).toBe(true);
    expect(isImpactLead({ form_type: 'contact', source: 'impact' })).toBe(false);
    expect(isImpactLead({ form_type: null, source: 'website' })).toBe(false);
    expect(isImpactLead({ form_type: null, source: null })).toBe(false);
  });

  test('answers render under the form\'s own questions; contact stays out; unknown keys are kept', () => {
    const answers = impactAnswers({
      org: 'Zöld Kör', kapcs: 'Anna', mail: 'a@x', terulet: 'Környezet', hatas: '12 000 fa',
      adatkezeles_elfogadva: true, extra: 'kept', blank: '',
    });
    expect(answers).toEqual([
      { label: 'Tevékenységi terület', value: 'Környezet' },
      { label: 'Elért hatás', value: '12 000 fa' },
      { label: 'Adatkezelés elfogadva', value: 'Igen' },
      { label: 'extra', value: 'kept' },
    ]);
    expect(impactAnswers(null)).toEqual([]);
  });

  test('the questions match the form schema the site validates', () => {
    const contract = fs.readFileSync(path.join(process.cwd(), 'netlify', 'functions', 'lead-contract.mjs'), 'utf8');
    const impact = contract.split('impact: {')[1].split('questionnaire:')[0];
    const keys = [...impact.matchAll(/^\s+(\w+):\s+\{ type:/gm)].map((m) => m[1]);
    expect(IMPACT_QUESTIONS.map((q) => q.key)).toEqual(keys);
  });
});

test.describe('market value', () => {
  test('blank is "not recorded", which is not zero', () => {
    expect(parseMarketValue('')).toEqual({ value: null });
    expect(parseMarketValue('   ')).toEqual({ value: null });
    expect(parseMarketValue('0')).toEqual({ value: 0 });
  });

  test('whole forints, with the separators people type', () => {
    expect(parseMarketValue('1 250 000')).toEqual({ value: 1250000 });
    expect(parseMarketValue('1.250.000')).toEqual({ value: 1250000 });
    expect(parseMarketValue('1 250 000 Ft')).toEqual({ value: 1250000 });
    expect(parseMarketValue('800000HUF')).toEqual({ value: 800000 });
  });

  test('no decimals, no negatives, no words, no absurd sizes', () => {
    for (const bad of ['12,5', '12.5', '-1', '−1', 'abc', '1e6', '2000000000000']) {
      expect('error' in parseMarketValue(bad), bad).toBe(true);
    }
  });

  test('the close names every missing piece, in order', () => {
    expect(impactCloseBlockers({ market_value: null }, { total: 0, done: 0 }))
      .toEqual(['at least one checkpoint', 'the market value of the donated work']);
    expect(impactCloseBlockers({ market_value: 0 }, { total: 3, done: 1 })).toEqual(['2 of 3 checkpoints still open']);
    expect(impactCloseBlockers({ market_value: null }, { total: 2, done: 2 })).toEqual(['the market value of the donated work']);
    expect(impactCloseBlockers({ market_value: 0 }, { total: 2, done: 2 })).toEqual([]);
  });

  test('the database\'s refusals become sentences', () => {
    expect(closeRefusal('stratos:impact_close_no_market_value')).toMatch(/market value/);
    expect(impactRefusal('ERROR: stratos:impact_not_sellable')).toMatch(/cannot become a paid opportunity/);
    expect(impactRefusal('violates check constraint "projects_impact_free_check"')).toMatch(/free/);
    expect(impactRefusal('stratos:impact_not_accepted')).toMatch(/accepted/);
    expect(impactRefusal('permission denied')).toBeNull();
  });
});

test.describe('project states', () => {
  test('cancelled is offered for Impact projects only, and is not live', () => {
    expect(IMPACT_SETTABLE_STATES).toContain('cancelled');
    expect(SETTABLE_PROJECT_STATES).not.toContain('cancelled');
    expect(IMPACT_SETTABLE_STATES).not.toContain('completed');
    expect(isLiveProject({ status: 'cancelled', archived_at: null })).toBe(false);
  });
});

test.describe('owner-only', () => {
  test('view_impact is an owner capability and no role carries it', () => {
    expect(OWNER_CAPABILITIES).toContain('view_impact');
    const matrix = read('lib', 'permissions.ts').split('const MATRIX')[1].split('};')[0];
    expect(matrix).not.toContain("'view_impact'");
    expect(canAccess({ role: 'super_admin', is_owner: true }, 'view_impact')).toBe(true);
    for (const profile of [
      { role: 'super_admin' as const, is_owner: false }, { role: 'admin' as const, is_owner: false },
      { role: 'team_member' as const, is_owner: false }, { role: 'client' as const, is_owner: false },
    ]) expect(canAccess(profile, 'view_impact'), JSON.stringify(profile)).toBe(false);
    expect(canAccess({ role: 'admin', is_owner: true }, 'view_impact')).toBe(true); // a named owner delegate
  });

  test('both Impact routes are guarded, and the nav item follows the capability', () => {
    const app = read('App.tsx');
    expect(app).toMatch(/path="impact" element=\{[\s\S]{0,120}capability="view_impact"/);
    expect(app).toMatch(/path="impact\/applications\/:id" element=\{[\s\S]{0,120}capability="view_impact"/);
    expect(read('components', 'shell', 'PortalShell.tsx')).toMatch(/to: '\/impact',[^\n]*cap: 'view_impact'/);
  });
});

test.describe('separation from the paid business', () => {
  test('the paid project list excludes Impact; the Dashboard counts paid, live projects', () => {
    expect(read('pages', 'projects.tsx')).toContain("rows.filter((p) => !p.archived_at && p.program !== 'impact')");
    const biz = read('lib', 'business.ts');
    expect(biz).toContain(".eq('program', 'paid')");
    expect(biz).toContain('"completed","archived","care","cancelled"');
  });

  test('an Impact lead shows no "Convert to opportunity"', () => {
    const detail = read('pages', 'lead-detail.tsx');
    expect(detail).toMatch(/isImpactLead\(lead\)\s*\?\s*<ImpactNotice[^]*?:\s*<Conversion /);
  });

  test('an Impact project is never sent a fee, currency or payment from the edit dialog', () => {
    const projects = read('pages', 'projects.tsx');
    expect(projects).toMatch(/\.\.\.\(impact \? \{\} : \{\s*value:/);
  });

  test('starting a project is one RPC, not a sequence of client writes', () => {
    const impact = read('lib', 'impact.ts');
    expect(impact).toContain("supabase.rpc('impact_start_project'");
    expect(impact).not.toMatch(/from\('organizations'\)\.insert|from\('projects'\)\.insert/);
  });

  test('the counters come from the database function, never from a stored total', () => {
    expect(read('lib', 'impact.ts')).toContain("supabase.rpc('impact_support_summary')");
    expect(read('pages', 'impact.tsx')).not.toMatch(/localStorage|sessionStorage/);
  });
});

test('the Impact close celebrates through the same single call site', () => {
  // `close()` in the project screen serves paid and Impact projects alike; the
  // celebration contract in portal-tracker.spec.ts (exactly two call sites)
  // therefore covers Impact without a third.
  const body = read('pages', 'projects.tsx');
  expect(body.match(/\bcelebrate\(/g)).toHaveLength(1);
  expect(read('pages', 'impact.tsx')).not.toMatch(/\bcelebrate\(/);
});
