// Kliens oldali wizard, beküldés a POST /api/lead végpontra.
// Szegmentálás a 2. kérdésnél: kis-/középvállalkozás vs. ipari/B2B és nagyvállalat — a két ág
// teljesen külön kérdéssort kap, a cond() függvények kapcsolják a láthatóságot.
const ans = id => { const i = Q.findIndex(q=>q.id===id); return answers[i] || {}; };
const NAGY = 'Industrie-/B2B-Unternehmen oder Großunternehmen';
const isNagy = () => ans('szegmens').value === NAGY;
const kkv = () => !isNagy();

const Q = [
  // ===== KÖZÖS: alapadatok =====
  // 2026-10-23 (copy pack): what the visitor wants comes first, 3D and
  // keresőoptimalizálás included. Not a contract field — it travels in the
  // answers transcript, which is the lead's message.
  {t:'check',   q:'Wobei können wir helfen? (Mehrfachauswahl möglich)', req:1, id:'szolgaltatas',
    o:['Eine neue Website oder die Erneuerung der bestehenden','3D-Website oder Produktkonfigurator','Onlineshop','SEO','Werbebetreuung','Corporate Design und Logo']},
  {t:'text',    q:'Wie heißt Ihr Unternehmen?', req:1, min:2, id:'cegnev'},
  {t:'radio',   q:'Was beschreibt Ihr Unternehmen am besten?', req:1, id:'szegmens',
    o:['Einzelunternehmen / Kleinbetrieb','Mittelständisches Unternehmen',NAGY]},
  {t:'text',    q:'Wer füllt den Fragebogen aus? (Name, Position)', min:2, id:'kitolto'},
  {t:'tel',     q:'Telefonnummer', req:1, id:'telefon'},
  {t:'email',   q:'E-Mail-Adresse', req:1, id:'email'},

  // ===== KKV ÁG =====
  {t:'textarea',q:'Womit beschäftigt sich Ihr Unternehmen? (kurz)', req:1, cond:kkv},
  {t:'text',    q:'Haben Sie derzeit eine Website? Wenn ja, wie lautet die Adresse?', id:'weboldal', cond:kkv},
  {t:'radio',   q:'Wie haben Sie uns gefunden?', other:1, cond:kkv,
    o:['Google-Suche','Facebook / Instagram','TikTok','Empfehlung aus dem Bekanntenkreis']},
  {t:'check',   q:'Was ist das Ziel der Website? (Mehrfachauswahl)', req:1, other:1, cond:kkv,
    o:['Mehr Kunden','Online verkaufen (Shop)','Terminbuchung','Markenaufbau']},
  {t:'radio',   q:'Wer sind Ihre Hauptkunden?', req:1, cond:kkv,
    o:['Privatpersonen','Unternehmen','Beides']},
  {t:'radio',   q:'Brauchen Sie eine ein- oder mehrsprachige Website?', other:1, cond:kkv,
    hint:'Wenn Sie mehrere Sprachen brauchen, listen Sie sie im Feld „Sonstiges“ auf.',
    o:['Einsprachig','Mehrsprachig']},
  {t:'textarea',q:'Listen Sie Ihre Leistungen oder Produkte auf und markieren Sie, was am wichtigsten ist.', req:1, cond:kkv,
    hint:'Wenn Sie saisonale oder Aktionsangebote haben, schreiben Sie sie ebenfalls hierher.'},
  {t:'textarea',q:'Welche Menüpunkte und Unterseiten stellen Sie sich vor?', cond:kkv,
    hint:'Zum Beispiel: Start, Leistungen, Über uns, Preise, Kontakt. Wenn Sie noch keine Vorstellung haben, lassen Sie es leer, wir schlagen etwas vor.'},
  {t:'check',   q:'Welche Funktionen braucht die Seite?', req:1, other:1, id:'funkciok', cond:kkv,
    o:['Terminbuchung','Onlineshop','Kontaktformular','Chat / Messenger / WhatsApp','Blog','Newsletter-Anmeldung','Formular für Angebotsanfragen','Online-Zahlung','3D-Produktpräsentation oder Konfigurator','Werbe-Tracking (Meta Pixel, Google Ads)']},
  {t:'textarea',q:'Details zum Onlineshop: Mit wie vielen Produkten würden Sie etwa starten, brauchen Sie eine Versandanbindung (z. B. Foxpost, GLS), und haben Sie einen bevorzugten Zahlungsanbieter (z. B. SimplePay, Barion, Stripe)?',
    cond:()=> kkv() && (ans('funkciok').value||[]).includes('Onlineshop')},
  {t:'radio',   q:'Haben Sie bereits ein Logo und ein Corporate Design?', req:1, cond:kkv,
    o:['Logo und vollständiges Corporate Design (Farben, Schriften, Styleguide)','Nur ein Logo','Nein, ich brauche auch ein Corporate Design']},
  {t:'radio',   q:'Haben Sie eine eigene Domain und eigenes Hosting?', other:1, cond:kkv,
    hint:'Die Domain ist die Adresse der Website (z. B. firmenname.hu). Wenn Sie wissen, wo sie registriert ist, tragen Sie das im Feld „Sonstiges“ ein.',
    o:['Ja, und ich habe Zugriff','Ja, aber ich verwalte sie nicht','Noch nicht']},
  {t:'radio',   q:'Wer liefert die Inhalte (Texte, Bilder)?', req:1, cond:kkv,
    o:['Wir liefern alles','Teilweise vorhanden, wir brauchen Hilfe','Wir wünschen vollständige Texterstellung und Bildmaterial']},
  {t:'radio',   q:'Möchten Sie die Seite später selbst bearbeiten?', cond:kkv,
    o:['Ja, ich möchte sie selbst bearbeiten','Nein, die Änderungen würde ich Ihnen überlassen','Weiß ich noch nicht']},
  {t:'textarea',q:'Eine ausführlichere Beschreibung Ihres Unternehmens für die Texterstellung', cond:kkv,
    hint:'Optional. Wenn Sie bereits Vorstellungsmaterial haben (Website, Facebook-Seite, Broschüre), reicht ein Link.'},
  {t:'radio',   q:'Welcher Stil gefällt Ihnen am besten?', req:1, other:1, cond:kkv,
    o:['Klar, minimalistisch','Modern, dynamisch','Hochwertig, elegant','Kreativ, mutig']},
  {t:'radio',   q:'Formensprache', req:1, cond:kkv,
    o:['Abgerundete, freundliche Elemente','Kantige, strukturierte Elemente (seriöser, technischer Charakter)','Gemischt']},
  {t:'radio',   q:'Farben', req:1, other:1, cond:kkv,
    hint:'Wenn Sie eine konkrete Farbpalette haben, tragen Sie die Farbcodes im Feld „Sonstiges“ ein (z. B. ABCD25).',
    o:['Hell (Weiß, Beige, Pastell)','Dunkel (Schwarz, Anthrazit, tiefe Töne)','Markenfarben dominieren']},
  {t:'radio',   q:'Wie auffällig soll die Seite sein?', req:1, cond:kkv,
    o:['Klar und schnell, die Funktion zählt','Modern, mit dezenten Animationen','Ein eindrucksvolles Erlebnis mit Scroll-Animationen, auch mit 3D']},
  {t:'textarea',q:'Gibt es eine Website, die Ihnen gefällt? Und eine, die Ihnen gar nicht gefällt? (Links)', cond:kkv,
    hint:'Ein Negativbeispiel hilft mindestens so viel wie ein Positivbeispiel.'},
  {t:'textarea',q:'Wer sind Ihre Hauptwettbewerber, und worin unterscheiden Sie sich?', cond:kkv},
  {t:'radio',   q:'Schalten Sie derzeit Werbung?', req:1, other:1, cond:kkv,
    hint:'Falls ja, nennen Sie die Plattform im Feld „Sonstiges“.',
    o:['Ja','Nein']},
  {t:'text',    q:'Links zu Ihren Social-Media-Seiten', cond:kkv,
    hint:'Facebook, Instagram, TikTok, LinkedIn, was vorhanden ist.'},
  {t:'radio',   q:'Bis wann soll die Website fertig sein?', req:1, other:1, id:'hatarido', cond:kkv,
    o:['Innerhalb einer Woche','Innerhalb eines Monats','Innerhalb einiger Monate']},
  // The monthly model is withdrawn (owner, 2026-10-07): projects are quoted
  // as a one-off fee, so there is no payment-model question any more.
  // The forint bands are the visitor's budget, not Stratos prices. Whether they
  // stay is an open point in the 2026-10-23 copy pack; until it is decided the
  // bands are unchanged.
  {t:'radio',   q:'Haben Sie ein geplantes Budget?', req:1, other:1, id:'koltsegkeret',
    cond:kkv,
    o:['300.000 – 800.000 HUF','800.000 – 1.500.000 HUF','1.500.000 – 3.000.000 HUF','3.000.000 – 5.000.000 HUF','Noch nicht, ich entscheide nach dem Angebot']},

  // ===== IPARI / B2B ÉS NAGYVÁLLALATI ÁG =====
  // (A rendszerintegrációs kérdés 2026-10-23-án kikerült: egyedi üzleti
  // rendszereket nem kommunikálunk.)
  {t:'textarea',q:'Womit beschäftigt sich das Unternehmen, und welche Abteilung betreut dieses Projekt?', req:1, cond:isNagy,
    hint:'Zum Beispiel Marketing, IT, Einkauf, Geschäftsführung.'},
  {t:'radio',   q:'Worum geht es im Projekt?', req:1, other:1, cond:isNagy,
    o:['Neue Unternehmenswebsite','Redesign einer bestehenden Website','3D-Produktpräsentation oder Konfigurator','Onlineshop','Kampagnen-Landingpages']},
  {t:'text',    q:'Adresse der aktuellen Website(s)', id:'weboldal_nagy', cond:isNagy},
  {t:'textarea',q:'Was ist das Geschäftsziel des Projekts, und woran werden Sie erkennen, dass es erfolgreich ist?', req:1, cond:isNagy,
    hint:'Zum Beispiel mehr Angebotsanfragen, Eintritt in internationale Märkte, eine stärkere Arbeitgebermarke, mehr Besucher, die zu Interessenten werden.'},
  {t:'radio',   q:'Haben Sie ein internes IT- oder Entwicklungsteam, mit dem wir zusammenarbeiten würden?', req:1, cond:isNagy,
    o:['Ja, es gibt ein internes Team','Nein, wir wünschen die vollständige Umsetzung','Ein externer Partner betreut unsere Systeme']},
  {t:'radio',   q:'Haben Sie ein Corporate-Design-Handbuch?', req:1, cond:isNagy,
    o:['Ja, vollständig','Teilweise (Logo, Grundfarben)','Nein, wir wünschen auch ein Corporate Design']},
  {t:'text',    q:'In wie vielen Sprachen und auf welchen Märkten soll die Seite erscheinen?', req:1, cond:isNagy},
  {t:'check',   q:'Gibt es Compliance- oder Sicherheitsanforderungen?', other:1, cond:isNagy,
    o:['DSGVO, Datenschutzvorgaben','Barrierefreiheit (WCAG)','Datenspeicherort (EU-Server)','Internes Sicherheitsaudit oder ISO','Noch in Abstimmung']},
  {t:'radio',   q:'Wer liefert die Inhalte (Texte, Bilder, Videos)?', req:1, cond:isNagy,
    o:['Unsere Marketingabteilung','Teilweise, wir brauchen externe Unterstützung','Wir wünschen die vollständige Content-Produktion']},
  {t:'textarea',q:'Wie laufen Beschaffung und Entscheidung bei Ihnen ab?', req:1, cond:isNagy,
    hint:'Zum Beispiel Ausschreibung oder mehrere Angebote, Anzahl der Freigaberunden, wer entscheidet, ob es eine Abgabefrist gibt.'},
  {t:'radio',   q:'Brauchen Sie für die Gespräche eine Geheimhaltungsvereinbarung (NDA)?', cond:isNagy,
    o:['Ja','Nein','Klärt sich später']},
  {t:'radio',   q:'Wie ist der Zeitrahmen des Projekts?', req:1, other:1, id:'hatarido_nagy', cond:isNagy,
    o:['Innerhalb eines Monats','Innerhalb eines Quartals','Innerhalb eines halben Jahres']},
  {t:'radio',   q:'Wie hoch ist das geplante Budget?', req:1, other:1, id:'koltsegkeret_nagy', cond:isNagy,
    o:['2.500 € – 8.000 €','8.000 € – 25.000 €','Über 25.000 €','In interner Freigabe']},
  {t:'textarea',q:'Design-Erwartungen, Referenzseiten (Links)', cond:isNagy,
    hint:'Wettbewerber oder andere Unternehmensseiten, als positives oder negatives Beispiel.'},

  // ===== KÖZÖS: zárás =====
  {t:'radio',   q:'Möchten Sie ein kostenloses Erstgespräch?', id:'konzultacio',
    o:['Ja','Ich brauche keine']},
  {t:'radio',   q:'Wie sollen wir das kostenlose Erstgespräch führen?', other:1,
    hint:'Im Feld „Sonstiges“ können Sie angeben, wann es Ihnen am besten passt.',
    o:['Telefonisch','Über Google Meet, per Videocall','Persönlich, wenn das Projekt es erfordert (wir kommen zu Ihnen)'],
    cond:()=> ans('konzultacio').value === 'Ja'},
  {t:'textarea',q:'Gibt es noch etwas, das Sie für wichtig halten?'},
  {t:'consent', q:'Datenschutzerklärung', req:1,
    o:['Ich habe die Datenschutzerklärung gelesen und akzeptiere sie.']},
];

