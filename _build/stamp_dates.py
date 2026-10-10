#!/usr/bin/env python3
"""Write `published:` and `updated:` into each blog post's front matter, from git.

    python3 _build/stamp_dates.py          # stamp
    python3 _build/stamp_dates.py --check  # exit 1 if a stamp is missing or stale

published  the commit that added the fragment (its first appearance on the site)
updated    the last commit that changed the fragment's TEXT — the two stamp
           lines themselves are ignored, so re-stamping never counts as an
           update. A fragment with uncommitted text changes is stamped with
           the current time: run this right before committing an edit.

Why front matter and not `git log` at build time: Netlify may build from a
shallow clone, where every file's history is one commit and every post would
claim to have been written on deploy day. A date in the file is a date that
cannot drift. Real dates only — the build never invents one (see the note at
the head of the structured-data section in build.py).
"""
import datetime
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PAGES = ROOT / "_build" / "pages"
STAMP = re.compile(r"^(published|updated):.*\n", re.M)


def git(*args):
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True,
                          check=True).stdout


def text_changed_uncommitted(rel):
    diff = git("diff", "HEAD", "-U0", "--", rel)
    for line in diff.splitlines():
        if line.startswith(("+++", "---")) or not line.startswith(("+", "-")):
            continue
        if not re.match(r"^[+-](published|updated):", line):
            return True
    return False


def last_text_commit(rel):
    """Newest commit whose change to `rel` is more than the stamp lines."""
    for sha in git("log", "--format=%H", "--", rel).split():
        patch = git("show", "-U0", "--format=", sha, "--", rel)
        for line in patch.splitlines():
            if line.startswith(("+++", "---")) or not line.startswith(("+", "-")):
                continue
            if not re.match(r"^[+-](published|updated):", line):
                return git("show", "-s", "--format=%cI", sha).strip()
    return None


def stamp(path, check):
    rel = str(path.relative_to(ROOT))
    added = git("log", "--follow", "--diff-filter=A", "--format=%cI", "--", rel).split()
    if not added:
        return None                                  # never committed: no date to claim
    published = added[-1]
    if text_changed_uncommitted(rel):
        updated = datetime.datetime.now().astimezone().replace(microsecond=0).isoformat()
    else:
        updated = last_text_commit(rel) or published
    src = path.read_text(encoding="utf-8")
    head, sep, body = src.partition("\n---\n")
    have = dict(re.findall(r"^(published|updated):\s*(.*)$", head, re.M))
    if have.get("published") and have["published"] != published:
        published = have["published"]                # a deliberate earlier stamp wins
    if check:
        ok = have.get("published") == published and (
            have.get("updated", "")[:10] >= updated[:10])
        return None if ok else rel
    head = STAMP.sub("", head + "\n").rstrip("\n")
    head += f"\npublished: {published}\nupdated: {updated}"
    path.write_text(head + sep + body, encoding="utf-8")
    return rel


def main():
    check = "--check" in sys.argv
    out = [r for p in sorted(PAGES.glob("blog-*.html"))
           if not re.search(r" \d+\.html$", p.name) and (r := stamp(p, check))]
    if check and out:
        print("stale or missing post dates:", *out, sep="\n  ")
        sys.exit(1)
    if not check:
        print(f"stamped {len(out)} posts")


if __name__ == "__main__":
    main()
