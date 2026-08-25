import { chromium } from '@playwright/test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fontsReady } from './fonts-ready.mjs';
const here = fileURLToPath(new URL('.', import.meta.url));
const b = await chromium.launch({ args: ['--allow-file-access-from-files'] });
const p = await b.newPage({ viewport: { width: 1700, height: 1200 }, deviceScaleFactor: 2 });
await p.goto(pathToFileURL(`${here}storyboard.html`).href, { waitUntil: 'networkidle' });
await fontsReady(p);
/* The storyboard is shot in colour: the background progression is the thing
   it exists to prove. */
await p.evaluate(() => document.body.classList.add('color'));
await p.waitForTimeout(500);
await p.locator('#storyboard').screenshot({ path: `${here}six-act/six-act-storyboard.png` });
console.log('shot six-act-storyboard.png');
await b.close();