const answers = {};
let step = -1; // -1 = intro
const app = document.getElementById('app');
const bar = document.getElementById('bar');
const pathEl = document.getElementById('path');
// The stations are rebuilt only when the number of them changes. A conditional
// question appearing or disappearing changes `total`; moving between questions
// does not, and rewriting the DOM on every step would throw away the CSS
// transition that makes a station light up.
let pathTotal = -1;
function drawPath(pos, total){
  if(!pathEl) return;
  if(total !== pathTotal){
    pathTotal = total;
    pathEl.innerHTML = Array.from({length: total}, () => '<i></i>').join('');
  }
  const nodes = pathEl.children;
  for(let i=0;i<nodes.length;i++){
    nodes[i].className = i < pos ? 'is-past' : (i === pos ? 'is-at' : '');
  }
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const visibleIdx = () => Q.map((d,i)=>i).filter(i=>!Q[i].cond || Q[i].cond());
const nextVisible = (from,dir) => {
  const vis = visibleIdx();
  return dir>0 ? vis.find(i=>i>from) : [...vis].reverse().find(i=>i<from);
};

function render(){
  window.scrollTo(0,0);
  if(step === -1) return renderIntro();
  if(step === Q.length) return renderDone();
  const d = Q[step];
  const vis = visibleIdx();
  const pos = vis.indexOf(step);
  bar.style.width = (pos/vis.length*100)+'%';
  drawPath(pos, vis.length);

  let f = '';
  const saved = answers[step] || {};
  if(['text','tel','email'].includes(d.t)){
    f = `<input type="${d.t==='text'?'text':d.t}" id="inp" placeholder="Hier Ihre Antwort eingeben…" value="${esc(saved.value||'')}">`;
  } else if(d.t === 'textarea'){
    f = `<textarea id="inp" placeholder="Hier Ihre Antwort eingeben…">${esc(saved.value||'')}</textarea>`;
  } else if(d.t === 'radio'){
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt radio${saved.value===o?' selected':''}"><input type="radio" name="r" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt radio${saved.value==='Sonstiges'?' selected':''}"><input type="radio" name="r" value="Egyéb"><span class="box"></span>Sonstiges</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${saved.value==='Sonstiges'?' show':''}"><input type="text" id="other" placeholder="Sonstiges…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'check'){
    const sel = saved.value || [];
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt${sel.includes(o)?' selected':''}"><input type="checkbox" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt${sel.includes('Sonstiges')?' selected':''}"><input type="checkbox" value="Egyéb"><span class="box"></span>Sonstiges</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${sel.includes('Sonstiges')?' show':''}"><input type="text" id="other" placeholder="Sonstiges…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'consent'){
    f = `<div class="opts"><label class="opt"><input type="checkbox" id="inp"${saved.value?' checked':''}><span class="box"></span>${esc(d.o[0])}</label></div>
         <p class="quiz__hint" style="margin-top:1rem"><a href="/de/datenschutz.html" target="_blank" rel="noopener">Datenschutzerklärung</a></p>`;
  }

  const isLast = nextVisible(step,1) === undefined;
  /* The step's identity, as data rather than as copy. The wizard has no <form>
     and no route change, so this is the only signal that a step advanced —
     Phase 9 Workstream C observes #app and reads these three attributes. Parsing
     the "01 / 12" label instead would tie measurement to presentation.
     `d.id` is a field *name* (cegnev, szegmens), never an answer; the event
     taxonomy permits names and forbids values. */
  app.innerHTML = `<div class="quiz__step" data-step="${pos+1}" data-steps="${vis.length}" data-step-key="${esc(d.id||'')}">
    <div class="quiz__num">${String(pos+1).padStart(2,'0')}<span class="quiz__total"> / ${String(vis.length).padStart(2,'0')}</span></div>
    <h1 class="quiz__q">${esc(d.q)}${d.req?' <span class="quiz__req">*</span>':''}</h1>
    ${d.hint?`<p class="quiz__hint">${esc(d.hint)}</p>`:''}
    <div class="quiz__fields">${f}</div>
    <div class="quiz__err" id="err">Diese Frage ist erforderlich.</div>
    <div class="quiz__nav">
      ${pos>0?'<button class="ghost" id="prev">Zurück</button>':''}
      <button id="next">${isLast?'Senden':'Weiter'}</button>
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
        const otherOn = [...app.querySelectorAll('.opt input')].some(i=>i.checked && i.value==='Sonstiges');
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
const ERR_REQUIRED = 'Diese Frage ist erforderlich.';
const ERR_SHORT = 'Bitte mindestens zwei Zeichen verwenden.';

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
  if(pathTotal>0) drawPath(-1, pathTotal);
  app.innerHTML = `<div class="quiz__step quiz__intro">
    <p class="crumbs"><a href="/de/index.html">Startseite</a> / <b>Angebotsanfrage</b></p>
    <div class="quiz__num">Stratos Webdesign · Angebotsanfrage</div>
    <h1>Fragen Sie in wenigen Minuten ein Angebot an.</h1>
    <p>Jede Frage erscheint auf einem eigenen Bildschirm; Fragen mit Sternchen (<span class="quiz__req">*</span>) müssen beantwortet werden. Etwa 8 Minuten.</p>
    <p>Was passiert danach? An Werktagen melden wir uns innerhalb von 24 Stunden und vereinbaren ein kostenloses Erstgespräch. Danach erhalten Sie Ihr individuelles Angebot schriftlich, 14 Tage gültig.</p>
    <p>Wenn Ihnen das gerade zu viel ist, genügt auch eine kurze Nachricht: <a href="/de/kontakt.html#uzenet">Ich schreibe lieber ein paar Zeilen</a>.</p>
    <div class="quiz__nav"><button id="start">Los geht's</button><span class="quiz__enter">ENTER ↵</span></div>
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
    if(d.t==='consent') v = a.value ? 'Akzeptiert' : 'Nicht akzeptiert';
    if(a.other) v += (v?' | ':'') + 'Sonstiges:' + a.other;
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
      <h1 class="quiz__q">Wird gesendet…</h1>
    </div>`,
  success: () => `<div class="quiz__step quiz__done" data-state="success">
      <div class="quiz__mark">✓</div>
      <h1 class="quiz__q">Vielen Dank, wir haben es erhalten.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">An Werktagen melden wir uns innerhalb von 24 Stunden über die angegebenen Kontaktdaten und vereinbaren ein kostenloses Erstgespräch. Wenn Sie nicht warten möchten, buchen Sie jetzt einen Termin.</p>
      <div class="quiz__nav" style="justify-content:center"><a class="btn" href="/de/termin-buchen.html"><span>Kostenloses Erstgespräch</span></a><a class="tlink" href="/de/index.html">Zurück zur Startseite</a></div>
    </div>`,
  invalid: msg => `<div class="quiz__step quiz__done" data-state="invalid">
      <h1 class="quiz__q">Es fehlt etwas.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">${esc(msg)}</p>
      <div class="quiz__nav" style="justify-content:center"><button id="fix">Zurück zu den Fragen</button></div>
    </div>`,
  limited: () => `<div class="quiz__step quiz__done" data-state="limited">
      <h1 class="quiz__q">Zu viele Übermittlungen hintereinander.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Warten Sie eine Minute und versuchen Sie es dann erneut.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Erneut versuchen</button></div>
    </div>`,
  error: () => `<div class="quiz__step quiz__done" data-state="error">
      <h1 class="quiz__q">Das Senden hat nicht geklappt.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Versuchen Sie es erneut oder schreiben Sie an <a href="mailto:hello@stratosweb.hu">hello@stratosweb.hu</a>.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Erneut versuchen</button></div>
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
  if(pathTotal>0) drawPath(pathTotal, pathTotal);
  finish('submitting');

  const fields = collectFields();
  const hp = document.getElementById('hp-quiz');

  // Ugyanaz az ellenőrzés, mint a szerveren — csak itt hamarabb megmondjuk.
  const name = fields.kitolto.length >= 2 ? fields.kitolto : fields.cegnev;
  if(name.length < 2){
    sending = false;
    finish('invalid', 'Geben Sie den Firmen- oder Ansprechpartnernamen an.');
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
