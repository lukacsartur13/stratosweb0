/**
 * WAIT FOR THE REAL FACES, AND PROVE THEY ARRIVED.
 *
 * `await document.fonts.ready` is not sufficient and this study has the scar
 * to show for it. The three families are declared `font-display:block`, and a
 * page that has not yet laid out any text in them never requests them — so
 * `fonts.ready` resolves against a document where Archivo is still `unloaded`,
 * every measurement is taken against the system fallback, and nothing
 * anywhere reports a problem. The first scale solve of Direction D was
 * computed entirely on macOS system-ui: it under-measured `Innen már látni`
 * by 7%, which put the Hungarian high-altitude monument 33px outside the
 * frame, and the only reason it was caught is that shoot-d.mjs re-measures
 * the frames instead of trusting the numbers it was handed.
 *
 * So: request the faces explicitly, for the actual codepoints in use — the
 * Hungarian double acutes live in latin-ext, which is a separate face from
 * latin and loads separately — then wait, then ASSERT. A measurement pass
 * that silently fell back is worse than one that crashes.
 */
export async function fontsReady(page) {
  await page.evaluate(async () => {
    const PROBE = {
      'Archivo':        'Magasságot építünk Innen már látni a görbületet ÁÉÍÓÖŐÚÜŰ Krümmung Höhe Bereiche',
      'Aboreto':        'STRATOS',
      'JetBrains Mono': '0123456789 m–.,',
    };
    await Promise.all(Object.entries(PROBE).map(([f, t]) => document.fonts.load(`400 200px "${f}"`, t)));
    await document.fonts.ready;
    const missing = Object.entries(PROBE).filter(([f, t]) => !document.fonts.check(`400 200px "${f}"`, t));
    if (missing.length) throw new Error(`these faces did not load, so every measurement would be taken against a fallback: ${missing.map(m => m[0]).join(', ')}`);
  });
  await page.waitForTimeout(200);
}
