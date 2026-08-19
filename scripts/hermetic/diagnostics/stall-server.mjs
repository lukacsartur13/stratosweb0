#!/usr/bin/env node
/**
 * A server that receives a request and never answers it — §37, arm B.
 *
 * WHY THIS IS A SEPARATE PROCESS
 * ------------------------------
 * The stall started life as three lines inside `scripts/test-server.mjs`,
 * behind an environment variable. It worked, and it was reverted, because §37
 * ends "revert all diagnostic mutations" and a permanently-present stall hook
 * in the gate's own server is exactly the mutation that clause is about — it
 * would sit in the frozen subject forever, inert but present, in the one file
 * whose correctness the whole hermetic argument rests on.
 *
 * So the ability to stall lives here instead. `scripts/test-server.mjs` is
 * byte-identical to its pre-self-test state plus the §9 logging it is required
 * to have, and the self-test remains repeatable rather than a claim about a
 * transcript.
 *
 * WHAT IS AND IS NOT PROVEN BY IT
 * -------------------------------
 * This process proves the MERGE: that a `received` line with no `finish` line
 * yields SERVER_RECEIVED and stops there. That the REAL server emits those
 * lines correctly is proven by the other five arms, every one of which reaches
 * SERVER_RECEIVED through `scripts/test-server.mjs` itself.
 *
 * Emits the same JSONL shape into the same directory, so the reader in
 * `tests/helpers/navigation-boundary.ts` needs no special case.
 */

import { createServer } from 'node:http';
import { openSync, writeSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const port = Number(process.argv[2] ?? 4399);
const dir = process.env.STRATOS_NAV_DIAG_DIR;
if (!dir) { console.error('stall-server: STRATOS_NAV_DIAG_DIR is required'); process.exit(2); }
mkdirSync(dir, { recursive: true });
const fd = openSync(join(dir, `server-${port}.jsonl`), 'a');
const hr = () => Number(process.hrtime.bigint() / 1000n) / 1000;
const write = (o) => writeSync(fd, `${JSON.stringify(o)}\n`);

write({ kind: 'epoch', port, wallMs: Date.now(), hrMs: hr() });

const held = [];
createServer((req, res) => {
  const navId = req.headers['x-stratos-nav'] ?? null;
  if (navId) {
    write({ kind: 'req', navId, seq: 0, phase: 'received', hrMs: hr(), method: req.method, url: req.url, remotePort: req.socket.remotePort ?? null, stalled: true });
  }
  // Held, not closed: closing would produce a transport error and the arm would
  // be testing §23 instead of §24. The reference keeps the socket out of GC.
  held.push(res);
}).listen(port, '127.0.0.1', () => console.log(`stall-server: http://127.0.0.1:${port}`));
