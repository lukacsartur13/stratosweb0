// =============================================================================
// Who is holding the dead renderers?
//
// The census says one `WebGL2RenderingContext` and its wrapper objects are
// retained per cycle. That is a fact about counts, not about cause. This walks
// the heap snapshot's retainer graph backwards from each retained context to a
// GC root and prints the shortest path, so the answer is read off the heap
// rather than inferred from reading three.js.
// =============================================================================
import { chromium } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4324';
const URL = `${ORIGIN}${process.env.BASE_PATH ?? '/experiments/stratos-ascent-full/'}`;
const CYCLES = Number(process.env.CYCLES ?? 3);
const OUT = process.env.OUT ?? 'experiments/bench-out';
const TARGETS = (process.env.TARGETS ?? 'WebGL2RenderingContext').split(',');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send('HeapProfiler.enable');

await page.goto(URL, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
await page.waitForTimeout(3500);

for (let i = 1; i <= CYCLES; i++) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length === 0, { timeout: 20_000 });
  await page.waitForTimeout(700);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.waitForFunction(() => document.querySelectorAll('canvas').length > 0, { timeout: 20_000 });
  await page.waitForTimeout(2400);
  process.stdout.write(`cycle ${i} done\n`);
}

for (let i = 0; i < 5; i++) {
  await cdp.send('HeapProfiler.collectGarbage');
  await page.waitForTimeout(200);
}

const chunks = [];
const onChunk = (p) => chunks.push(p.chunk);
cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, treatGlobalObjectsAsRoots: true });
cdp.off('HeapProfiler.addHeapSnapshotChunk', onChunk);
await context.close();
await browser.close();

const snap = JSON.parse(chunks.join(''));
const meta = snap.snapshot.meta;
const NF = meta.node_fields.length;
const EF = meta.edge_fields.length;
const nName = meta.node_fields.indexOf('name');
const nType = meta.node_fields.indexOf('type');
const nEdges = meta.node_fields.indexOf('edge_count');
const nId = meta.node_fields.indexOf('id');
const eType = meta.edge_fields.indexOf('type');
const eName = meta.edge_fields.indexOf('name_or_index');
const eTo = meta.edge_fields.indexOf('to_node');
const nodeTypes = meta.node_types[nType];
const edgeTypes = meta.edge_types[eType];
const S = snap.strings;
const nodes = snap.nodes;
const edges = snap.edges;
const count = nodes.length / NF;

// Edge offsets per node.
const firstEdge = new Uint32Array(count + 1);
for (let i = 0, acc = 0; i < count; i++) {
  firstEdge[i] = acc;
  acc += nodes[i * NF + nEdges];
  firstEdge[i + 1] = acc;
}

const nodeName = (i) => S[nodes[i * NF + nName]];
const nodeKind = (i) => nodeTypes[nodes[i * NF + nType]];

// Reverse edges: retainer index + the edge that got there.
const retCount = new Uint32Array(count);
for (let e = 0; e < edges.length / EF; e++) retCount[edges[e * EF + eTo] / NF]++;
const retStart = new Uint32Array(count + 1);
for (let i = 0, acc = 0; i < count; i++) {
  retStart[i] = acc;
  acc += retCount[i];
  retStart[i + 1] = acc;
}
const retFrom = new Uint32Array(edges.length / EF);
const retEdge = new Uint32Array(edges.length / EF);
const cursor = retStart.slice();
for (let i = 0; i < count; i++) {
  for (let e = firstEdge[i]; e < firstEdge[i + 1]; e++) {
    const to = edges[e * EF + eTo] / NF;
    const at = cursor[to]++;
    retFrom[at] = i;
    retEdge[at] = e;
  }
}

const edgeLabel = (e) => {
  const t = edgeTypes[edges[e * EF + eType]];
  const raw = edges[e * EF + eName];
  return t === 'element' || t === 'hidden' ? `[${raw}]` : `${S[raw] ?? raw}`;
};

/** Shortest retainer path to a GC root, breadth-first over reverse edges. */
function pathToRoot(start) {
  const seen = new Set([start]);
  const queue = [start];
  const prev = new Map();
  while (queue.length) {
    const cur = queue.shift();
    if (nodeKind(cur) === 'synthetic' && cur !== start) {
      const out = [];
      let n = cur;
      while (n !== undefined) {
        const p = prev.get(n);
        out.push({ name: nodeName(n), kind: nodeKind(n), via: p ? edgeLabel(p.edge) : null });
        n = p?.node;
      }
      return out;
    }
    for (let r = retStart[cur]; r < retStart[cur + 1]; r++) {
      const from = retFrom[r];
      if (seen.has(from)) continue;
      seen.add(from);
      prev.set(from, { node: cur, edge: retEdge[r] });
      queue.push(from);
    }
  }
  return null;
}

const report = {};
for (const target of TARGETS) {
  const hits = [];
  for (let i = 0; i < count; i++) if (nodeName(i) === target) hits.push(i);
  console.log(`\n=== ${target}: ${hits.length} instances after ${CYCLES} cycles ===`);
  const paths = [];
  for (const h of hits) {
    const p = pathToRoot(h);
    paths.push(p);
  }
  // Group identical paths so repeated retention shows as one shape.
  const grouped = new Map();
  for (const p of paths) {
    if (!p) continue;
    const key = p.map((s) => `${s.via ?? ''}:${s.name}`).join(' ← ');
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [k, v] of [...grouped].sort((a, b) => b[1] - a[1])) {
    console.log(`\n  ${v}x`);
    for (const seg of k.split(' ← ')) console.log(`     ${seg}`);
  }
  report[target] = [...grouped].map(([path, n]) => ({ n, path: path.split(' ← ') }));
}

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/retainers.json`, JSON.stringify(report, null, 2));
console.log(`\nwritten: ${OUT}/retainers.json`);
