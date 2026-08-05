// Kliens oldali wizard, beküldés a POST /api/lead végpontra.
// Szegmentálás a 2. kérdésnél: kis-/középvállalkozás vs. nagyvállalat — a két ág
// teljesen külön kérdéssort kap, a cond() függvények kapcsolják a láthatóságot.
const ans = id => { const i = Q.findIndex(q=>q.id===id); return answers[i] || {}; };
const NAGY = 'Nagyvállalat / multinacionális cég';
const isNagy = () => ans('szegmens').value === NAGY;
const kkv = () => !isNagy();

const Q = [
  // ===== KÖZÖS: alapadatok =====
  {t:'text',    q:'Mi a vállalkozás neve?', req:1, min:2, id:'cegnev'},
  {t:'radio',   q:'Melyik jellemzi leginkább a vállalkozást?', req:1, id:'szegmens',
    o:['Egyéni vállalkozó / kisvállalkozás','Középvállalkozás',NAGY]},
  {t:'text',    q:'Ki tölti ki a kérdőívet? (név, pozíció)', min:2, id:'kitolto'},
  {t:'tel',     q:'Telefonszám:', req:1, id:'telefon'},
  {t:'email',   q:'Email cím:', req:1, id:'email'},

  // ===== KKV ÁG =====
  {t:'textarea',q:'Mivel foglalkozik a céged? (rövid bemutatás)', req:1, cond:kkv},
  {t:'text',    q:'Van jelenlegi weboldalatok? Ha igen, mi a címe?', id:'weboldal', cond:kkv},
  {t:'radio',   q:'Hogyan találtál ránk?', other:1, cond:kkv,
    o:['Google keresés','Facebook / Instagram','TikTok','Ismerős ajánlása']},
  {t:'check',   q:'Mi a weboldal célja? (Több is jelölhető)', req:1, other:1, cond:kkv,
    o:['Több ügyfél szerzése','Online értékesítés (webshop)','Időpontfoglalás','Márkaépítés']},
  {t:'radio',   q:'Kik a fő ügyfeleid?', req:1, cond:kkv,
    o:['Lakossági (B2C)','Céges (B2B)','Mindkettő']},
  {t:'radio',   q:'Egynyelvű vagy többnyelvű weboldalra van szükséged?', other:1, cond:kkv,
    hint:'Ha több nyelv kell, kérlek sorold fel őket az egyéb részben.',
    o:['Egynyelvű','Többnyelvű']},
  {t:'textarea',q:'Sorold fel a szolgáltatásaidat / termékeidet, és jelöld meg, melyik a legfontosabb!', req:1, cond:kkv,
    hint:'Ha vannak szezonális vagy akciós ajánlataid, azokat is írd ide.'},
  {t:'textarea',q:'Milyen menüpontokat / aloldalakat képzelsz el?', cond:kkv,
    hint:'Például: Főoldal, Szolgáltatások, Rólunk, Árak, Kapcsolat. Ha nincs elképzelésed, hagyd üresen — javaslunk mi.'},
  {t:'check',   q:'Milyen funkciók kellenek az oldalra?', req:1, other:1, id:'funkciok', cond:kkv,
    o:['Időpontfoglaló rendszer','Webshop','Kapcsolatfelvételi űrlap','Chat / Messenger / WhatsApp','Blog','Hírlevél feliratkozás','Automatikus ajánlatkérés','CRM','Fizetési rendszer','Hirdetéskövetés (Meta Pixel, Google Ads)']},
  {t:'textarea',q:'Webshop részletek: kb. hány termékkel indulnátok, kell-e szállítási integráció (pl. Foxpost, GLS), és van-e preferált fizetési szolgáltató (pl. SimplePay, Barion, Stripe)?',
    cond:()=> kkv() && (ans('funkciok').value||[]).includes('Webshop')},
  {t:'radio',   q:'Van kész logód / arculatod?', req:1, cond:kkv,
    o:['Van logó és teljes arculat (színek, betűtípusok, brandbook)','Csak logó van','Nincs, arculattervezésre is szükség van']},
  {t:'radio',   q:'Van saját domain és tárhely?', other:1, cond:kkv,
    hint:'A domain a weboldal címe (pl. cegnev.hu). Ha tudod, az egyéb mezőbe írd be, kinél van regisztrálva.',
    o:['Van, és hozzáférek','Van, de nem én kezelem','Nincs még']},
  {t:'radio',   q:'Ki adja a tartalmat (szövegek, képek)?', req:1, cond:kkv,
    o:['Mindent mi adunk','Részben megvan, kell segítség','Teljes szövegírást és képanyagot kérünk']},
  {t:'radio',   q:'Szeretnéd később saját kezűleg szerkeszteni az oldalt?', cond:kkv,
    o:['Igen, kell szerkeszthetőség és betanítás','Nem, a módosításokat rátok bíznám','Még nem tudom']},
  {t:'textarea',q:'Hosszabb leírás a vállalkozásról a szövegezéshez', cond:kkv,
    hint:'Opcionális — ha van meglévő bemutatkozó anyagod (weboldal, Facebook-oldal, prospektus), elég belinkelned.'},
  {t:'radio',   q:'Milyen stílus tetszik leginkább?', req:1, other:1, cond:kkv,
    o:['Letisztult, minimal','Modern, dinamikus','Prémium, elegáns','Kreatív, merész']},
  {t:'radio',   q:'Formavilág:', req:1, cond:kkv,
    o:['Lekerekített elemek (rounded, barátságos)','Éles, kocka-szerű, strukturált elemek (komolyabb, tech jelleg)','Vegyes']},
  {t:'radio',   q:'Színek:', req:1, other:1, cond:kkv,
    hint:'Ha van konkrét színpaletta, az egyéb mezőbe várjuk a színkódokat! (pl: ABCD25)',
    o:['Világos (fehér, bézs, pasztell)','Sötét (fekete, sötétszürke, deep tones)','Márka színek dominanciája']},
  {t:'radio',   q:'Mennyire legyen látványos az oldal?', req:1, cond:kkv,
    o:['Letisztult és gyors — a funkció a lényeg','Modern, finom animációkkal','Látványos „wow” élmény, scroll-animációkkal']},
  {t:'textarea',q:'Van olyan weboldal, ami tetszik? És olyan, ami kifejezetten nem? (linkek)', cond:kkv,
    hint:'A negatív példa legalább annyit segít, mint a pozitív.'},
  {t:'textarea',q:'Kik a fő versenytársaid, és miben vagy más, mint ők?', cond:kkv},
  {t:'radio',   q:'Futtattok jelenleg hirdetéseket?', req:1, other:1, cond:kkv,
    hint:'Ha igen, kérlek a platformot részletezd az egyéb mezőben.',
    o:['Igen','Nem']},
  {t:'text',    q:'Közösségi média oldalaitok linkjei:', cond:kkv,
    hint:'Facebook, Instagram, TikTok, LinkedIn — ami van.'},
  {t:'radio',   q:'Mikorra kell elkészülnie a weboldalnak?', req:1, other:1, id:'hatarido', cond:kkv,
    o:['1 héten belül','1 hónapon belül','Pár hónapon belül']},
  {t:'radio',   q:'Milyen fizetési konstrukció lenne megfelelő?', req:1, id:'konstrukcio', cond:kkv,
    o:['Egyszeri díj','Havi díjas konstrukció','Mindkettő érdekel, kérek ajánlatot']},
  {t:'radio',   q:'Van tervezett költségkeret?', req:1, other:1, id:'koltsegkeret',
    cond:()=> kkv() && ans('konstrukcio').value !== 'Havi díjas konstrukció',
    o:['150 000 Ft – 300 000 Ft','300 000 Ft – 500 000 Ft','500 000 Ft – 1 000 000 Ft','Még nincs, ajánlat alapján döntök']},
  {t:'radio',   q:'Milyen havi díjkeretben gondolkodsz?', req:1, other:1, id:'havidij',
    cond:()=> kkv() && ['Havi díjas konstrukció','Mindkettő érdekel, kérek ajánlatot'].includes(ans('konstrukcio').value),
    o:['20 000 Ft – 40 000 Ft / hó','40 000 Ft – 70 000 Ft / hó','70 000 Ft felett / hó']},

  // ===== NAGYVÁLLALATI ÁG =====
  {t:'textarea',q:'Mivel foglalkozik a cég, és melyik részleg kezeli ezt a projektet?', req:1, cond:isNagy,
    hint:'Például: marketing, IT, beszerzés, ügyvezetés.'},
  {t:'radio',   q:'Mi a projekt tárgya?', req:1, other:1, cond:isNagy,
    o:['Új vállalati weboldal','Meglévő weboldal újratervezése','E-commerce platform','Belső portál / webalkalmazás','Kampány landing page-ek']},
  {t:'text',    q:'Jelenlegi weboldal(ak) címe:', id:'weboldal_nagy', cond:isNagy},
  {t:'textarea',q:'Mi a projekt üzleti célja, és milyen mérőszámok alapján lesz sikeres?', req:1, cond:isNagy,
    hint:'Például: lead-generálás növelése, nemzetközi piacra lépés, munkáltatói márka erősítése, konverziós ráta.'},
  {t:'check',   q:'Milyen rendszerekkel kell integrálni?', other:1, cond:isNagy,
    o:['CRM (pl. Salesforce, HubSpot)','ERP (pl. SAP)','Marketing automatizáció / hírlevél','SSO / címtár (pl. Azure AD)','Egyedi belső rendszer / API','Analitika / BI','Nincs integrációs igény']},
  {t:'radio',   q:'Van belső IT / fejlesztői csapat, akivel együtt dolgoznánk?', req:1, cond:isNagy,
    o:['Igen, van belső csapat','Nincs, teljes kivitelezést kérünk','Külső partner kezeli a rendszereinket']},
  {t:'radio',   q:'Rendelkezésre áll arculati kézikönyv (brand guidelines)?', req:1, cond:isNagy,
    o:['Igen, teljes körű','Részben (logó, alapszínek)','Nincs, arculati munkát is kérünk']},
  {t:'text',    q:'Hány nyelven és mely piacokon kell megjelennie az oldalnak?', req:1, cond:isNagy},
  {t:'check',   q:'Vannak megfelelőségi vagy biztonsági követelmények?', other:1, cond:isNagy,
    o:['GDPR / adatkezelési előírások','Akadálymentesítés (WCAG)','Adattárolás helye (EU szerver)','Belső biztonsági audit / ISO','Még egyeztetés alatt']},
  {t:'radio',   q:'Ki szállítja a tartalmat (szövegek, képek, videók)?', req:1, cond:isNagy,
    o:['A marketingosztályunk','Részben, kell külső támogatás','Teljes tartalomgyártást kérünk']},
  {t:'textarea',q:'Hogyan zajlik a beszerzési és döntési folyamat?', req:1, cond:isNagy,
    hint:'Például: tender / több ajánlat bekérése, jóváhagyási körök száma, kik a döntéshozók, van-e ajánlattételi határidő.'},
  {t:'radio',   q:'Szükséges titoktartási megállapodás (NDA) az egyeztetésekhez?', cond:isNagy,
    o:['Igen','Nem','Később derül ki']},
  {t:'radio',   q:'Mi a projekt időkerete?', req:1, other:1, id:'hatarido_nagy', cond:isNagy,
    o:['1 hónapon belül','Negyedéven belül','Fél éven belül']},
  {t:'radio',   q:'Mekkora a tervezett költségkeret?', req:1, other:1, id:'koltsegkeret_nagy', cond:isNagy,
    o:['1 – 3 millió Ft','3 – 10 millió Ft','10 millió Ft felett','Belső jóváhagyás alatt']},
  {t:'textarea',q:'Design elvárások, referenciák (linkek):', cond:isNagy,
    hint:'Versenytársak vagy más vállalati oldalak, amik iránymutatóak — akár pozitív, akár negatív példaként.'},

  // ===== KÖZÖS: zárás =====
  {t:'radio',   q:'Szeretnél ingyenes konzultációt igényelni?', id:'konzultacio',
    o:['Igen','Nincs rá szükségem']},
  {t:'radio',   q:'Hogyan egyeztessünk?', other:1,
    hint:'Az egyéb mezőbe írhatod, mikor vagy leginkább elérhető.',
    o:['Telefonon','Google Meet / videóhívás','Személyesen'],
    cond:()=> ans('konzultacio').value === 'Igen'},
  {t:'textarea',q:'Van bármi, amit fontosnak tartasz még hozzátenni?'},
  {t:'consent', q:'Adatkezelési Nyilatkozat', req:1,
    o:['Az űrlap leadásával kijelentem, hogy elolvastam és elfogadom az Adatkezelési Nyilatkozatban foglaltakat és annak feltételeit.']},
];

