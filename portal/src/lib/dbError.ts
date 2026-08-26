// =============================================================================
// What the database actually said, and what the operator is told.
//
// This file has NO IMPORTS, on purpose — the same rule `money.ts` and
// `pipeline.ts` follow. It is a pure classification over a PostgREST error
// object, so a test can exercise every branch without a browser or a project.
//
// WHY IT EXISTS
// -------------
// The Sales screen spent its whole life reporting one cause for every failure.
// The check was `error.code === '42P01'` for "the table is missing", and
// anything else fell through to
//
//     The database refused the request. Check that your account may read the
//     pipeline.
//
// `42P01` is Postgres's `undefined_table`, and PostgREST does not return it.
// When a table is absent from the schema cache PostgREST answers **404
// PGRST205**, which took the fallback branch — so a database that had never had
// the migration applied reported itself as a PERMISSIONS problem, in a sentence
// naming the reader's own account. Six audits looked at RLS. RLS was correct the
// whole time; `public.opportunities` did not exist.
//
// The lesson generalises, and it is the reason this is a table rather than two
// more `if`s: an RLS denial on SELECT is not an error at all. PostgREST answers
// `200 []`. So "the database refused the request" was not merely the wrong
// message for a missing table — it was a message that the case it names could
// never actually produce.
//
// WHAT IS SAFE TO SHOW, AND WHAT IS ONLY SAFE TO LOG
// --------------------------------------------------
// `message` is the sentence a person reads. It never contains the database's
// own text: Postgres names columns, constraints, policies and functions in its
// messages, which is a description of the schema to whoever is looking at the
// screen.
//
// `describe()` is the developer's line, for the console only. It carries the
// code, message, details and hint — the four fields PostgREST returns and
// nothing else. There is no path by which a token, a key or a password reaches
// it: none of those four fields ever holds one, and the error object is never
// logged whole.
// =============================================================================

/**
 * The seven causes worth telling apart, from §11.
 *
 * These are INTERNAL. Two of them share a user-facing sentence, and that is
 * deliberate — what an operator can do about a problem is a coarser question
 * than what caused it.
 */
export type DbFailure =
  | 'unauthenticated'   // there is no session, or it expired mid-request
  | 'denied'            // the caller is signed in and the policy said no
  | 'network'           // the request never reached PostgREST
  | 'schema_mismatch'   // the table is there and does not have what we asked for
  | 'migration_missing' // the table, view or function is not there at all
  | 'invalid_query'     // we sent something the database would not accept
  | 'server_error';     // everything else, including an actual outage

/** The shape supabase-js hands back. Every field optional — some errors have none. */
export interface PostgrestLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
  status?: number | null;
}

/**
 * The codes, and where each one comes from.
 *
 * PGRST* are PostgREST's own; the five-character ones are Postgres SQLSTATEs,
 * which arrive when the statement reached the database and it objected.
 */
const BY_CODE: Record<string, DbFailure> = {
  // ---- the object is not there ------------------------------------------
  // PostgREST's schema cache does not know the relation. This is what a missing
  // migration looks like from the browser, and it is a 404 rather than a 500.
  PGRST205: 'migration_missing', // "Could not find the table '…' in the schema cache"
  PGRST202: 'migration_missing', // the same, for a function: rpc() target absent
  '42P01':  'migration_missing', // undefined_table, straight from Postgres
  '42883':  'migration_missing', // undefined_function

  // ---- the object is there and is the wrong shape -----------------------
  PGRST200: 'schema_mismatch',   // no relationship found for an embed — a missing FK
  // Two or more foreign keys between the same pair of tables, and the embed did
  // not say which. A 300, not a 4xx. This is what `opportunities` embedding
  // `profiles` returned in production the moment the table existed: `owner_id`
  // and `created_by` both point at `profiles`, so the request never ran.
  PGRST201: 'schema_mismatch',
  PGRST204: 'schema_mismatch',   // a column named in the body is not on the table
  '42703':  'schema_mismatch',   // undefined_column
  '42804':  'schema_mismatch',   // datatype_mismatch

  // ---- the session ------------------------------------------------------
  PGRST301: 'unauthenticated',   // JWT expired or could not be verified
  PGRST302: 'unauthenticated',   // anonymous request to something that requires a user

  // ---- the policy or the grant ------------------------------------------
  // Worth stating plainly, because it is the case the old message claimed and
  // almost never was: on SELECT this code does NOT appear when RLS hides rows —
  // that is `200 []`. `42501` is the GRANT layer, and on INSERT/UPDATE it is a
  // policy's WITH CHECK refusing the write. Both are genuine authorization.
  '42501':  'denied',
  PGRST116: 'denied',            // 0 rows where exactly 1 was required by .single()

  // ---- we sent something wrong ------------------------------------------
  '22P02':  'invalid_query',     // invalid_text_representation — a malformed uuid or enum
  '23502':  'invalid_query',     // not_null_violation
  '23503':  'invalid_query',     // foreign_key_violation
  '23505':  'invalid_query',     // unique_violation
  '23514':  'invalid_query',     // check_violation
  '22003':  'invalid_query',     // numeric_value_out_of_range
  PGRST100: 'invalid_query',     // the query string itself would not parse
};

