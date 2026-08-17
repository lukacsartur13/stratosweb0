# Failure stability matrix

5 runs of the same commit, same machine, same configuration.

| Run | Collected | Passed | Failed | Skipped | Duration |
| --- | --- | --- | --- | --- | --- |
| 1 | 1271 | 1148 | 1 | 122 | 4.1 min |
| 2 | 1271 | 1149 | 0 | 122 | 4.2 min |
| 3 | 1271 | 1149 | 0 | 122 | 4.3 min |
| 4 | 1271 | 1147 | 2 | 122 | 4.7 min |
| 5 | 1271 | 1146 | 3 | 122 | 4.6 min |

**Stable failures (failed in every run): 0**
**Wandering failures (failed in some runs, passed in others): 5**

| Test | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Failures | Timeouts | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[mobile-390]` public-site.spec.ts:264 — /kkv.html responds and has a title and description | TIMEOUT | PASS | PASS | PASS | TIMEOUT | 2/5 | 2 | **WANDERING** |
| `[desktop-1440]` homepage-chrome.spec.ts:966 — navigating away and back leaves nothing behind | PASS | PASS | PASS | PASS | FAIL | 1/5 | 0 | **WANDERING** |
| `[desktop-webkit]` homepage-history.spec.ts:223 — back and forward restore the position, the chapter and the chrome | PASS | PASS | PASS | FAIL | PASS | 1/5 | 0 | **WANDERING** |
| `[mobile-390]` public-site.spec.ts:240 — the en homepage is its own entry point with its own links | PASS | PASS | PASS | TIMEOUT | PASS | 1/5 | 1 | **WANDERING** |
| `[mobile-390]` public-site.spec.ts:281 — the three languages are cross-linked with hreflang | PASS | PASS | PASS | PASS | TIMEOUT | 1/5 | 1 | **WANDERING** |
