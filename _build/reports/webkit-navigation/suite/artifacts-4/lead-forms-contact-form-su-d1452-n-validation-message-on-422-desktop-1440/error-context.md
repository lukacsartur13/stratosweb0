# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: lead-forms.spec.ts >> contact form >> surfaces the server's own validation message on 422
- Location: tests/lead-forms.spec.ts:177:3

# Error details

```
Error: expect(locator).toHaveAttribute(expected) failed

Locator:  locator('.form__status')
Expected: "invalid"
Received: ""
Timeout:  15000ms

Call log:
  - Expect "toHaveAttribute" with timeout 15000ms
  - waiting for locator('.form__status')
    31 × locator resolved to <p role="status" aria-live="polite" class="form__status"></p>
       - unexpected value "null"

```

```yaml
- link "Ugrás a tartalomra":
  - /url: "#main"
- banner:
  - link "Stratos — főoldal":
    - /url: /
    - text: Stratos
  - link "Projekt indítása":
    - /url: arajanlat.html
  - button "Menü"
- main:
  - paragraph:
    - link "Stratos":
      - /url: index.html
    - text: / Kapcsolat
  - heading "Kezdjük ott, hogy elmondod." [level=1]
  - paragraph: "Nincs két egyforma projekt, ezért nincs két egyforma ajánlat sem. Az első lépés mindig ugyanaz: megértjük, mit csinál a vállalkozásod, és mit vársz az online jelenlétedtől."
  - paragraph: Válasz jellemzően egy munkanapon belül. A konzultáció díjmentes. Ajánlatot az igényfelmérés után adunk — előre meghirdetett csomagáraink nincsenek.
  - paragraph: Válaszidő 1 munkanap Konzultáció díjmentes, online Ajánlat egyedi, felmérés után
  - paragraph: Kikkel dolgozunk
  - paragraph: Akkor működik jól, ha a weboldalnak üzleti feladata van.
  - paragraph: "Egyéni vállalkozókkal, kis- és középvállalkozásokkal és nagyobb cégek marketingcsapataival dolgozunk együtt. A közös pont nem a méret, hanem az, hogy a weboldal vagy a hirdetés valamit el kell hogy érjen: megkeresést, foglalást, rendelést, jelentkezőt."
  - paragraph: Ha nem tudod, mi a reális cél, az nem akadály. A konzultáció nagyobb részt erről szól, mint a technológiáról.
  - list:
    - listitem: Új weboldal, vagy meglévő oldal megújítása.
    - listitem: Arculat, szövegezés és keresőoptimalizálás a weboldal mellé.
    - listitem: Google és Meta hirdetések kezelése.
    - listitem: "Nonprofit szervezetek: az Impact Program külön útvonalon fut."
  - paragraph: Két út ugyanoda
  - heading "Válaszd azt, amennyi időd most van." [level=2]
  - paragraph: Mindkettő ugyanahhoz a beszélgetéshez vezet. A különbség csak annyi, hogy mennyit tudunk előre a projektedről, amikor először beszélünk.
  - text: Rövid megkeresés
  - heading "Van egy kérdésem" [level=3]
  - paragraph: Néhány mező, pár mondat arról, mire lenne szükséged. Ez elég ahhoz, hogy visszaírjunk és időpontot egyeztessünk.
  - text: 6 mező · körülbelül 2 perc
  - link "Írok egy üzenetet":
    - /url: "#uzenet"
  - text: Részletes igényfelmérő
  - heading "Kezdjük a projektet" [level=3]
  - paragraph: "Végigkérdezzük, amit egy ajánlathoz tudnunk kell: a szegmenst, a funkciókat, a határidőt és a költségkeretet. Így az első hívás már a megoldásról szól, nem az adatfelvételről."
  - text: Kérdésenként egy képernyő · körülbelül 8 perc
  - link "Kitöltöm az igényfelmérőt":
    - /url: arajanlat.html
  - paragraph: Utána
  - heading "Mi történik, miután elküldted?" [level=2]
  - paragraph: Nincs automata értékesítési sorozat és nincs hívogatás. Négy lépés, amiből az elsőt már megtetted.
  - article:
    - heading "Visszaigazolás" [level=3]
    - paragraph: Az űrlap azonnal jelzi, ha megérkezett. E-mailben jellemzően egy munkanapon belül válaszolunk a megadott címre.
  - article:
    - heading "Díjmentes konzultáció" [level=3]
    - paragraph: Online beszélgetés, jellemzően 30–45 perc. Átnézzük, mit csinál most az oldalad, mit szeretnél elérni, és mi az, ami ehhez tényleg kell.
  - article:
    - heading "Egyedi ajánlat" [level=3]
    - paragraph: "A beszélgetés után írásos ajánlatot küldünk: mit építünk, milyen ütemezésben, és mibe kerül. Az ár a feladat összetettségétől függ, nem egy előre kitalált csomagtól."
  - article:
    - heading "Döntés" [level=3]
    - paragraph: Az ajánlat nem jár kötelezettséggel. Ha nem a megfelelő pillanat, azt is megmondjuk — ez olcsóbb mindkettőnknek, mint egy rossz projekt.
  - paragraph: Rövid megkeresés
  - heading "Írj pár mondatot" [level=2]
  - paragraph: Nem kell pontos briefet írnod. Az is elég, ha leírod, mit csinál a vállalkozásod és mi az, ami most nem működik.
  - paragraph: Az adataidat kizárólag a megkeresés megválaszolására használjuk. Részletek az adatkezelési tájékoztatóban.
  - text: Vezetéknév *
  - textbox "Vezetéknév *": Kovács
  - text: Keresztnév *
  - textbox "Keresztnév *": János
  - text: E-mail *
  - textbox "E-mail *": janos@example.com
  - text: Telefonszám *
  - textbox "Telefonszám *": +36 30 000 0000
  - text: Vállalkozás neve *
  - textbox "Vállalkozás neve *": Példa Kft.
  - text: Megjegyzés *
  - textbox "Megjegyzés *":
    - /placeholder: Mire lenne szükséged?
    - text: Szeretnék árajánlatot kérni egy új weboldalra.
  - checkbox "A továbblépéssel kijelentem, hogy elfogadtam az Adatvédelmi nyilatkozatban foglaltakat és annak feltételeit. *" [checked]
  - text: A továbblépéssel kijelentem, hogy elfogadtam az
  - link "Adatvédelmi nyilatkozatban":
    - /url: adatkezelesi-tajekoztato.html
  - text: foglaltakat és annak feltételeit. *
  - checkbox "Hozzájárulok, hogy a Stratos Media e-mailben értesítsen az újdonságokról és frissítésekről."
  - text: Hozzájárulok, hogy a Stratos Media e-mailben értesítsen az újdonságokról és frissítésekről.
  - button "Küldés"
  - paragraph: A *-gal jelölt mezők kitöltése kötelező.
  - paragraph: Közvetlenül
  - heading "Ha inkább beszélnél." [level=2]
  - paragraph: Az űrlap csak egy lehetőség. Ugyanezekre a válaszokra jutunk e-mailben vagy telefonon is.
  - text: E-mail
  - link "lukacs.artur@media-stratos.com":
    - /url: mailto:lukacs.artur@media-stratos.com
  - text: — írásban a legegyszerűbb, és marad nyoma. Válasz jellemzően egy munkanapon belül. Telefon
  - link "+36 30 584 8024":
    - /url: tel:+36305848024
  - text: — ha gyorsan kell egy válasz, hívj minket munkaidőben. Hol dolgozunk Győr és Budapest, de országszerte és külföldre is dolgozunk. Az egyeztetések nagy része online zajlik, így nem a földrajz dönt. Nyelvek Magyar, angol és német nyelven is tudunk projektet vinni és kommunikálni.
  - heading "Mielőtt írnál" [level=2]
  - paragraph: Ha még nézelődsz, ezek segítenek eldönteni, mit érdemes kérned.
  - navigation "Kapcsolódó oldalak":
    - link "Szolgáltatások Mit csinálunk, és melyik szolgáltatás melyik üzleti problémára válasz. Áttekintés":
      - /url: szolgaltatasok.html
    - link "Munkáink Élő oldalak, amiket építettünk — hogy lásd, mire számíthatsz. Referenciák":
      - /url: munkaink.html
    - link "Rólunk Kik vagyunk, hogyan dolgozunk, és mit jelent nálunk a projektalapú együttműködés. Bemutatkozás":
      - /url: rolunk.html
    - link "Impact Program Nonprofit szervezeteknek szóló külön útvonal, saját jelentkezési folyamattal. Program":
      - /url: impact-program.html
- paragraph: Hova vigyük innen a vállalkozásodat?
- heading "A következő szint innen indul." [level=2]
- paragraph:
  - link "Projekt indítása":
    - /url: arajanlat.html
  - link "Kiemelt munkáink":
    - /url: munkaink.html
- contentinfo:
  - link "Stratos":
    - /url: /
  - paragraph: A hírlevelünk még készül. Add meg a címed, és szólunk, amint elindul.
  - text: E-mail cím
  - textbox "E-mail cím":
    - /placeholder: e-mail cím
  - button "Szóljatok"
  - status
  - heading "Linkek" [level=4]
  - list:
    - listitem:
      - link "Rólunk":
        - /url: rolunk.html
    - listitem:
      - link "Munkáink":
        - /url: munkaink.html
    - listitem:
      - link "Kapcsolat":
        - /url: ugyfelszolgalat.html
    - listitem:
      - link "Blog":
        - /url: blog.html
    - listitem:
      - link "Árajánlat":
        - /url: arajanlat.html
  - heading "Szolgáltatások" [level=4]
  - list:
    - listitem:
      - link "Minden szolgáltatás":
        - /url: szolgaltatasok.html
    - listitem:
      - link "Webdesign KKV-nak":
        - /url: kkv.html
    - listitem:
      - link "Webdesign nagyvállalatoknak":
        - /url: nagyvallalat.html
    - listitem:
      - link "Branding":
        - /url: branding.html
    - listitem:
      - link "Hirdetéskezelés":
        - /url: hirdeteskezeles.html
    - listitem:
      - link "Impact Program":
        - /url: impact-program.html
  - heading "Kapcsolat" [level=4]
  - list:
    - listitem:
      - link "lukacs.artur@media-stratos.com":
        - /url: mailto:lukacs.artur@media-stratos.com
    - listitem:
      - link "+36 30 584 8024":
        - /url: tel:+36305848024
  - heading "Közösség" [level=4]
  - list:
    - listitem:
      - link "LinkedIn":
        - /url: https://www.linkedin.com/company/stratos-media-agency
    - listitem:
      - link "Instagram":
        - /url: https://www.instagram.com/stratosweb/
    - listitem:
      - link "Facebook":
        - /url: https://www.facebook.com/profile.php?id=61590329356257
  - heading "Állapot" [level=4]
  - list:
    - listitem: Válasz jellemzően pár órán belül
    - listitem: Győr és Budapest
    - listitem: Magyarul, angolul és németül dolgozunk
  - text: © 2026 Stratos Media Agency — Minden jog fenntartva.
  - link "Adatkezelési tájékoztató":
    - /url: adatkezelesi-tajekoztato.html
  - link "Impresszum":
    - /url: impresszum.html
  - group "Nyelvválasztás":
    - link "HU":
      - /url: ugyfelszolgalat.html
    - link "EN":
      - /url: en/contact.html
    - link "DE":
      - /url: de/kontakt.html
  - button "VISSZA 0 MÉTERRE"
  - img "GDPR Ready"
```

