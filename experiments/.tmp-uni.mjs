import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('PAGEERROR', e.message));
page.on('console', m => console.log('[' + m.type() + ']', m.text().slice(0, 300)));
await page.goto('http://localhost:5177/home/hu.html', { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!globalThis.__stratos?.scene, { timeout: 30000 });
await page.waitForTimeout(6000);
console.log(JSON.stringify(await page.evaluate(() => {
  const s = globalThis.__stratos;
  const out = [];
  s.scene.traverse(o => {
    if (!o.userData?.mountainRoot) return;
    const seen = new Set();
    o.traverse(c => {
      if (!c.isMesh) return;
      const m = c.material;
      if (seen.has(m.uuid)) return;
      seen.add(m.uuid);
      const u = m.uniforms;
      out.push({
        type: m.type, node: c.name,
        level: u?.uLevel?.value?.toArray?.(),
        baseNear: u?.uBaseNear?.value?.getHexString?.(),
        fogColor: u?.uFogColor?.value?.getHexString?.(),
        keyInt: u?.uKeyIntensity?.value,
        opacity: u?.uOpacity?.value,
        depthSpan: u?.uDepthSpan?.value?.toArray?.(),
        crest: [u?.uCrestFrom?.value, u?.uCrestTo?.value, u?.uCrestGain?.value],
        fillInt: u?.uFillIntensity?.value,
        floor: u?.uFloor?.value?.toArray?.(),
      });
    });
  });
  return out;
}), null, 1));
await browser.close();
