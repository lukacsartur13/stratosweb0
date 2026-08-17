# Failure stability matrix

5 runs of the same commit, same machine, same configuration.

| Run | Collected | Passed | Failed | Skipped | Duration |
| --- | --- | --- | --- | --- | --- |
| 1 | 1305 | 1176 | 7 | 122 | 9.7 min |
| 2 | 1305 | 1178 | 5 | 122 | 9.0 min |
| 3 | 1305 | 1177 | 6 | 122 | 9.3 min |
| 4 | 1305 | 1178 | 5 | 122 | 9.0 min |
| 5 | 1305 | 1176 | 7 | 122 | 9.1 min |

**Stable failures (failed in every run): 1**
**Wandering failures (failed in some runs, passed in others): 11**

| Test | Run 1 | Run 2 | Run 3 | Run 4 | Run 5 | Failures | Timeouts | Classification |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[desktop-1920]` homepage-chrome.spec.ts:422 — opens from every header state | TIMEOUT | TIMEOUT | FAIL | FAIL | FAIL | 5/5 | 2 | **STABLE FAILURE** |
| `[desktop-1920]` homepage-chrome.spec.ts:470 — focus is trapped inside the layer while it is open | TIMEOUT | TIMEOUT | TIMEOUT | PASS | TIMEOUT | 4/5 | 4 | **WANDERING** |
| `[desktop-1440]` homepage-chrome.spec.ts:422 — opens from every header state | PASS | FAIL | TIMEOUT | PASS | FAIL | 3/5 | 1 | **WANDERING** |
| `[reduced-motion]` homepage-chrome.spec.ts:470 — focus is trapped inside the layer while it is open | TIMEOUT | TIMEOUT | TIMEOUT | PASS | PASS | 3/5 | 3 | **WANDERING** |
| `[desktop-1920]` homepage-modality.spec.ts:220 — keyboard focus stays in the layer, Escape closes it, and the page comes back | TIMEOUT | TIMEOUT | PASS | PASS | TIMEOUT | 3/5 | 3 | **WANDERING** |
| `[desktop-1440]` homepage-chrome.spec.ts:470 — focus is trapped inside the layer while it is open | PASS | PASS | TIMEOUT | PASS | TIMEOUT | 2/5 | 2 | **WANDERING** |
| `[desktop-1920]` homepage-chrome.spec.ts:558 — opening the menu does not walk the journey back down the mountain | PASS | PASS | TIMEOUT | PASS | FAIL | 2/5 | 1 | **WANDERING** |
| `[desktop-1920]` homepage-history.spec.ts:223 — back and forward restore the position, the chapter and the chrome | FAIL | PASS | PASS | FAIL | PASS | 2/5 | 0 | **WANDERING** |
| `[mobile-390]` mobile-homepage-simple.spec.ts:170 — the renderer is not requested at all when there is no WebGL | FAIL | PASS | PASS | FAIL | PASS | 2/5 | 0 | **WANDERING** |
| `[mobile-430]` mobile-homepage-simple.spec.ts:170 — the renderer is not requested at all when there is no WebGL | FAIL | PASS | PASS | FAIL | PASS | 2/5 | 0 | **WANDERING** |
| `[desktop-1440]` homepage-chrome.spec.ts:259 — the journey state compacts the wordmark and keeps the header short | PASS | PASS | PASS | PASS | FAIL | 1/5 | 0 | **WANDERING** |
| `[desktop-webkit]` homepage-modality.spec.ts:220 — keyboard focus stays in the layer, Escape closes it, and the page comes back | PASS | PASS | PASS | FAIL | PASS | 1/5 | 0 | **WANDERING** |
