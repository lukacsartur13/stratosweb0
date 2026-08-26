import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import {
  classify, describe as describeError, refusal, sentence, type DbFailure,
} from '../portal/src/lib/dbError';

/**
 * The Sales pipeline, made live.
 *
 * ## The defect this file exists to keep dead
 *
 * The Sales screen reported one cause for every failure. The test was
 * `error.code === '42P01'` for "the table is missing"; everything else printed
 *
 *     The database refused the request. Check that your account may read the
 *     pipeline.
 *
 * `42P01` is Postgres's `undefined_table`, and **PostgREST never returns it**.
 * A relation absent from the schema cache is a 404 `PGRST205`. So a production
 * database that had simply never had the migration applied described itself as
 * a permissions problem, naming the reader's own account — and the case it
 * named cannot produce an error on SELECT at all, because an RLS denial answers
 * `200 []`.
 *
 * Every assertion below is on `lib/dbError.ts`, which has no imports and can be
 * exercised directly. The codes are the ones production actually returned on
 * 2026-08-26, recorded in `_build/reports/portal-sales-live/`.
 */

const ROOT = process.cwd();
const src = (...p: string[]) => fs.readFileSync(path.join(ROOT, 'portal', 'src', ...p), 'utf8');

test.describe('what the database said', () => {
  test('a missing table is a missing migration, not a refused permission', () => {
    // Measured against the live project: GET /rest/v1/opportunities → 404.
    const err = {
      code: 'PGRST205',
      message: "Could not find the table 'public.opportunities' in the schema cache",
      details: null,
      hint: null,
    };
    expect(classify(err)).toBe<DbFailure>('migration_missing');

    const message = sentence(classify(err), 'the pipeline');
    expect(message).toMatch(/migration/i);
    // The sentence that sent six audits after RLS must not be reachable here.
    expect(message).not.toMatch(/permission|refused|your account/i);
  });

  test('a missing function is a missing migration too', () => {
    // POST /rest/v1/rpc/portal_sales_summary → PGRST202, same cause.
    expect(classify({ code: 'PGRST202' })).toBe<DbFailure>('migration_missing');
    expect(classify({ code: '42883' })).toBe<DbFailure>('migration_missing');
  });

  test('the Postgres codes are kept even though PostgREST does not send them', () => {
    // Not dead weight: `42P01` and `42883` do arrive from an RPC whose body
    // references something that has since been dropped.
    expect(classify({ code: '42P01' })).toBe<DbFailure>('migration_missing');
  });

  test('a broken embed is a schema mismatch, not a missing table', () => {
    // `client:organizations(id, name)` without the foreign key behind it.
    expect(classify({ code: 'PGRST200' })).toBe<DbFailure>('schema_mismatch');
    expect(classify({ code: '42703' })).toBe<DbFailure>('schema_mismatch');
    expect(sentence('schema_mismatch', 'the pipeline')).toMatch(/behind a newer build/i);
  });

  test('a grant refusal is authorization only when somebody is signed in', () => {
    // The same code, two different things to tell the person reading it.
    expect(classify({ code: '42501' }, true)).toBe<DbFailure>('denied');
    expect(classify({ code: '42501' }, false)).toBe<DbFailure>('unauthenticated');
  });

  test('an expired token is an expired token', () => {
    expect(classify({ code: 'PGRST301' })).toBe<DbFailure>('unauthenticated');
    expect(sentence('unauthenticated')).toMatch(/sign in again/i);
  });

  test('a failed fetch has no code at all and is not called a server error', () => {
    expect(classify({ message: 'Failed to fetch' })).toBe<DbFailure>('network');
    expect(classify(null)).toBe<DbFailure>('server_error');
    expect(classify({ status: 503 })).toBe<DbFailure>('server_error');
  });

  test('the constraint codes are the operator’s own values, not an outage', () => {
    for (const code of ['23514', '23503', '23505', '23502', '22P02', '22003']) {
      expect(classify({ code }), code).toBe<DbFailure>('invalid_query');
    }
    expect(sentence('invalid_query')).toMatch(/amount|probability|stage/i);
  });

  test('reading and writing are refused in different sentences', () => {
    expect(sentence('denied', 'the pipeline', 'read')).toMatch(/does not have access/i);
    expect(sentence('denied', 'the pipeline', 'write')).toMatch(/may not change/i);
  });
});

