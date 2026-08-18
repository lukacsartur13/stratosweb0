# The subject manifest — what is hashed, and what the hashes proved

## 1. The groups

`scripts/hermetic/manifest.mjs capture` walks four groups and content-hashes
every file with SHA-256. The group hash is over the sorted `path:sha` lines, so
it changes if a file is added, removed **or renamed**, not only edited.

| Group | Roots | Files at the frozen commit |
| --- | --- | --- |
| `product` | `assets/`, `en/`, `de/`, `portal/src`, `portal/index.html`, `portal/public`, `experiments/src`, `netlify/`, `supabase/`, `public/`, `_build/pages`, `_build/i18n`, `_build/partials`, `_build/build.py`, plus every root-level `*.html` | **304** |
| `test` | `tests/`, `scripts/` | **54** |
| `config` | both Playwright configs plus the experiments and mountains configs, `package.json` + lockfile, `netlify.toml`, `portal/` and `experiments/` manifests, lockfiles and tsconfigs, `portal/vite.config.ts` | **14** |
| `dist` | the whole served tree | **186** |

A combined hash is derived from the four so a report can quote one number
without it being able to disagree with them.

Cost: **~0.1 s** for the full capture. There is no reason not to run it on every
gate.

## 2. What is excluded, and the honest limitation

| Excluded | Why |
| --- | --- |
| `_build/reports/**` | The gate writes its own reports here **while it runs**. Hashing them would make every run invalidate itself. |
| `test-results/**`, `.playwright` | Playwright's own scratch, same reason. |
| `node_modules/**` | ~50 000 files across three trees (408 MB). Hashing per run would cost more than the run. |
| `.git/**` | Not the subject. Another session committing in the main checkout must not invalidate a gate in a worktree — and a worktree's files are unaffected by that anyway. |
| `.DS_Store`, `._*`, `*.icloud` | Written by the Finder and by iCloud metadata handling at moments nobody controls. A run invalidated by a Finder window is invalidated for no reason. `.icloud` placeholders are *counted and reported* rather than silently skipped. |

**The limitation, stated rather than hidden:** dependencies are frozen by the
lockfiles, which *are* hashed, and by the fact that nothing in the gate path runs
an install. A dependency mutated in place without touching a lockfile would not
be caught.

## 3. What the hashes actually proved in this workstream

### The build is byte-for-byte deterministic

Two independent `npm run build` invocations from the same frozen source produced
an identical `dist` hash:

```
manifest 00f526c8767f  product=69106294(304) test=51fb71b7(48) config=2a17568a(14) dist=25e32163(171)
manifest 00f526c8767f  product=69106294(304) test=51fb71b7(48) config=2a17568a(14) dist=25e32163(171)
SUBJECT IDENTICAL  00f526c8767f477cb3e8f4e474bb3794125df8e9efffce1804d685cdb0afa7a5
```

This is the fact the whole gate design rests on. It makes "build every run and
require identical bytes" viable, which satisfies §51's production-build gate
without violating §7's immutable artefact.

### It caught a corrupted edit that a diff would have shown and a timestamp would not

During the §20 mutation check, a `perl -0pi` substitution silently mangled
`assets/js/home-history.js` instead of replacing the intended line. The mangling
was invisible in the command's own output — a `grep | head` pipeline returns
`head`'s exit status, so the `&&` chain continued and reported success.

It was caught by hashing, restored from backup, and confirmed byte-exact: after
the restore and rebuild, `dist` read `2cce7616` — the frozen reference, to the
digit. A subsequent deliberate mutation and revert produced the same hash again.

### It proved the canary is not redundant with the hashes

A `dist/index.html` appended to 20 s into a run and reverted 2 s later:

```
subject 19770ebe00249cbf -> 19770ebe00249cbf  IDENTICAL
canary  2 write event(s) during the run
RUN canary-proof2   INVALID   ...   CANARY_WRITES_DURING_RUN=2
```

Both hashes identical, run correctly rejected. A final hash alone would have
called it clean — which is exactly §43's scenario.

## 4. Where the manifests live

```
_build/reports/hermetic-gate/manifests/frozen-reference.json
_build/reports/hermetic-gate/manifests/<run-id>-before.json
_build/reports/hermetic-gate/manifests/<run-id>-after.json
```

Compared automatically at the end of every run by
`manifest.mjs compare`, which exits 3 and prints the changed / added / removed
paths per group on any difference. `gate-run.mjs` turns that exit code into
`SUBJECT_MUTATED_DURING_RUN` and refuses the verdict.