const answers = {};
let step = -1; // -1 = intro
const app = document.getElementById('app');
const bar = document.getElementById('bar');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const visibleIdx = () => Q.map((d,i)=>i).filter(i=>!Q[i].cond || Q[i].cond());
const nextVisible = (from,dir) => {
  const vis = visibleIdx();
  return dir>0 ? vis.find(i=>i>from) : [...vis].reverse().find(i=>i<from);
};

// a magasságmérő a kérdőív haladását követi, nem a görgetést
const setAltitude = p => window.Stratos && window.Stratos.setProgress(p);

function render(){
  window.scrollTo(0,0);
  if(step === -1) return renderIntro();
  if(step === Q.length) return renderDone();
  const d = Q[step];
  const vis = visibleIdx();
  const pos = vis.indexOf(step);
  bar.style.width = (pos/vis.length*100)+'%';
  setAltitude(pos/vis.length);

  let f = '';
  const saved = answers[step] || {};
  if(['text','tel','email'].includes(d.t)){
    f = `<input type="${d.t==='text'?'text':d.t}" id="inp" placeholder="Ide írd a választ…" value="${esc(saved.value||'')}">`;
  } else if(d.t === 'textarea'){
    f = `<textarea id="inp" placeholder="Ide írd a választ…">${esc(saved.value||'')}</textarea>`;
  } else if(d.t === 'radio'){
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt radio${saved.value===o?' selected':''}"><input type="radio" name="r" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt radio${saved.value==='Egyéb'?' selected':''}"><input type="radio" name="r" value="Egyéb"><span class="box"></span>Egyéb</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${saved.value==='Egyéb'?' show':''}"><input type="text" id="other" placeholder="Egyéb…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'check'){
    const sel = saved.value || [];
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt${sel.includes(o)?' selected':''}"><input type="checkbox" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt${sel.includes('Egyéb')?' selected':''}"><input type="checkbox" value="Egyéb"><span class="box"></span>Egyéb</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${sel.includes('Egyéb')?' show':''}"><input type="text" id="other" placeholder="Egyéb…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'consent'){
    f = `<div class="opts"><label class="opt"><input type="checkbox" id="inp"${saved.value?' checked':''}><span class="box"></span>${esc(d.o[0])}</label></div>
         <p class="quiz__hint" style="margin-top:1rem">Adatkezelési Nyilatkozat: <a href="adatkezelesi-tajekoztato.html" target="_blank" rel="noopener">adatkezelesi-tajekoztato</a></p>`;
  }

  const isLast = nextVisible(step,1) === undefined;
  app.innerHTML = `<div class="quiz__step">
    <div class="quiz__num">${String(pos+1).padStart(2,'0')}<span class="quiz__total"> / ${String(vis.length).padStart(2,'0')}</span></div>
    <h1 class="quiz__q">${esc(d.q)}${d.req?' <span class="quiz__req">*</span>':''}</h1>
    ${d.hint?`<p class="quiz__hint">${esc(d.hint)}</p>`:''}
    <div class="quiz__fields">${f}</div>
    <div class="quiz__err" id="err">Ez a kérdés kötelező.</div>
    <div class="quiz__nav">
      ${pos>0?'<button class="ghost" id="prev">Vissza</button>':''}
      <button id="next">${isLast?'Beküldés':'Tovább'}</button>
      <span class="quiz__enter">ENTER ↵</span>
    </div>
  </div>`;

  if(d.t === 'consent'){
    const cb = document.getElementById('inp');
    cb.closest('.opt').classList.toggle('selected', cb.checked);
  }

  app.querySelectorAll('.opt input').forEach(inp=>{
    inp.addEventListener('change',()=>{
      if(inp.type==='radio') app.querySelectorAll('.opt').forEach(l=>l.classList.remove('selected'));
      inp.closest('.opt').classList.toggle('selected', inp.checked);
      const oi = app.querySelector('.other-input');
      if(oi){
        const otherOn = [...app.querySelectorAll('.opt input')].some(i=>i.checked && i.value==='Egyéb');
        oi.classList.toggle('show', otherOn);
        if(otherOn) oi.querySelector('input').focus();
      }
    });
  });

  const prev = document.getElementById('prev');
  if(prev) prev.onclick = ()=>{ save(true); step = nextVisible(step,-1); render(); };
  document.getElementById('next').onclick = next;
  const first = app.querySelector('input[type=text],input[type=tel],input[type=email],textarea');
  if(first && d.t!=='consent') first.focus();
}