/**
 * Classify.
 *
 * `hasSession` is what separates the two authorization answers, and it is
 * passed in rather than read here because this module has no imports and no
 * business holding a Supabase client. Without a session a refusal is "you are
 * not signed in"; with one it is "your account may not do this" — the same
 * HTTP status, two entirely different things for the person reading it.
 */
export function classify(
  error: PostgrestLike | null | undefined,
  hasSession = true,
): DbFailure {
  if (!error) return 'server_error';

  const code = error.code ?? '';
  const mapped = BY_CODE[code];
  if (mapped) {
    // A grant refusal with no session is not an authorization problem to
    // report to the operator — it is a sign-in problem, and saying "your
    // account may not do this" about an account that is not signed in sends
    // somebody to ask for permissions they already have.
    if (mapped === 'denied' && !hasSession) return 'unauthenticated';
    return mapped;
  }

  // supabase-js surfaces a failed fetch as an error with no code at all. So does
  // an aborted request and an offline browser. There is no status either,
  // because nothing answered.
  if (!code && !error.status) return 'network';
  if (typeof error.status === 'number' && error.status >= 500) return 'server_error';

  return 'server_error';
}

/**
 * The sentence.
 *
 * Concise in production, and every one of them says what to DO. A message that
 * describes a state without naming an action is a message that gets screenshotted
 * and sent to somebody else to interpret.
 *
 * `subject` is what the operator was looking at — "the pipeline", "this
 * opportunity" — so the sentence reads about their task rather than about a
 * table. It is never the database's own name for anything.
 */
export function sentence(
  failure: DbFailure,
  subject = 'this data',
  action: 'read' | 'write' = 'read',
): string {
  switch (failure) {
    case 'unauthenticated':
      return 'Your session has ended. Sign in again to continue.';
    case 'denied':
      // Reading and writing are refused by different policies and are fixed by
      // different things, so they are not told in the same sentence. `view_sales`
      // and `manage_sales` are two capabilities for exactly this reason.
      return action === 'write'
        ? `Your account may not change ${subject}.`
        : `Your account does not have access to ${subject}.`;
    case 'network':
      return 'Could not reach the database. Check the connection and try again.';
    case 'migration_missing':
      return `${cap(subject)} is not set up in this database yet. The pipeline migration in supabase/migrations has not been applied.`;
    case 'schema_mismatch':
      return `${cap(subject)} does not match what this version of the Portal expects. The database may be behind a newer build.`;
    case 'invalid_query':
      return 'The database refused those values. Check the amount, the probability, the stage and the dates.';
    case 'server_error':
    default:
      return action === 'write'
        ? 'That change could not be saved. Try again in a moment.'
        : `${cap(subject)} could not be read. Try again in a moment.`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * The developer's line. Console only — never rendered.
 *
 * Four fields, named explicitly. Spreading the error object would be shorter and
 * would log whatever a future supabase-js decides to attach to it, which is how
 * a token ends up in a log nobody meant to put one in.
 */
export function describe(error: PostgrestLike | null | undefined, failure: DbFailure): string {
  if (!error) return `[${failure}] no error object`;
  const parts = [
    `[${failure}]`,
    error.code ? `code=${error.code}` : null,
    error.status ? `status=${error.status}` : null,
    error.message ? `message=${error.message}` : null,
    error.details ? `details=${error.details}` : null,
    error.hint ? `hint=${error.hint}` : null,
  ].filter(Boolean);
  return parts.join(' ');
}

/**
 * Classify, log the safe metadata, and return the sentence. The one call every
 * read and every mutation in the sales layer makes.
 */
export function refusal(
  where: string,
  error: PostgrestLike | null | undefined,
  subject: string,
  hasSession = true,
  action: 'read' | 'write' = 'read',
): { failure: DbFailure; message: string } {
  const failure = classify(error, hasSession);
  console.error(`[${where}]`, describe(error, failure));
  return { failure, message: sentence(failure, subject, action) };
}
