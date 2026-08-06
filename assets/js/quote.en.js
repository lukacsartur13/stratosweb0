// Kliens oldali wizard, beküldés a POST /api/lead végpontra.
// Szegmentálás a 2. kérdésnél: kis-/középvállalkozás vs. nagyvállalat — a két ág
// teljesen külön kérdéssort kap, a cond() függvények kapcsolják a láthatóságot.
const ans = id => { const i = Q.findIndex(q=>q.id===id); return answers[i] || {}; };
const NAGY = 'Large enterprise / multinational';
const isNagy = () => ans('szegmens').value === NAGY;
const kkv = () => !isNagy();

const Q = [
  // ===== KÖZÖS: alapadatok =====
  {t:'text',    q:'What is the name of the business?', req:1, min:2, id:'cegnev'},
  {t:'radio',   q:'Which best describes the business?', req:1, id:'szegmens',
    o:['Sole trader / small business','Medium-sized business',NAGY]},
  {t:'text',    q:'Who is filling in the questionnaire? (name, role)', min:2, id:'kitolto'},
  {t:'tel',     q:'Phone number:', req:1, id:'telefon'},
  {t:'email',   q:'Email address:', req:1, id:'email'},

  // ===== KKV ÁG =====
  {t:'textarea',q:'What does your company do? (short description)', req:1, cond:kkv},
  {t:'text',    q:'Do you have a current website? If so, what\'s the address?', id:'weboldal', cond:kkv},
  {t:'radio',   q:'How did you find us?', other:1, cond:kkv,
    o:['Google search','Facebook / Instagram','TikTok','Recommended by someone I know']},
  {t:'check',   q:'What is the goal of the website? (multiple choice)', req:1, other:1, cond:kkv,
    o:['Winning more clients','Selling online (shop)','Appointment booking','Brand building']},
  {t:'radio',   q:'Who are your main clients?', req:1, cond:kkv,
    o:['Consumers (B2C)','Businesses (B2B)','Both']},
  {t:'radio',   q:'Do you need a single-language or a multilingual website?', other:1, cond:kkv,
    hint:'If you need several languages, please list them in the other field.',
    o:['Single-language','Multilingual']},
  {t:'textarea',q:'List your services / products and mark which one matters most.', req:1, cond:kkv,
    hint:'If you have seasonal or promotional offers, add them here too.'},
  {t:'textarea',q:'What menu items / subpages do you have in mind?', cond:kkv,
    hint:'For example: Home, Services, About, Pricing, Contact. If you have no idea yet, leave it empty — we\'ll suggest something.'},
  {t:'check',   q:'What features does the site need?', req:1, other:1, id:'funkciok', cond:kkv,
    o:['Appointment booking system','Online shop','Contact form','Chat / Messenger / WhatsApp','Blog','Newsletter signup','Automated quote requests','CRM','Payment system','Ad tracking (Meta Pixel, Google Ads)']},
  {t:'textarea',q:'Online shop details: roughly how many products would you start with, do you need a shipping integration (e.g. DHL, GLS), and do you have a preferred payment provider (e.g. Stripe, PayPal, Klarna)?',
    cond:()=> kkv() && (ans('funkciok').value||[]).includes('Online shop')},
  {t:'radio',   q:'Do you already have a logo / visual identity?', req:1, cond:kkv,
    o:['Logo and full identity (colours, typefaces, brand book)','Logo only','No — identity design is needed too']},
  {t:'radio',   q:'Do you have your own domain and hosting?', other:1, cond:kkv,
    hint:'The domain is the website\'s address (e.g. company.com). If you know, write in the other field where it\'s registered.',
    o:['Yes, and I have access','Yes, but I don\'t manage it','Not yet']},
  {t:'radio',   q:'Who provides the content (copy, images)?', req:1, cond:kkv,
    o:['We provide everything','Partly ready, we need help','We\'d like full copywriting and imagery']},
  {t:'radio',   q:'Would you like to edit the site yourself later?', cond:kkv,
    o:['Yes — I want editing access and training','No, I\'d leave the changes to you','I don\'t know yet']},
  {t:'textarea',q:'A longer description of the business, for the copywriting', cond:kkv,
    hint:'Optional — if you already have introductory material (website, Facebook page, brochure), a link is enough.'},
  {t:'radio',   q:'Which style appeals to you most?', req:1, other:1, cond:kkv,
    o:['Clean, minimal','Modern, dynamic','Premium, elegant','Creative, bold']},
  {t:'radio',   q:'Shapes:', req:1, cond:kkv,
    o:['Rounded elements (soft, friendly)','Sharp, boxy, structured elements (serious, tech feel)','A mix of both']},
  {t:'radio',   q:'Colours:', req:1, other:1, cond:kkv,
    hint:'If you have a specific palette, put the colour codes in the other field (e.g. ABCD25).',
    o:['Light (white, beige, pastel)','Dark (black, charcoal, deep tones)','Brand colours dominating']},
  {t:'radio',   q:'How showy should the site be?', req:1, cond:kkv,
    o:['Clean and fast — function first','Modern, with subtle animation','A striking “wow” experience with scroll animation']},
  {t:'textarea',q:'Is there a website you like? And one you definitely don\'t? (links)', cond:kkv,
    hint:'A negative example helps at least as much as a positive one.'},
  {t:'textarea',q:'Who are your main competitors, and how are you different?', cond:kkv},
  {t:'radio',   q:'Are you currently running ads?', req:1, other:1, cond:kkv,
    hint:'If yes, please specify the platform in the other field.',
    o:['Yes','No']},
  {t:'text',    q:'Links to your social media pages:', cond:kkv,
    hint:'Facebook, Instagram, TikTok, LinkedIn — whatever you have.'},
  {t:'radio',   q:'When does the website need to be finished?', req:1, other:1, id:'hatarido', cond:kkv,
    o:['Within 1 week','Within 1 month','Within a few months']},
  {t:'radio',   q:'Which payment model would suit you?', req:1, id:'konstrukcio', cond:kkv,
    o:['One-off fee','Monthly fee model','I\'m interested in both — please quote']},
  {t:'radio',   q:'Do you have a planned budget?', req:1, other:1, id:'koltsegkeret',
    cond:()=> kkv() && ans('konstrukcio').value !== 'Monthly fee model',
    o:['€400 – €800','€800 – €1,300','€1,300 – €2,600','Not yet — I\'ll decide based on the quote']},
  {t:'radio',   q:'What monthly budget are you thinking of?', req:1, other:1, id:'havidij',
    cond:()=> kkv() && ['Monthly fee model','I\'m interested in both — please quote'].includes(ans('konstrukcio').value),
    o:['€50 – €100 / month','€100 – €180 / month','Over €180 / month']},

  // ===== NAGYVÁLLALATI ÁG =====
  {t:'textarea',q:'What does the company do, and which department is handling this project?', req:1, cond:isNagy,
    hint:'For example: marketing, IT, procurement, management.'},
  {t:'radio',   q:'What is the project about?', req:1, other:1, cond:isNagy,
    o:['A new corporate website','Redesign of an existing website','E-commerce platform','Internal portal / web application','Campaign landing pages']},
  {t:'text',    q:'Address of the current website(s):', id:'weboldal_nagy', cond:isNagy},
  {t:'textarea',q:'What is the business goal of the project, and which metrics define success?', req:1, cond:isNagy,
    hint:'For example: increasing lead generation, entering international markets, strengthening the employer brand, conversion rate.'},
  {t:'check',   q:'Which systems does it need to integrate with?', other:1, cond:isNagy,
    o:['CRM (e.g. Salesforce, HubSpot)','ERP (e.g. SAP)','Marketing automation / newsletter','SSO / directory (e.g. Azure AD)','Custom internal system / API','Analytics / BI','No integration needed']},
  {t:'radio',   q:'Is there an internal IT / development team we\'d work with?', req:1, cond:isNagy,
    o:['Yes, there\'s an internal team','No — we\'d like full delivery','An external partner manages our systems']},
  {t:'radio',   q:'Are brand guidelines available?', req:1, cond:isNagy,
    o:['Yes, comprehensive','Partly (logo, base colours)','No — we\'d like identity work as well']},
  {t:'text',    q:'In how many languages and on which markets does the site need to appear?', req:1, cond:isNagy},
  {t:'check',   q:'Are there compliance or security requirements?', other:1, cond:isNagy,
    o:['GDPR / data protection requirements','Accessibility (WCAG)','Data residency (EU servers)','Internal security audit / ISO','Still under discussion']},
  {t:'radio',   q:'Who supplies the content (copy, images, video)?', req:1, cond:isNagy,
    o:['Our marketing department','Partly — external support is needed','We\'d like full content production']},
  {t:'textarea',q:'What does the procurement and decision process look like?', req:1, cond:isNagy,
    hint:'For example: tender / multiple quotes required, number of approval rounds, who the decision makers are, whether there\'s a submission deadline.'},
  {t:'radio',   q:'Is a non-disclosure agreement (NDA) needed for the discussions?', cond:isNagy,
    o:['Yes','No','To be decided later']},
  {t:'radio',   q:'What is the project timeframe?', req:1, other:1, id:'hatarido_nagy', cond:isNagy,
    o:['Within 1 month','Within a quarter','Within six months']},
  {t:'radio',   q:'What is the planned budget?', req:1, other:1, id:'koltsegkeret_nagy', cond:isNagy,
    o:['€2,500 – €8,000','€8,000 – €25,000','Over €25,000','Awaiting internal approval']},
  {t:'textarea',q:'Design expectations, references (links):', cond:isNagy,
    hint:'Competitors or other corporate sites that give direction — as a positive or a negative example.'},

  // ===== KÖZÖS: zárás =====
  {t:'radio',   q:'Would you like to request a free consultation?', id:'konzultacio',
    o:['Yes','I don\'t need one']},
  {t:'radio',   q:'How should we meet?', other:1,
    hint:'Use the other field to say when you\'re most reachable.',
    o:['By phone','Google Meet / video call','In person'],
    cond:()=> ans('konzultacio').value === 'Yes'},
  {t:'textarea',q:'Is there anything else you think is important to add?'},
  {t:'consent', q:'Privacy statement', req:1,
    o:['By submitting this form I declare that I have read and accept the privacy statement and its terms.']},
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
  drawPath(pos, vis.length);

  let f = '';
  const saved = answers[step] || {};
  if(['text','tel','email'].includes(d.t)){
    f = `<input type="${d.t==='text'?'text':d.t}" id="inp" placeholder="Type your answer here…" value="${esc(saved.value||'')}">`;
  } else if(d.t === 'textarea'){
    f = `<textarea id="inp" placeholder="Type your answer here…">${esc(saved.value||'')}</textarea>`;
  } else if(d.t === 'radio'){
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt radio${saved.value===o?' selected':''}"><input type="radio" name="r" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt radio${saved.value==='Other'?' selected':''}"><input type="radio" name="r" value="Egyéb"><span class="box"></span>Other</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${saved.value==='Other'?' show':''}"><input type="text" id="other" placeholder="Other…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'check'){
    const sel = saved.value || [];
    f = `<div class="opts">` +
      d.o.map(o=>`<label class="opt${sel.includes(o)?' selected':''}"><input type="checkbox" value="${esc(o)}"><span class="box"></span>${esc(o)}</label>`).join('') +
      (d.other?`<label class="opt${sel.includes('Other')?' selected':''}"><input type="checkbox" value="Egyéb"><span class="box"></span>Other</label>`:'') +
      `</div>` +
      (d.other?`<div class="other-input${sel.includes('Other')?' show':''}"><input type="text" id="other" placeholder="Other…" value="${esc(saved.other||'')}"></div>`:'');
  } else if(d.t === 'consent'){
    f = `<div class="opts"><label class="opt"><input type="checkbox" id="inp"${saved.value?' checked':''}><span class="box"></span>${esc(d.o[0])}</label></div>
         <p class="quiz__hint" style="margin-top:1rem">Privacy statement:<a href="privacy-policy.html" target="_blank" rel="noopener">privacy-policy</a></p>`;
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
    <div class="quiz__err" id="err">This question is required.</div>
    <div class="quiz__nav">
      ${pos>0?'<button class="ghost" id="prev">Back</button>':''}
      <button id="next">${isLast?'Submit':'Next'}</button>
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
        const otherOn = [...app.querySelectorAll('.opt input')].some(i=>i.checked && i.value==='Other');
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
const ERR_REQUIRED = 'This question is required.';
const ERR_SHORT = 'Please use at least two characters.';

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
  setAltitude(0);
  app.innerHTML = `<div class="quiz__step quiz__intro">
    <div class="quiz__num">Stratos · Requirements</div>
    <h1>Website<br>requirements<br>questionnaire</h1>
    <p>Each question appears on its own screen. Questions marked with a star (<span class="quiz__req">*</span>) are required.</p>
    <p>Based on your answers we'll be in touch within a few hours with more information and a tailored quote.</p>
    <p>Estimated time to complete: 8 minutes.</p>
    <div class="quiz__nav"><button id="start">Start</button><span class="quiz__enter">ENTER ↵</span></div>
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
    if(d.t==='consent') v = a.value ? 'Accepted' : 'Not accepted';
    if(a.other) v += (v?' | ':'') + 'Other:' + a.other;
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
      <h1 class="quiz__q">Sending…</h1>
    </div>`,
  success: () => `<div class="quiz__step quiz__done" data-state="success">
      <div class="quiz__mark">✓</div>
      <h1 class="quiz__q">Thank you for filling it in.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">We've recorded your answers and will be in touch shortly.</p>
      <div class="quiz__nav" style="justify-content:center"><a class="btn" href="index.html"><span>Back to the home page</span></a></div>
    </div>`,
  invalid: msg => `<div class="quiz__step quiz__done" data-state="invalid">
      <h1 class="quiz__q">Something is missing.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">${esc(msg)}</p>
      <div class="quiz__nav" style="justify-content:center"><button id="fix">Back to the questions</button></div>
    </div>`,
  limited: () => `<div class="quiz__step quiz__done" data-state="limited">
      <h1 class="quiz__q">Too many submissions in a row.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Please wait a minute, then try again.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Try again</button></div>
    </div>`,
  error: () => `<div class="quiz__step quiz__done" data-state="error">
      <h1 class="quiz__q">Something went wrong while sending.</h1>
      <p class="quiz__hint" style="margin:1rem auto 0">Please try again, or write to<a href="mailto:lukacs.artur@media-stratos.com">lukacs.artur@media-stratos.com</a>.</p>
      <div class="quiz__nav" style="justify-content:center"><button id="retry">Try again</button></div>
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
  setAltitude(1);
  finish('submitting');

  const fields = collectFields();
  const hp = document.getElementById('hp-quiz');

  // Ugyanaz az ellenőrzés, mint a szerveren — csak itt hamarabb megmondjuk.
  const name = fields.kitolto.length >= 2 ? fields.kitolto : fields.cegnev;
  if(name.length < 2){
    sending = false;
    finish('invalid', 'Please give the business or contact name.');
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
