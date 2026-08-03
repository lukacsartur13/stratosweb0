// =============================================================================
// How many lights does each build's shader actually compile for?
//
// The first version of this probe looked for `#define NUM_DIR_LIGHTS (\d+)` and
// found nothing in either build. That was reported as "the probe is broken"
// rather than as a light count, and correctly so: the regex cannot match.
// three.js never emits that define. `replaceLightNums` in WebGLProgram.js
// substitutes the token *textually* everywhere it appears —
//
//     .replace( /NUM_DIR_LIGHTS/g, parameters.numDirLights )
//
// — so `#if NUM_DIR_LIGHTS > 0` reaches the driver as `#if 3 > 0` and no
// `#define` for it survives anywhere in the source.
//
// The count does survive in the declaration it sized, which is what this reads:
//
//     uniform DirectionalLight directionalLights[ 3 ];
//
// That line exists exactly when the count is greater than zero, which is the
// condition being tested, and it is read off the string the driver was handed
// rather than off three.js's own bookkeeping.
// =============================================================================
import { chromium } from '@playwright/test';

const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:4324';
const ROUTES = [
  ['current', '/experiments/stratos-ascent-full/'],
  ['baseline', '/experiments/stratos-ascent-full-baseline/'],
];

const browser = await chromium.launch({ headless: false });

for (const [label, path] of ROUTES) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__shaders = [];
    const patch = (proto) => {
      if (!proto) return;
      const original = proto.shaderSource;
      proto.shaderSource = function (shader, source) {
        window.__shaders.push(source);
        return original.call(this, shader, source);
      };
    };
    patch(window.WebGLRenderingContext && window.WebGLRenderingContext.prototype);
    patch(window.WebGL2RenderingContext && window.WebGL2RenderingContext.prototype);
  });
  await page.goto(ORIGIN + path, { waitUntil: 'load' });
  await page.waitForSelector('canvas');
  await page.waitForTimeout(6000);

  const out = await page.evaluate(() => {
    const read = (re, s) => {
      const m = re.exec(s);
      return m ? Number(m[1]) : null;
    };
    const tally = {};
    let lit = 0;
    // The negative case is counted rather than dropped: a shader with no light
    // arrays at all is an unlit material, not a shader the probe failed to read.
    let unlit = 0;
    for (const s of window.__shaders) {
      const dir = read(/uniform\s+DirectionalLight\s+directionalLights\[\s*(\d+)\s*\]/, s);
      const point = read(/uniform\s+PointLight\s+pointLights\[\s*(\d+)\s*\]/, s);
      const spot = read(/uniform\s+SpotLight\s+spotLights\[\s*(\d+)\s*\]/, s);
      const hemi = read(/uniform\s+HemisphereLight\s+hemisphereLights\[\s*(\d+)\s*\]/, s);
      if (dir === null && point === null && spot === null && hemi === null) {
        unlit++;
        continue;
      }
      lit++;
      const key = `dir=${dir ?? 0} point=${point ?? 0} spot=${spot ?? 0} hemi=${hemi ?? 0}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    return { totalShaders: window.__shaders.length, lit, unlit, tally };
  });

  console.log(
    `${label.padEnd(9)} shaders ${String(out.totalShaders).padStart(4)} · lit ${String(out.lit).padStart(3)} · unlit ${String(out.unlit).padStart(3)} · ${JSON.stringify(out.tally)}`,
  );
  await context.close();
}

await browser.close();