// A két hibaüzenet külön konstans, mert a fordítás statikus szövegeket cserél:
// egy sablonliterálba írt üzenet magyar maradna az angol és a német oldalon.
const ERR_REQUIRED = 'Ez a kérdés kötelező.';
const ERR_SHORT = 'Legalább két karakter kell.';

/** null, ha a válasz rendben van; különben a megjelenítendő hibaüzenet. */
function save(skipValidate){
  const d = Q[step];
  if(['text','tel','email','textarea'].includes(d.t)){
    answers[step] = {value: document.getElementById('inp').value.trim()};
  } else if(d.t==='radio'){
    const c = app.querySelector('.opt input:checked');
    answers[step] = {value: c?c.value:'', other: d.other?(document.getElementById('other')?.value.trim()||''):''};
  } else if(d.t==='check'){
    answers[step] = {value: [...app.querySelectorAll('.opt input:checked')].map(i=>i.value),
                     other: d.other?(document.getElementById('other')?.value.trim()||''):''};
  } else if(d.t==='consent'){
    answers[step] = {value: document.getElementById('inp').checked};
  }
  if(skipValidate) return null;
  const a = answers[step] || {};
  // Egy túl rövid válasz akkor is hiba, ha a kérdés nem kötelező: a beküldés
  // ezt a mezőt használja, és a végén elutasítaná — ott viszont már 30 kérdés
  // múlva, egy olyan üzenettel, ami nem ehhez a képernyőhöz tartozik.
  // `min` csak szöveges kérdésen van, így a jelölőnégyzetek tömbjével nem
  // találkozik. Típusvizsgálat helyett azért így, mert a fordító a JS
  // string-literálokat is szövegnek látja, és egy lefordított 'string' szó
  // csendben elrontaná az összehasonlítást az angol és a német oldalon.
  if(d.min && a.value && a.value.length < d.min) return ERR_SHORT;
  if(!d.req) return null;
  if(d.t==='check') return a.value.length>0 ? null : ERR_REQUIRED;
  if(d.t==='consent') return a.value===true ? null : ERR_REQUIRED;
  if(d.t==='email') return /.+@.+\..+/.test(a.value) ? null : ERR_REQUIRED;
  return a.value ? null : ERR_REQUIRED;
}

