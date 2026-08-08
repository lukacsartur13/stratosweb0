# Mountain camera and material — review package

Open `index.html`. It is the CURRENT vs NEW contact sheet with the measurements
under each pair, plus the material-debug / final-lighting comparison §19 asks
for.

The stills themselves are not committed: `.gitignore` excludes
`_build/reports/*-review/**`, which is the existing convention for every review
package in this repository (see `phase7-review/` and
`mobile-homepage-fidelity-review/`). 23 MB of PNGs does not belong in the
history.

## Regenerating

```
npm run dev:home                     # serves :5177
node experiments/.tmp-review.mjs     # writes new-*.png and the material pair
```

`baseline/current-*.png` are the committed build *before* this pass and cannot
be regenerated from the current tree — check out `8f41630` and run
`experiments/.tmp-frame.mjs` if they are ever needed again.

The measurements come from `experiments/valley-metrics.mjs` and
`experiments/terrain-mask.mjs`, which are the same modules
`npm run test:mountains` gates on, so a number in the contact sheet means the
same thing as a number in the suite.
