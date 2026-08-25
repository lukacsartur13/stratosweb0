#!/bin/sh
# Stage the instrument studios into a scratch tree of their own — NOT into
# `dist/`.
#
# THIS USED TO WRITE INTO `dist/_studio/` AND `dist/_studio-lux/`, AND THAT IS
# THE DEFECT §30 OF THE TEMPORAL PHASE ASKS TO REMOVE.
#
# `dist/` is the artefact Netlify publishes, and it is also the tree the route,
# SEO and conversion audits crawl to decide what the public site contains. A
# review page staged inside it is therefore indistinguishable, to those three
# gates, from a page we shipped: `/_studio-lux/index.html` was reported as a
# public route with no canonical, no description, no h1 and no skip link, and
# the only way to get a green `npm test` was to delete the scratch by hand
# first. A gate that requires manual housekeeping before it tells the truth is
# not a gate, and worse, the habit of parking files to get green is exactly how
# a genuine public-route failure gets parked with them.
#
# So the scratch lives at `_studio/` in the repo root, is gitignored, and is
# served as its own document root on its own port. Nothing about the review
# pages changes except the two paths in their import map, which are rewritten
# here rather than in the sources so the sources stay readable as documents.
#
#   sh _build/reports/luxury-art-direction/stage-studio.sh
#   python3 -m http.server 4327 --directory _studio
#   node _build/reports/luxury-art-direction/render-instrument.mjs
#   node _build/reports/luxury-art-direction/render-lux.mjs
set -e
root=$(cd "$(dirname "$0")/../../.." && pwd)
cd "$root"
src=_build/reports/luxury-art-direction

rm -rf _studio
mkdir -p _studio/three/examples/jsm/loaders _studio/three/examples/jsm/utils _studio/models _studio/lux

# The import map's two absolute paths assumed the pages were mounted at
# `/_studio/` under the site root. They are now the document root themselves.
sed 's|/_studio/three/|/three/|g' "$src/studio.html"     > _studio/index.html
sed 's|/_studio/three/|/three/|g' "$src/studio-lux.html" > _studio/lux/index.html

cp experiments/node_modules/three/build/three.module.js _studio/three/
cp experiments/node_modules/three/build/three.core.js   _studio/three/
cp experiments/node_modules/three/examples/jsm/loaders/GLTFLoader.js       _studio/three/examples/jsm/loaders/
cp experiments/node_modules/three/examples/jsm/utils/BufferGeometryUtils.js _studio/three/examples/jsm/utils/

# Both pages load `/models/stratos-altimeter.glb`. That path used to resolve
# against dist/; it now resolves inside the scratch tree, so the model is
# copied from the SOURCE it is authored in rather than from a build output.
cp public/models/stratos-altimeter.glb _studio/models/

echo "staged _studio/ (serve: python3 -m http.server 4327 --directory _studio)"