function next(){
  const problem = save();
  if(problem){
    const err = document.getElementById('err');
    err.textContent = problem;
    err.classList.add('show');
    return;
  }
  const n = nextVisible(step,1);
  step = (n===undefined) ? Q.length : n;
  render();
}

function renderIntro(){
  bar.style.width='0';
  setAltitude(0);
  app.innerHTML = `<div class="quiz__step quiz__intro">
    <div class="quiz__num">Stratos · Igényfelmérő</div>
    <h1>Weboldal<br>igényfelmérő<br>kérdőív</h1>
    <p>Minden kérdés külön oldalon jelenik meg. A csillaggal (<span class="quiz__req">*</span>) jelölt kérdések kötelezőek.</p>
    <p>A kitöltés alapján pár órán belül keresni fogunk a további információkkal és a személyre szabott árajánlattal.</p>
    <p>Becsült kitöltési idő: 8 perc.</p>
    <div class="quiz__nav"><button id="start">Kezdés</button><span class="quiz__enter">ENTER ↵</span></div>
  </div>`;
  document.getElementById('start').onclick = ()=>{ step = visibleIdx()[0]; render(); };
}

// --------------------------------------------------------------- beküldés
// A kérdőív ugyanazt a közös beküldő vezérlőt használja, mint minden más
// űrlap: assets/js/lead.js építi a borítékot, küldi az egyetlen kérést és
// dönti el, mit jelent a válasz. Itt már csak a válaszok összeállítása marad.
//
// A borítékba nem szöveges átirat kerül, hanem szerkezet: a `fields.answers`
// tömb minden látható kérdést kérdés/válasz párként visz át. Az átiratot a
// szerver írja belőle (lásd LEAD_MAPPERS.questionnaire), így a `message` mező
// tartalma egy helyen dől el, nem háromszor, nyelvenként egyszer.
const STARTED = Date.now();

