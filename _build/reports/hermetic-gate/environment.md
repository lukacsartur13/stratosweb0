# Hermetic gate — the environment, and what it is and is not isolated from

## 1. Where the gate runs

| | Path |
| --- | --- |
| Development checkout (NOT the gate) | `~/Library/Mobile Documents/com~apple~CloudDocs/Downloads/StratosWeb` |
| **Hermetic subject** | `/Users/arturlukacs/stratos-hermetic/subject` |
| Gate scratch | `/Users/arturlukacs/stratos-hermetic/work` |

Created with `git worktree add --detach`, so the subject is a separate working
directory holding one commit and nothing else. A `git checkout`, `git stash` or
new commit in the development checkout does not touch a worktree's files; only
the object database and refs are shared, and neither is part of the test
subject.

## 2. The iCloud question, answered precisely rather than claimed

§42 asks whether the filesystem contributes, and §4 warns against claiming
iCloud is excluded without proof. Both halves matter here, and the honest
statement has two parts:

**What is excluded.** The subject is outside `~/Library/Mobile Documents`, which
is the only tree `bird` (the iCloud sync daemon) manages. Nothing in the gate
path can now be evicted to the cloud, materialised on demand, or rewritten by a
sync. No `.icloud` placeholder exists anywhere under the subject — the manifest
tool reports them as a distinct field precisely so their absence is measured
rather than assumed, and it reports zero.

**What is NOT excluded.** The subject is on `/dev/disk3s5` — `/System/Volumes/Data`,
the same APFS volume as the development checkout. "Outside iCloud" here means
outside the synchronised *directory*, not on different physical storage. Any
hypothesis about the underlying device, APFS itself, or volume-level contention
is **not** addressed by this move and is not claimed to be.

**What was actually measured.** One number, and it is a large one: a full
`npm run build` takes **10.6 s** in the hermetic subject. The same build in the
iCloud checkout is materially slower, and every file the suite serves is read
from this tree hundreds of times per run. The storage hypothesis is not proven
either way; per §42 it was not pursued further, because hermetic hashing removes
the mutation uncertainty that made it interesting in the first place.

## 3. Host

| | |
| --- | --- |
| Platform | macOS (Darwin 25.6.0), arm64 |
| Cores | 10 |
| Memory | 25.8 GB |
| Free space | 275 GB |
| Node | v24.18.1 |
| Python | **3.9.6** — `http.server` is HTTP/1.0, no keep-alive |
| Playwright | 1.62.1 |

## 4. Ownership — the §5 finding, stated plainly

**A second Claude Code session was running against the development checkout when
this workstream started** (pid 95122, started 20:39; this session is 96095). It
had written nothing in the 40 minutes before the gate was built, and it cannot
write into the hermetic worktree, but it is the exact hazard §5 names and it was
not shut down — that is the user's call, not the harness's.

The mitigation is architectural rather than social: the subject is a separate
directory that no other session has been pointed at, and every run hashes it
before and after and watches it throughout. A concurrent agent can no longer
silently contaminate a gate; at worst it invalidates one, visibly.

### Orphans found and cleared

| Process | Started | Disposition |
| --- | --- | --- |
| `node scripts/test-server.mjs 4399 dist` (pid 42821) | 04:19, ~17 h earlier | **Killed.** Left by the previous investigation — the §45 orphan, still holding port 4399 and still serving the iCloud `dist/`. |
| `python3 -m http.server 8877` (pid 67362) | Sunday | **Left running, documented.** Its cwd is `/private/tmp/rkdist`, not this repository, and it holds a port no gate uses. |

`gate-run.mjs` now tracks every process it starts and refuses to finish a run
while one is still alive or a gate port is still held, so this class of orphan
cannot recur silently.

## 5. Idle-host baseline

Recorded before the authoritative sequence, sampled every 5 s by the gate's own
monitor.

| | |
| --- | --- |
| Load average at rest | 2.20 / 2.33 / 2.01 |
| Load during a non-browser gate (smoke) | mean 2.88, peak 4.35 |
| Swap in use | recorded per run in `gate.json` |

The baseline is **not zero**, and saying so matters: this is a workstation with
a desktop session, two editor/agent processes and a handful of MCP servers
running. §13 asks for a *reasonably* idle host, and the deliberate heavy
consumers — builds, Blender, video rendering, other suites, other browser
automation — are all absent. Load is recorded on every run so a failure can be
correlated against it, and per §12 load alone never invalidates a run.

## 6. What invalidates a run

Only these, and all of them are checked by the program rather than by a person:

- any of the four subject hashes differs between the before and after manifests;
- any write event lands on `dist/`, `tests/`, `assets/`, `portal/src`,
  `experiments/src` or `scripts/` while the canaries are armed — **including a
  write that is later reverted**, which the hashes alone cannot see;
- the built artefact does not match the frozen `--expect-dist` reference;
- a test server dies before a gate that needs it;
- Playwright's collected count does not reconcile with passed + failed + skipped;
- a process the gate started is still alive, or a gate port is still held, at
  the end of the run.

Verified against a deliberate mutation: appending to `dist/index.html` mid-run
and reverting it two seconds later produced **IDENTICAL** before/after hashes
and the run was still correctly classified `INVALID` on the canary.