test.describe('what is safe to say, and where', () => {
  test('no user-facing sentence repeats the database', () => {
    const FAILURES: DbFailure[] = [
      'unauthenticated', 'denied', 'network',
      'schema_mismatch', 'migration_missing', 'invalid_query', 'server_error',
    ];
    for (const failure of FAILURES) {
      for (const action of ['read', 'write'] as const) {
        const text = sentence(failure, 'the pipeline', action);
        // Postgres names columns, constraints, policies and functions in its
        // messages. None of that is a thing to paint across an operator's
        // screen — it is a description of the schema to whoever is looking.
        expect(text, `${failure}/${action}`).not.toMatch(
          /public\.|pg_|relation |constraint |policy |row-level|schema cache/i,
        );
        expect(text.length, `${failure}/${action}`).toBeLessThan(160);
      }
    }
  });

  test('the console line carries the four PostgREST fields and nothing else', () => {
    const line = describeError(
      {
        code: 'PGRST205',
        message: 'Could not find the table',
        details: 'd',
        hint: 'h',
        // Anything a future supabase-js decides to hang off the error object.
        ...({ access_token: 'SHOULD-NEVER-APPEAR' } as object),
      },
      'migration_missing',
    );
    expect(line).toContain('code=PGRST205');
    expect(line).toContain('hint=h');
    expect(line).not.toContain('SHOULD-NEVER-APPEAR');
  });

  test('nothing in the error path logs a token, a key or a session', () => {
    const file = src('lib', 'dbError.ts');
    // The whole error object is never spread or stringified into a log.
    expect(file).not.toMatch(/console\.(log|error|warn)\([^)]*\berror\b\s*\)/);
    expect(file).not.toMatch(/JSON\.stringify\(\s*error/);
    for (const forbidden of ['access_token', 'refresh_token', 'session', 'apikey', 'password']) {
      expect(file.toLowerCase(), forbidden).not.toContain(`error.${forbidden}`);
    }
  });
});

test.describe('the sales layer uses it', () => {
  test('no screen still tests for 42P01 as if PostgREST sent it', () => {
    for (const file of ['lib/sales.ts', 'lib/business.ts', 'pages/sales.tsx']) {
      const code = src(...file.split('/'));
      const live = code
        .split('\n')
        .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
        .join('\n');
      expect(live, file).not.toContain("=== '42P01'");
    }
  });

  test('the list read and every mutation classify through one module', () => {
    const sales = src('lib', 'sales.ts');
    expect(sales).toContain("from '@/lib/dbError'");
    // The old hand-rolled ladder is gone.
    expect(sales).not.toContain('The database refused the request');
    expect(sales).not.toContain('Run the migrations in supabase/migrations.');
  });

  test('the summary hook carries a message rather than four silent dashes', () => {
    const business = src('lib', 'business.ts');
    expect(business).toMatch(/return \{ rows, state, message, failure, reload: load \}/);
  });

  test('the KPI strip keeps its four cells and gains a cause line', () => {
    const page = src('pages', 'sales.tsx');
    // §17 — the layout is not redesigned. Still exactly four figures.
    const strip = page.slice(page.indexOf('function PipelineStrip'), page.indexOf('the board =='));
    for (const label of ['Total pipeline', 'Weighted', 'Closing this month', 'Won this month']) {
      expect(strip, label).toContain(`label: '${label}'`);
    }
    expect(strip).toContain('xl:grid-cols-4');
    // And the error is a sibling line, with a way out of it.
    expect(strip).toContain("state === 'error'");
    expect(strip).toContain('onRetry');
  });

  test('every error state offers a retry', () => {
    const page = src('pages', 'sales.tsx');
    // §7 — a permanent UNAVAILABLE with no way to re-ask is not an error state,
    // it is a dead end.
    expect(page).toContain('onRetry={list.reload}');
    expect(page).toContain('onRetry={summary.reload}');
  });
});