/** Egy azonosított kérdés válasza szövegként. */
const val = id => { const a = ans(id); return Array.isArray(a.value) ? a.value.join(', ') : (a.value || ''); };

/** Minden látható kérdés, kérdés/válasz párként, a kitöltés sorrendjében. */
function collectAnswers(){
  const out = [];
  Q.forEach((d,i)=>{
    if(d.cond && !d.cond()) return;
    const a = answers[i] || {};
    let v = Array.isArray(a.value) ? a.value.join(', ') : (a.value ?? '');
    if(d.t==='consent') v = a.value ? 'Elfogadva' : 'Nem fogadta el';
    if(a.other) v += (v?' | ':'') + 'Egyéb: ' + a.other;
    out.push({ q: d.q, a: String(v || '—') });
  });
  return out;
}

/** A séma által ismert mezők. Amit nem sorolunk fel, azt a szerver eldobja. */
function collectFields(){
  return {
    cegnev: val('cegnev'),
    kitolto: val('kitolto'),
    email: val('email'),
    telefon: val('telefon'),
    weboldal: val('weboldal'),
    weboldal_nagy: val('weboldal_nagy'),
    szegmens: val('szegmens'),
    // A `szegmens` válaszszövege nyelvenként más; ez a nyelvfüggetlen ág.
    agazat: isNagy() ? 'nagyvallalat' : 'kkv',
    koltsegkeret: val('koltsegkeret'),
    koltsegkeret_nagy: val('koltsegkeret_nagy'),
    havidij: val('havidij'),
    hatarido: val('hatarido'),
    hatarido_nagy: val('hatarido_nagy'),
    konstrukcio: val('konstrukcio'),
    konzultacio: val('konzultacio'),
    funkciok: val('funkciok'),
    answers: collectAnswers(),
  };
}