# Test source

```ts
  90  | }
  91  | 
  92  | /** The live region the form reports into. One per page that has a real form. */
  93  | const status = (page: Page) => page.locator('.form__status');
  94  | 
  95  | test.describe('contact form', () => {
  96  |   test.beforeEach(async ({ page }) => {
  97  |     await page.goto('/ugyfelszolgalat.html');
  98  |   });
  99  | 
  100 |   test('a valid submission reaches /api/lead with every field mapped', async ({ page }) => {
  101 |     const sent = await interceptLead(page);
  102 |     await fillContact(page);
  103 |     await page.getByRole('button', { name: 'Küldés' }).click();
  104 | 
  105 |     await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
  106 |     expect(sent).toHaveLength(1);
  107 | 
  108 |     const envelope = sent[0];
  109 |     expectWellFormed(envelope, 'contact', '/ugyfelszolgalat.html');
  110 | 
  111 |     // Field names travel as they are in the markup. Mapping them to lead
  112 |     // columns is the server's job and is asserted in lead-endpoint.spec.ts —
  113 |     // the page's job is to send every answer, under the name the schema knows.
  114 |     expect(envelope.fields).toMatchObject({
  115 |       vezeteknev: 'Kovács',
  116 |       keresztnev: 'János',
  117 |       email: 'janos@example.com',
  118 |       telefon: '+36 30 000 0000',
  119 |       ceg: 'Példa Kft.',
  120 |       megjegyzes: 'Szeretnék árajánlatot kérni egy új weboldalra.',
  121 |       adatvedelem_elfogadva: 'Igen',
  122 |     });
  123 |     // An unchecked optional consent posts nothing at all, which the server's
  124 |     // `consent` rule reads as "not given".
  125 |     expect(envelope.fields.hirlevel).toBeUndefined();
  126 |     expect(envelope.meta.botField).toBe('');
  127 |   });
  128 | 
  129 |   test('shows the success state and clears the form', async ({ page }) => {
  130 |     await interceptLead(page);
  131 |     await fillContact(page);
  132 |     await page.getByRole('button', { name: 'Küldés' }).click();
  133 | 
  134 |     await expect(status(page)).toHaveText(/Köszönjük/, { timeout: 15_000 });
  135 |     await expect(page.locator('#em')).toHaveValue('');
  136 |     // The button stays out of action: it went through, and a second press
  137 |     // would only produce a duplicate.
  138 |     await expect(page.getByRole('button', { name: /Elküldve/ })).toBeDisabled();
  139 |   });
  140 | 
  141 |   test('shows a submitting state while the request is in flight', async ({ page }) => {
  142 |     await interceptLead(page, { delayMs: 1500 });
  143 |     await fillContact(page);
  144 |     await page.getByRole('button', { name: 'Küldés' }).click();
  145 | 
  146 |     await expect(status(page)).toHaveAttribute('data-state', 'submitting', { timeout: 15_000 });
  147 |     await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
  148 |   });
  149 | 
  150 |   test('shows the rate-limited state on 429 and lets the visitor retry', async ({ page }) => {
  151 |     await interceptLead(page, {
  152 |       status: 429,
  153 |       body: { ok: false, code: 'RATE_LIMITED', message: 'Túl sok beküldés egymás után. Kérlek, várj egy percet.' },
  154 |     });
  155 |     await fillContact(page);
  156 |     await page.getByRole('button', { name: 'Küldés' }).click();
  157 | 
  158 |     await expect(status(page)).toHaveAttribute('data-state', 'limited', { timeout: 15_000 });
  159 |     await expect(status(page)).toHaveText(/várj egy percet/i);
  160 |     await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  161 |   });
  162 | 
  163 |   test('shows a generic server-error state on 500', async ({ page }) => {
  164 |     await interceptLead(page, {
  165 |       status: 500,
  166 |       body: { ok: false, code: 'STORE_FAILED', message: 'We could not save that.' },
  167 |     });
  168 |     await fillContact(page);
  169 |     await page.getByRole('button', { name: 'Küldés' }).click();
  170 | 
  171 |     await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
  172 |     // Nothing internal leaks into the page.
  173 |     await expect(status(page)).not.toHaveText(/postgres|supabase|constraint/i);
  174 |     await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  175 |   });
  176 | 
  177 |   test("surfaces the server's own validation message on 422", async ({ page }) => {
  178 |     await interceptLead(page, {
  179 |       status: 422,
  180 |       body: {
  181 |         ok: false,
  182 |         code: 'VALIDATION_FAILED',
  183 |         message: 'Please check the highlighted fields.',
  184 |         errors: { email: 'That email address does not look right.' },
  185 |       },
  186 |     });
  187 |     await fillContact(page);
  188 |     await page.getByRole('button', { name: 'Küldés' }).click();
  189 | 
> 190 |     await expect(status(page)).toHaveAttribute('data-state', 'invalid', { timeout: 15_000 });
      |                                ^ Error: expect(locator).toHaveAttribute(expected) failed
  191 |     await expect(status(page)).toHaveText(/does not look right/i);
  192 |   });
  193 | 
  194 |   test('rejects a malformed address in the page, before the network', async ({ page }) => {
  195 |     const sent = await interceptLead(page);
  196 |     await fillContact(page);
  197 |     await page.fill('#em', 'not-an-address');
  198 | 
  199 |     // Submitted the way a script would, which is also the only way past the
  200 |     // browser's own constraint validation — so this asserts our layer, not it.
  201 |     await page.evaluate(() => {
  202 |       document.querySelector('form[data-lead="contact"]')!
  203 |         .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  204 |     });
  205 | 
  206 |     await expect(status(page)).toHaveAttribute('data-state', 'invalid');
  207 |     await page.waitForTimeout(4000);
  208 |     expect(sent, 'an invalid address must never reach the endpoint').toHaveLength(0);
  209 |   });
  210 | 
  211 |   test('rejects a submission with no name at all', async ({ page }) => {
  212 |     const sent = await interceptLead(page);
  213 |     await fillContact(page);
  214 |     await page.fill('#vez', '');
  215 |     await page.fill('#ker', '');
  216 | 
  217 |     await page.evaluate(() => {
  218 |       document.querySelector('form[data-lead="contact"]')!
  219 |         .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  220 |     });
  221 | 
  222 |     await expect(status(page)).toHaveText(/add meg a nevedet/i);
  223 |     await page.waitForTimeout(4000);
  224 |     expect(sent).toHaveLength(0);
  225 |   });
  226 | 
  227 |   test('an empty form never reaches the network', async ({ page }) => {
  228 |     const sent = await interceptLead(page);
  229 |     await page.getByRole('button', { name: 'Küldés' }).click();
  230 |     await page.waitForTimeout(4000);
  231 |     expect(sent).toHaveLength(0);
  232 |   });
  233 | 
  234 |   test('carries a filled honeypot through untouched, for the server to drop', async ({ page }) => {
  235 |     const sent = await interceptLead(page);
  236 |     await fillContact(page);
  237 |     await page.fill('#hp-contact', 'https://spam.example');
  238 |     await page.getByRole('button', { name: 'Küldés' }).click();
  239 | 
  240 |     await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 15_000 });
  241 |     // The page must not decide this locally — the endpoint answers a filled
  242 |     // honeypot with a success no bot can tell from the real thing.
  243 |     expect(sent[0].meta.botField).toBe('https://spam.example');
  244 |     expect(sent[0].fields).not.toHaveProperty('company_website');
  245 |   });
  246 | 
  247 |   test('a double click produces exactly one request', async ({ page }) => {
  248 |     // A slow reply keeps the first request in flight while the second click
  249 |     // lands — which is the only arrangement in which the guard can be wrong.
  250 |     const sent = await interceptLead(page, { delayMs: 2500 });
  251 |     await fillContact(page);
  252 | 
  253 |     const button = page.getByRole('button', { name: 'Küldés' });
  254 |     await button.click();
  255 |     await button.click({ force: true, noWaitAfter: true }).catch(() => {});
  256 | 
  257 |     await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
  258 |     expect(sent, 'a second click must not create a second lead').toHaveLength(1);
  259 |   });
  260 | 
  261 |   test('Enter in a text field cannot slip a second request past the disabled button', async ({ page }) => {
  262 |     const sent = await interceptLead(page, { delayMs: 2500 });
  263 |     await fillContact(page);
  264 |     await page.getByRole('button', { name: 'Küldés' }).click();
  265 | 
  266 |     // A disabled submit button does not stop an implicit submit from a text
  267 |     // input, so the guard has to be on the form, not on the button.
  268 |     await page.evaluate(() => {
  269 |       document.querySelector('form[data-lead="contact"]')!
  270 |         .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  271 |     });
  272 | 
  273 |     await expect(status(page)).toHaveAttribute('data-state', 'success', { timeout: 20_000 });
  274 |     expect(sent).toHaveLength(1);
  275 |   });
  276 | 
  277 |   test('a network failure shows the failure state and keeps everything typed', async ({ page }) => {
  278 |     await page.route('**/api/lead', (route) => route.abort('failed'));
  279 |     await fillContact(page);
  280 |     await page.getByRole('button', { name: 'Küldés' }).click();
  281 | 
  282 |     await expect(status(page)).toHaveAttribute('data-state', 'error', { timeout: 15_000 });
  283 |     // Nothing the visitor typed may be lost by a failure they did not cause.
  284 |     await expect(page.locator('#em')).toHaveValue('janos@example.com');
  285 |     await expect(page.locator('#mj')).toHaveValue('Szeretnék árajánlatot kérni egy új weboldalra.');
  286 |     await expect(page.getByRole('button', { name: 'Küldés' })).toBeEnabled();
  287 |   });
  288 | 
  289 |   test('a retry after a failure re-sends the same submission id', async ({ page }) => {
  290 |     let fail = true;
```