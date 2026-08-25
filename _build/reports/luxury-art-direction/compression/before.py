#!/usr/bin/env python3
"""
RECONSTRUCT THE PHASE 5 DESKTOP PAGE, AND PUT IT BACK — §25 and §26.

A before/after pair is only a measurement if both halves come off the same rig
at the same pacing, and `git` cannot supply the first half here: the working
tree carried unrelated uncommitted work before this phase started, so HEAD is
not phase 5.

So the "before" is reconstructed by inverting this phase's edits. Three files
decide what the DESKTOP system chapter renders and how tall it is —
`content.ts`, `FullAscent.tsx` and `styles.css` — and only those are touched.
The portrait files, `messages.ts` and the services route change nothing about
the desktop picture and are left alone, which keeps the reconstruction small
enough to read.

IT REPRODUCES THE RENDERED PAGE, NOT THE SOURCE. Comments are not restored,
because a comment cannot change a pixel and transcribing four hundred lines of
prose is four hundred chances to get the reconstruction subtly wrong. What
makes that safe is that the reconstruction is VERIFIED rather than trusted:
`field-p51-before-bands.json` was measured on the real page before any edit,
and `check` compares a fresh measurement of the reconstruction against it band
by band. If the numbers do not reproduce, nothing recorded from it is kept.

  revert    write the reconstruction, after backing up the current files
  restore   put the phase 5.1 files back from that backup
  check     compare a fresh field measurement against the pre-edit one

Never committed. `restore` is run before anything else happens.
"""
import io, json, os, shutil, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..'))
SRC = os.path.join(ROOT, 'experiments', 'src', 'full')
BACKUP = os.path.join(HERE, '.p51-backup')

FILES = ['content.ts', 'FullAscent.tsx', 'styles.css']

# --- content.ts ---------------------------------------------------------------
C_AFTER_TYPE = """  ring: 0 | 1 | 2;
};"""
C_BEFORE_TYPE = """  ring: 0 | 1 | 2;
  blurb: string;
};"""

C_AFTER_TABLE = """  { id: 'research',    name: 'Kutatás',      ring: 0 },
  { id: 'strategy',    name: 'Stratégia',    ring: 0 },
  { id: 'branding',    name: 'Arculat',      ring: 1 },
  { id: 'website',     name: 'Weboldal',     ring: 1 },
  { id: 'development', name: 'Fejlesztés',   ring: 1 },
  { id: 'ads',         name: 'Hirdetés',     ring: 2 },
  { id: 'analytics',   name: 'Analitika',    ring: 2 },
  { id: 'optimisation',name: 'Optimalizálás',ring: 2 },
  { id: 'automation',  name: 'Automatizálás',ring: 2 },"""
C_BEFORE_TABLE = """  { id: 'research',    name: 'Kutatás',     ring: 0, blurb: 'Piac, versenytársak, keresési szándék. Mielőtt bármit építenénk.' },
  { id: 'strategy',    name: 'Stratégia',   ring: 0, blurb: 'Mit mondunk, kinek, és milyen sorrendben. Ez dönti el a többit.' },
  { id: 'branding',    name: 'Arculat',     ring: 1, blurb: 'A vizuális nyelv, amely minden felületen ugyanaz marad.' },
  { id: 'website',     name: 'Weboldal',    ring: 1, blurb: 'A központ, ahová minden csatorna vezet, és ahol a döntés megszületik.' },
  { id: 'development', name: 'Fejlesztés',  ring: 1, blurb: 'Egyedi funkciók, integrációk, sebesség. Nem sablon, nem plugin-halmaz.' },
  { id: 'ads',         name: 'Hirdetés',    ring: 2, blurb: 'Fizetett forgalom oda, ahol már van mit fogadnia.' },
  { id: 'analytics',   name: 'Analitika',   ring: 2, blurb: 'Mérés, amely nem riportot termel, hanem döntést.' },
  { id: 'optimisation',name: 'Optimalizálás',ring: 2, blurb: 'Havi finomhangolás a mért adatok alapján, nem megérzésből.' },
  { id: 'automation',  name: 'Automatizálás',ring: 2, blurb: 'Ami ismétlődik, azt nem embernek kell csinálnia.' },"""

# --- FullAscent.tsx -----------------------------------------------------------
F_AFTER_BODY = """      body={
        /* ONE BEAT, NOT THREE — the same `.passage__item` decision the process
           passage records below, arriving at the same answer from the other
           direction. Three blocks of three short lines do not have to be met
           one at a time; nine `name — sentence` pairs did, and that is exactly
           why they are not here any more. */
        <section className="passage__item">
          {rings.map((r) => (
            /* `.passage__layer` is `.passage__principle`'s rule, shared rather
               than copied: a name, a line under it, and nothing else. Two
               classes on one declaration is what stops the page growing a
               second treatment for the same object. */
            <div className="passage__layer" key={r}>
              <h3>{m(`system.ring.${r}.name`)}</h3>
              <p>{m(`system.ring.${r}.note`)}</p>
              <p className="passage__areas">
                {SYSTEM.filter((n) => n.ring === r).map((n, i) => (
                  /* THE SPACES INSIDE THE MIDDOT ARE LOAD-BEARING. `.act__index`
                     writes it `<i>·</i>` and spaces it with padding, which is
                     right there because that line is `white-space: nowrap` in a
                     frame wide enough for it. Here the line is in a 680u column
                     that has to wrap, and padding is not a break opportunity:
                     without a real space the operation layer's four names are
                     one unbreakable word. Measured overflowing its box by 67px
                     on a 390 and 82px on the German 360 before this. */
                  <span key={n.id}>
                    {i > 0 && <i> · </i>}
                    {n.name}
                  </span>
                ))}
              </p>
            </div>
          ))}
        </section>
      }"""