const DONE_HTML = {
  submitting: () => `<div class="quiz__step quiz__done" data-state="submitting">
      <h1 class="quiz__q">Küldés folyamatban…</h1>
    </div>`,
  success: () => `<div class="quiz__step quiz__done" data-state="success">
      <div class="quiz__mark">✓</div>
      <h1 class="quiz__q">Köszönjük a kitöltést!</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Válaszaidat rögzítettük, hamarosan felvesszük veled a kapcsolatot.</p>
      <div class="quiz__nav" style="justify-content:center"><a class="btn" href="index.html"><span>Vissza a főoldalra</span></a></div>
    </div>`,
  invalid: msg => `<div class="quiz__step quiz__done" data-state="invalid">
      <h1 class="quiz__q">Hiányzik valami.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">${esc(msg)}</p>
      <div class="quiz__nav" style="justify-content:center"><button id="fix">Vissza a kérdésekhez</button></div>
    </div>`,
  limited: () => `<div class="quiz__step quiz__done" data-state="limited">
      <h1 class="quiz__q">Túl sok beküldés egymás után.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Kérlek, várj egy percet, aztán próbáld újra.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Újrapróbálás</button></div>
    </div>`,
  error: () => `<div class="quiz__step quiz__done" data-state="error">
      <h1 class="quiz__q">Hiba történt a küldés során.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Kérlek próbáld újra, vagy írj a
        <a href="mailto:lukacs.artur@media-stratos.com">lukacs.artur@media-stratos.com</a> címre.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Újrapróbálás</button></div>
    </div>`,
};