test.describe('the migration this phase applied', () => {
  const migration = (name: string) =>
    fs.readFileSync(path.join(ROOT, 'supabase', 'migrations', name), 'utf8');

  test('the lead_status enum addition can no longer fail silently', () => {
    const sql = migration('20260814000100_lead_pipeline.sql');
    const stmt = /alter type lead_status add value if not exists 'proposal'/;
    expect(sql).toMatch(stmt);

    // The statement must NOT sit inside a PL/pgSQL block with an exception
    // handler. Such a block runs in a subtransaction — the one context Postgres
    // still refuses `ALTER TYPE ... ADD VALUE` in — and the handler would then
    // swallow the refusal, so the migration reports success having added
    // nothing. That is exactly what this file used to do.
    const before = sql.slice(0, sql.search(stmt));
    const lastDo = before.lastIndexOf('do $$');
    const lastEnd = before.lastIndexOf('end $$;');
    expect(lastDo, 'the enum addition must be a bare top-level statement')
      .toBeLessThan(lastEnd);
    expect(sql).not.toMatch(/exception when others then null/);
  });

  test('neither migration drops, truncates or rewrites anything', () => {
    for (const name of ['20260814000100_lead_pipeline.sql', '20260816000100_revenue_operations.sql']) {
      const live = migration(name)
        .split('\n')
        .filter((l) => !l.trim().startsWith('--'))
        .join('\n');
      for (const forbidden of [
        /drop\s+table/i, /truncate/i, /delete\s+from/i,
        /drop\s+type/i, /drop\s+schema/i, /drop\s+database/i,
        /alter\s+table\s+\w+\s+drop\s+column/i, /drop\s+owned/i,
      ]) {
        expect(live, `${name} :: ${forbidden}`).not.toMatch(forbidden);
      }
      // The only `drop`s permitted are the re-runnable trigger/policy pattern.
      for (const line of live.split('\n').filter((l) => /^\s*drop\b/i.test(l))) {
        expect(line, name).toMatch(/^\s*drop (trigger|policy) if exists/i);
      }
    }
  });

  test('the applied scripts are the migrations, minus only the enum step', () => {
    const dir = path.join(ROOT, '_build', 'reports', 'portal-sales-live');
    const step1 = fs.readFileSync(path.join(dir, 'apply-01-enums.sql'), 'utf8');
    const step2 = fs.readFileSync(path.join(dir, 'apply-02-pipeline.sql'), 'utf8');

    // Step 1 holds both enum extensions and nothing that creates a table.
    expect(step1).toMatch(/alter type lead_status add value/);
    expect(step1).toMatch(/alter type project_status add value/);
    expect(step1).not.toMatch(/create table/i);

    // Step 2 holds no enum extension at all, so it cannot depend on an
    // uncommitted value.
    const live2 = step2.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(live2).not.toMatch(/add value/i);
    expect(live2).toMatch(/create table if not exists opportunities/);
  });
});

// The "no service role key in the bundle" contract is NOT re-asserted here.
// `tests/portal.spec.ts:55` already owns it and owns it correctly — it matches
// actual secret values over the scripts the shell really loads. A second,
// naiver copy here matched `sb_secret_` and fired on supabase-js's own key
// FORMAT DETECTOR (`t.startsWith("sb_secret_")`), which is library source and
// not a secret. A duplicated assertion that cries wolf is worse than one
// assertion in one place.

test('refusal returns both the cause and the sentence', () => {
  const { failure, message } = refusal(
    'opportunities', { code: 'PGRST205' }, 'the pipeline', true, 'read',
  );
  expect(failure).toBe<DbFailure>('migration_missing');
  expect(message).toMatch(/migration/i);
});