F_BEFORE_BODY = """      body={
        <>
          {rings.map((r) => (
            <section className="passage__item" key={r}>
              <h3>{m(`system.ring.${r}.name`)}</h3>
              <p>{m(`system.ring.${r}.note`)}</p>
              <ul className="passage__terms">
                {SYSTEM.filter((n) => n.ring === r).map((n) => (
                  <li key={n.id}>
                    <b>{n.name}</b> — {n.blurb}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      }"""

# --- styles.css ---------------------------------------------------------------
S_AFTER_GAP = """[data-passage='process'] .passage__item,
[data-passage='system'] .passage__item { gap: calc(40 * var(--u)); }"""
S_BEFORE_GAP = """[data-passage='process'] .passage__item { gap: calc(40 * var(--u)); }"""

S_AFTER_HAZE = "0.28 * clamp(0, calc((var(--alt, 0) - 0.46) / 0.1067), 1) +"
S_BEFORE_HAZE = "0.28 * clamp(0, calc((var(--alt, 0) - 0.46) / 0.36), 1) +"

EDITS = [
    ('content.ts', 'SystemNode.blurb', C_AFTER_TYPE, C_BEFORE_TYPE),
    ('content.ts', 'SYSTEM_HU', C_AFTER_TABLE, C_BEFORE_TABLE),
    ('FullAscent.tsx', 'PassageSystem body', F_AFTER_BODY, F_BEFORE_BODY),
    ('styles.css', 'system item gap', S_AFTER_GAP, S_BEFORE_GAP),
    ('styles.css', 'air__restraint clearing ramp', S_AFTER_HAZE, S_BEFORE_HAZE),
]


def revert():
    # EVERY EDIT IS CHECKED BEFORE ANY EDIT IS WRITTEN.
    #
    # It used to back up, then edit in a loop, and a stale pattern in the last
    # entry left the tree half reverted with a backup of the half. Worse, a
    # second attempt then backed the half-reverted tree up over the good one.
    # Both are gone: an existing backup is refused rather than overwritten, and
    # the whole edit list has to match before the first file is touched.
    if os.path.exists(BACKUP):
        raise SystemExit(f"! {BACKUP} already exists — run `before.py restore` first")
    read = {}
    for f, name, after, before in EDITS:
        s = read.setdefault(f, io.open(os.path.join(SRC, f), encoding='utf-8').read())
        if after not in s:
            raise SystemExit(f"! {f} :: {name} is not in its phase 5.1 state — refusing to guess")
    os.makedirs(BACKUP)
    for f in FILES:
        shutil.copy2(os.path.join(SRC, f), os.path.join(BACKUP, f))
    for f, name, after, before in EDITS:
        p = os.path.join(SRC, f)
        s = io.open(p, encoding='utf-8').read()
        io.open(p, 'w', encoding='utf-8').write(s.replace(after, before, 1))
        print(f"  revert: {f} :: {name}")


def restore():
    missing = [f for f in FILES if not os.path.exists(os.path.join(BACKUP, f))]
    if missing:
        raise SystemExit(f"! no backup for {missing} — nothing to restore")
    for f in FILES:
        shutil.copy2(os.path.join(BACKUP, f), os.path.join(SRC, f))
        print(f"  restore: {f}")


def check(fresh):
    """Compare a fresh band measurement of the reconstruction with the real one."""
    truth = json.load(io.open(os.path.join(HERE, 'field-p51-before-bands.json'), encoding='utf-8'))
    got = json.load(io.open(fresh, encoding='utf-8'))
    if len(truth) != len(got):
        raise SystemExit(f"! {len(got)} samples against {len(truth)} — not the same rig")
    worst, at = 0, None
    for a, b in zip(truth, got):
        if a['metres'] != b['metres']:
            print(f"  ! altitude differs at sample {a['i']}: {a['metres']} vs {b['metres']}")
        for band in ('top', 'mid', 'low'):
            d = max(abs(a[band][c] - b[band][c]) for c in range(3))
            if d > worst:
                worst, at = d, (a['screens'], band)
    print(f"worst band difference {worst} of 255, at {at}")
    # 3 is the noise floor: the sky carries an ordered dither of 1.6/255 and the
    # terrain and instrument render a shade differently run to run — measured at
    # 0.00-0.15 mean absolute difference between two runs of the same build.
    if worst > 3:
        raise SystemExit('! the reconstruction does not reproduce the pre-edit page — do not keep anything recorded from it')
    print('reconstruction verified against the pre-edit measurement.')


mode = sys.argv[1] if len(sys.argv) > 1 else 'check'
if mode == 'revert':
    revert()
elif mode == 'restore':
    restore()
elif mode == 'check':
    check(sys.argv[2])
else:
    raise SystemExit('usage: before.py [revert|restore|check <field-*-bands.json>]')