function finish(state, msg){
  app.innerHTML = DONE_HTML[state](msg);
  const retry = document.getElementById('retry');
  if(retry) retry.onclick = renderDone;
  const fix = document.getElementById('fix');
  if(fix) fix.onclick = ()=>{ step = visibleIdx()[0]; render(); };
}

// Egy beküldési kísérletsorozat azonosítója. Újrapróbálásnál ugyanaz marad, így
// a szerver felismeri, hogy ez nem egy második érdeklődés — sikeres beküldés
// után viszont nincs mit újraküldeni, mert a képernyő már nem ad rá gombot.
let submissionId = window.Stratos.lead.uuid();
let attempt = 0;
let sending = false;

async function renderDone(){
  // Kettős kattintás: a hibaképernyők „Újrapróbálás" gombja elvben újra
  // meghívhatná ezt, miközben az előző kérés még fut.
  if(sending) return;
  sending = true;

  bar.style.width='100%';
  setAltitude(1);
  finish('submitting');

  const fields = collectFields();
  const hp = document.getElementById('hp-quiz');

  // Ugyanaz az ellenőrzés, mint a szerveren — csak itt hamarabb megmondjuk.
  const name = fields.kitolto.length >= 2 ? fields.kitolto : fields.cegnev;
  if(name.length < 2){
    sending = false;
    finish('invalid', 'Kérjük, add meg a vállalkozás vagy a kapcsolattartó nevét.');
    return;
  }
  const problem = window.Stratos.lead.validate('questionnaire', fields);
  if(problem){ sending = false; finish('invalid', problem); return; }

  attempt += 1;
  const result = await window.Stratos.lead.send({
    submissionId,
    formType: 'questionnaire',
    fields,
    botField: hp ? hp.value : '',
    elapsedMs: Date.now() - STARTED,
    attempt,
  });
  sending = false;

  if(result.state === 'success'){ finish('success'); return; }
  if(result.state === 'limited'){ finish('limited'); return; }
  if(result.state === 'invalid'){ finish('invalid', result.message); return; }
  finish('error');
}

document.addEventListener('keydown',e=>{
  if(e.key!=='Enter' || e.shiftKey) return;
  if(e.target.tagName==='TEXTAREA') return;
  if(e.target.closest('a, button')) return; // a fókuszált link/gomb natívan működjön
  e.preventDefault();
  if(step===-1) document.getElementById('start')?.click();
  else if(step<Q.length) document.getElementById('next')?.click();
});

render();
