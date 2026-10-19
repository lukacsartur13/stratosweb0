// =============================================================================
// The newsletter's words and markup (20261019000100_newsletter.sql) — pure:
// no network, no database, so a test renders every e-mail and every page in
// every language (tests/newsletter.spec.ts).
//
//   confirmationEmail   "is this you?" — the double opt-in link
//   welcomeEmail        after the click
//   campaignEmail       what the Portal writes, with the footer the law asks
//                       for (who sends it, why you get it, how to leave) —
//                       also each e-mail of the welcome series
//   receiptEmail        "we have it" after the contact form, the quote
//                       questionnaire or the Impact application
//   bookingReminder     about a day before a booked call
//   announcement        a new article or case study, as a campaign per language
//                       (20261019000200_email_automations.sql)
//   renderBody          the Portal's light markup → HTML and plain text
//   page                the small pages the links in those e-mails open
//   verifyWebhook       Resend's (Svix) signature on bounce/complaint events
//
// Readers are addressed as on the public site: "te" in Hungarian, "Sie" in
// German. Every value that came from a person is HTML-escaped where it goes
// into HTML.
// =============================================================================
import { createHmac, timingSafeEqual } from 'node:crypto';
import { when } from './notify-templates.mjs';

export const LANGS = ['hu', 'en', 'de'];
export const pickLang = (locale) => (LANGS.includes(locale) ? locale : 'hu');
export const TOKEN_RE = /^[0-9a-f]{64}$/;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fill = (s, ctx = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] === undefined || ctx[k] === null ? '' : String(ctx[k])));

/** Who sends it — the imprint (impresszum.html), in one line. */
export const SENDER = 'Stratos · Lukács Artúr e.v. · 9151 Abda, Arany János utca 13. · stratosweb.hu';

// The public pages a reader is sent to, per language (_build/build.py SLUGS).
const PAGES = {
  hu: { home: '/', blog: '/blog.html', privacy: '/adatkezelesi-tajekoztato.html',
        posts: [['blog-weboldal-arak.html', 'Mennyibe kerül egy weboldal?'],
                ['blog-miert-nem-hoz-ugyfelet.html', 'Miért nem hoz ügyfelet a weboldalad?'],
                ['blog-google-elso-oldal.html', 'Hogyan kerülj a Google első oldalára?']] },
  en: { home: '/en/', blog: '/en/blog.html', privacy: '/en/privacy-policy.html',
        posts: [['blog-website-cost.html', 'What does a website cost?'],
                ['blog-no-enquiries.html', 'Why your website brings no enquiries'],
                ['blog-google-first-page.html', 'How to reach the first page of Google']] },
  de: { home: '/de/', blog: '/de/blog.html', privacy: '/de/datenschutz.html',
        posts: [['blog-website-kosten.html', 'Was kostet eine Website?'],
                ['blog-keine-anfragen.html', 'Warum Ihre Website keine Anfragen bringt'],
                ['blog-google-erste-seite.html', 'So kommen Sie auf die erste Seite bei Google']] },
};
const BOOK = { hu: '/idopontfoglalas.html', en: '/en/book-a-call.html', de: '/de/termin-buchen.html' };
const IMPACT = { hu: '/impact-program.html', en: '/en/impact-program.html', de: '/de/impact-programm.html' };
const postUrl = (origin, lang, file) => `${origin}${lang === 'hu' ? '/' : `/${lang}/`}${file}`;

/* ================================================================== links */

export const confirmUrl = (origin, lang, token) => `${origin}/api/newsletter/confirm?t=${token}&l=${pickLang(lang)}`;
export const unsubscribeUrl = (origin, lang, token) => `${origin}/api/newsletter/unsubscribe?t=${token}&l=${pickLang(lang)}`;

/**
 * RFC 2369 + RFC 8058: the mail app's own "Unsubscribe" button. It POSTs
 * `List-Unsubscribe=One-Click` to the URL, which unsubscribes at once — the
 * Gmail and Yahoo bulk-sender rules require it.
 */
export const listUnsubscribe = (url) => ({
  'List-Unsubscribe': `<${url}>`,
  'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
});

/* ================================================================= markup */

const SAFE_URL = /^(https?:\/\/|mailto:)[^\s<>"']+$/i;

/** Inline: **bold**, [text](url), bare https:// links. `s` is already escaped. */
function inline(s) {
  const links = [];
  let out = s.replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (m, text, url) => {
    const href = url.replace(/&amp;/g, '&');
    if (!SAFE_URL.test(href)) return m;
    links.push(`<a href="${esc(href)}" style="color:#141413;text-decoration:underline">${text}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  out = out.replace(/\bhttps?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)]/g, (url) => {
    const href = url.replace(/&amp;/g, '&');
    links.push(`<a href="${esc(href)}" style="color:#141413;text-decoration:underline">${url}</a>`);
    return `\u0000${links.length - 1}\u0000`;
  });
  out = out.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => links[Number(i)]);
}

const plain = (s) => s
  .replace(/\[([^\]\n]{1,300})\]\(([^)\s]{1,2000})\)/g, (m, text, url) => (SAFE_URL.test(url) ? `${text} (${url})` : m))
  .replace(/\*\*([^*\n]+)\*\*/g, '$1');

const P = 'margin:0 0 16px;font-size:16px;line-height:1.6;color:#141413';

/**
 * The Portal's light markup. Blocks are separated by a blank line:
 *   ## Heading            a heading (the rest of the block is a paragraph)
 *   - item / * item       a list, when every line of the block is an item
 *   anything else         a paragraph; a single line break stays a break
 * Inline: **bold**, [text](https://…), and bare https:// addresses. Nothing
 * else — no HTML: everything is escaped first.
 */
export function renderBody(source) {
  const blocks = String(source ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n/).map((b) => b.replace(/^\n+|\n+$/g, '')).filter((b) => b.trim());
  const html = [];
  const text = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    if (/^##\s+/.test(lines[0])) {
      const heading = lines[0].replace(/^##\s+/, '').trim();
      html.push(`<h2 style="margin:28px 0 12px;font-size:20px;line-height:1.3;font-weight:bold;color:#141413">${inline(esc(heading))}</h2>`);
      text.push(plain(heading).toUpperCase());
      const rest = lines.slice(1).join('\n').trim();
      if (rest) {
        html.push(`<p style="${P}">${inline(esc(rest)).replace(/\n/g, '<br>')}</p>`);
        text.push(plain(rest));
      }
    } else if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
      const items = lines.map((l) => l.replace(/^\s*[-*]\s+/, ''));
      html.push(`<ul style="margin:0 0 16px;padding-left:22px;font-size:16px;line-height:1.6;color:#141413">${items.map((i) => `<li style="margin:0 0 6px">${inline(esc(i))}</li>`).join('')}</ul>`);
      text.push(items.map((i) => `• ${plain(i)}`).join('\n'));
    } else {
      html.push(`<p style="${P}">${inline(esc(block)).replace(/\n/g, '<br>')}</p>`);
      text.push(plain(block));
    }
  }
  return { html: html.join('\n'), text: text.join('\n\n') };
}

/* ================================================================= e-mail */

const COPY = {
  confirmSubject: ['Erősítsd meg a feliratkozásod — Stratos hírlevél', 'Confirm your subscription — Stratos newsletter', 'Bitte bestätigen Sie Ihre Anmeldung — Stratos-Newsletter'],
  confirmPre: ['Egy kattintás, és kész.', 'One click and you are done.', 'Ein Klick genügt.'],
  confirmHello: ['Szia!', 'Hello,', 'Guten Tag,'],
  confirmBody: [
    'Valaki — remélhetőleg te — ezzel a címmel feliratkozott a Stratos hírlevelére. Ha te voltál, kattints a gombra, és kész.',
    'Someone — hopefully you — signed up for the Stratos newsletter with this address. If it was you, click the button and you are done.',
    'Jemand — hoffentlich Sie — hat sich mit dieser Adresse für den Stratos-Newsletter angemeldet. Wenn Sie es waren, klicken Sie auf die Schaltfläche.',
  ],
  confirmButton: ['Igen, feliratkozom', 'Yes, subscribe me', 'Ja, ich möchte den Newsletter'],
  confirmIgnore: [
    'Ha nem te voltál, nincs teendőd: megerősítés nélkül nem küldünk hírlevelet, és a címet 30 nap múlva töröljük.',
    'If it was not you, there is nothing to do: without a confirmation we send no newsletter, and the address is deleted after 30 days.',
    'Wenn Sie es nicht waren, müssen Sie nichts tun: Ohne Bestätigung senden wir keinen Newsletter, und die Adresse wird nach 30 Tagen gelöscht.',
  ],
  welcomeSubject: ['Üdv a Stratos hírlevélben!', 'Welcome to the Stratos newsletter', 'Willkommen beim Stratos-Newsletter'],
  welcomePre: ['Ezekkel a cikkekkel érdemes kezdeni.', 'A few articles to start with.', 'Ein paar Artikel für den Anfang.'],
  welcomeHello: ['Szia, és köszönjük!', 'Hello, and thank you!', 'Guten Tag, und vielen Dank!'],
  welcomeBody: [
    'Megerősítetted a feliratkozást. Ide küldjük, amit weboldalakról, keresőoptimalizálásról és online marketingről tanulunk — akkor írunk, amikor tényleg van mit mondanunk.',
    'Your subscription is confirmed. This is where we send what we learn about websites, search optimisation and online marketing — we write when we really have something to say.',
    'Ihre Anmeldung ist bestätigt. Hier teilen wir, was wir über Websites, Suchmaschinenoptimierung und Online-Marketing lernen — wir schreiben, wenn wir wirklich etwas zu sagen haben.',
  ],
  welcomeStart: ['Addig is, ezekkel érdemes kezdeni a blogon:', 'Meanwhile, three articles worth starting with:', 'Bis dahin lohnt sich ein Blick in diese drei Artikel:'],
  welcomeBlog: ['Az összes cikk', 'All articles', 'Alle Artikel'],
  welcomeReply: [
    'Kérdésed van? Válaszolj erre a levélre, és mi olvassuk.',
    'Any questions? Reply to this e-mail — a person reads it.',
    'Fragen? Antworten Sie einfach auf diese E-Mail — sie wird persönlich gelesen.',
  ],
  why: [
    'Azért kapod ezt a levelet, mert feliratkoztál a Stratos hírlevelére a stratosweb.hu oldalon.',
    'You receive this e-mail because you subscribed to the Stratos newsletter on stratosweb.hu.',
    'Sie erhalten diese E-Mail, weil Sie den Stratos-Newsletter auf stratosweb.hu abonniert haben.',
  ],
  whyConfirm: [
    'Ezt a levelet azért kaptad, mert ezt a címet megadták a stratosweb.hu hírlevél-feliratkozásánál.',
    'You receive this e-mail because this address was entered in the newsletter signup on stratosweb.hu.',
    'Sie erhalten diese E-Mail, weil diese Adresse bei der Newsletter-Anmeldung auf stratosweb.hu angegeben wurde.',
  ],
  unsubscribe: ['Leiratkozás', 'Unsubscribe', 'Abmelden'],
  privacy: ['Adatkezelési tájékoztató', 'Privacy policy', 'Datenschutz'],
  // "we have it" (receiptEmail)
  receiptSubject_contact: ['Megkaptuk az üzeneted — Stratos', 'We have your message — Stratos', 'Ihre Nachricht ist angekommen — Stratos'],
  receiptSubject_questionnaire: ['Megkaptuk az árajánlatkérésed — Stratos', 'We have your quote request — Stratos', 'Ihre Angebotsanfrage ist angekommen — Stratos'],
  receiptSubject_impact: ['Megkaptuk a jelentkezésed — Stratos Impact Program', 'We have your application — Stratos Impact Program', 'Ihre Bewerbung ist angekommen — Stratos Impact-Programm'],
  receiptPre: ['Íme, mi történik most.', 'Here is what happens next.', 'So geht es jetzt weiter.'],
  receiptBody_contact: [
    'Köszönjük, hogy írtál! Megkaptuk az üzeneted, és jellemzően egy munkanapon belül válaszolunk erre a címre.',
    'Thank you for writing! We have your message and usually reply to this address within one working day.',
    'Vielen Dank für Ihre Nachricht! Sie ist bei uns angekommen, und wir antworten in der Regel innerhalb eines Werktags an diese Adresse.',
  ],
  receiptBody_questionnaire: [
    'Köszönjük a kitöltést! Megkaptuk a válaszaidat, átnézzük őket, és pár órán belül keresünk a további információkkal és a személyre szabott árajánlattal.',
    'Thank you for filling it in! We have your answers, we will go through them, and we will be in touch within a few hours with more information and a tailored quote.',
    'Vielen Dank fürs Ausfüllen! Ihre Antworten sind angekommen; wir sehen sie durch und melden uns innerhalb weniger Stunden mit weiteren Informationen und einem individuellen Angebot.',
  ],
  receiptBody_impact: [
    'Köszönjük a jelentkezést az Impact Programra! Átnézzük, és e-mailben jelentkezünk. A kiválasztás nem garantált — a részleteket az Impact Program oldalán találod.',
    'Thank you for applying to the Impact Program! We will go through your application and get back to you by e-mail. Selection is not guaranteed — the details are on the Impact Program page.',
    'Vielen Dank für Ihre Bewerbung beim Impact-Programm! Wir sehen sie durch und melden uns per E-Mail. Eine Auswahl ist nicht garantiert — die Einzelheiten finden Sie auf der Seite des Impact-Programms.',
  ],
  receiptBook: [
    'Ha addig szívesebben beszélnél, foglalj egy ingyenes, 30 perces Google Meet-hívást:',
    'If you would rather talk in the meantime, book a free 30-minute Google Meet call:',
    'Wenn Sie vorher lieber sprechen möchten, buchen Sie ein kostenloses 30-minütiges Gespräch auf Google Meet:',
  ],
  receiptBookButton: ['Időpontot foglalok', 'Book a call', 'Termin buchen'],
  receiptImpactButton: ['Az Impact Program', 'The Impact Program', 'Das Impact-Programm'],
  receiptReply: [
    'Ha valamit kihagytál, egyszerűen válaszolj erre a levélre.',
    'If you left something out, simply reply to this e-mail.',
    'Falls Sie etwas vergessen haben, antworten Sie einfach auf diese E-Mail.',
  ],
  receiptWhy_contact: [
    'Ezt a levelet azért kaptad, mert ezzel a címmel elküldték a kapcsolatfelvételi űrlapot a stratosweb.hu oldalon. Ha nem te voltál, nincs teendőd.',
    'You receive this e-mail because the contact form on stratosweb.hu was sent with this address. If it was not you, there is nothing to do.',
    'Sie erhalten diese E-Mail, weil das Kontaktformular auf stratosweb.hu mit dieser Adresse abgesendet wurde. Wenn Sie es nicht waren, müssen Sie nichts tun.',
  ],
  receiptWhy_questionnaire: [
    'Ezt a levelet azért kaptad, mert ezzel a címmel elküldték az árajánlatkérő kérdőívet a stratosweb.hu oldalon. Ha nem te voltál, nincs teendőd.',
    'You receive this e-mail because the quote questionnaire on stratosweb.hu was sent with this address. If it was not you, there is nothing to do.',
    'Sie erhalten diese E-Mail, weil der Angebotsfragebogen auf stratosweb.hu mit dieser Adresse abgesendet wurde. Wenn Sie es nicht waren, müssen Sie nichts tun.',
  ],
  receiptWhy_impact: [
    'Ezt a levelet azért kaptad, mert ezzel a címmel jelentkezést küldtek az Impact Programra a stratosweb.hu oldalon. Ha nem te voltál, nincs teendőd.',
    'You receive this e-mail because an Impact Program application was sent with this address on stratosweb.hu. If it was not you, there is nothing to do.',
    'Sie erhalten diese E-Mail, weil auf stratosweb.hu mit dieser Adresse eine Bewerbung für das Impact-Programm abgesendet wurde. Wenn Sie es nicht waren, müssen Sie nichts tun.',
  ],
  // before a booked call (bookingReminder)
  callSubject: ['Emlékeztető: beszélgetésünk — {when}', 'Reminder: our call — {when}', 'Erinnerung: unser Gespräch — {when}'],
  callPre: ['A Google Meet-link a levélben van.', 'The Google Meet link is inside.', 'Der Google-Meet-Link ist in dieser E-Mail.'],
  callBody: ['Emlékeztetünk a közös beszélgetésre: {when} ({zone}).', 'A reminder of our call: {when} ({zone}).', 'Eine Erinnerung an unser Gespräch: {when} ({zone}).'],
  callJoin: ['Csatlakozom a Google Meethez', 'Join Google Meet', 'Google Meet beitreten'],
  callPrep: [
    'Hogy a beszélgetés a lehető leghasznosabb legyen, érdemes kéznél tartani:',
    'To make the most of the call, it helps to have to hand:',
    'Damit das Gespräch möglichst viel bringt, halten Sie am besten bereit:',
  ],
  callPrepItems: [
    ['a mostani weboldalad címét, ha van', 'két-három oldalt, ami tetszik — akár egy versenytársét', 'nagyjából mekkora keretben gondolkodsz, és mikorra kellene elkészülnie'],
    ['the address of your current website, if there is one', 'two or three websites you like — a competitor\'s is fine', 'roughly what budget you have in mind, and when it should be ready'],
    ['die Adresse Ihrer aktuellen Website, falls vorhanden', 'zwei, drei Websites, die Ihnen gefallen — gern auch von Mitbewerbern', 'ungefähr welches Budget Sie sich vorstellen und bis wann es fertig sein soll'],
  ],
  callChange_public: [
    'Ha közbejött valami, a Google-meghívóban lévő linkkel lemondhatod vagy áthelyezheted.',
    'If something has come up, you can cancel or move it with the link in the Google invitation.',
    'Falls etwas dazwischengekommen ist, können Sie den Termin über den Link in der Google-Einladung absagen oder verschieben.',
  ],
  callChange_client: [
    'Ha közbejött valami, az ügyfélportálon lemondhatod vagy áthelyezheted.',
    'If something has come up, you can cancel or move it in your client portal.',
    'Falls etwas dazwischengekommen ist, können Sie den Termin im Kundenportal absagen oder verschieben.',
  ],
  callWhy: [
    'Ezt a levelet azért kaptad, mert időpontot foglaltál a Stratosnál.',
    'You receive this e-mail because you booked a call with Stratos.',
    'Sie erhalten diese E-Mail, weil Sie bei Stratos einen Termin gebucht haben.',
  ],
  zone: ['budapesti idő szerint', 'Budapest time', 'Budapester Zeit'],
  // a new article or case study (announcement)
  announceSubject_post: ['Új cikk: {title}', 'New article: {title}', 'Neuer Artikel: {title}'],
  announceSubject_case: ['Új esettanulmány: {title}', 'New case study: {title}', 'Neue Fallstudie: {title}'],
  announceRead_post: ['Elolvasom a cikket', 'Read the article', 'Artikel lesen'],
  announceRead_case: ['Megnézem az esettanulmányt', 'Read the case study', 'Fallstudie ansehen'],
  // a test from the Portal
  testBanner: ['PRÓBALEVÉL — csak neked ment ki.', 'TEST — sent to you only.', 'TEST — nur an Sie gesendet.'],
};
const L = { hu: 0, en: 1, de: 2 };
const c = (key, lang, ctx) => fill(COPY[key][L[pickLang(lang)]], ctx);

/** The frame every newsletter e-mail shares: wordmark, white card, quiet footer. */
function frame({ lang, preheader, inner, footer }) {
  return `<!doctype html><html lang="${pickLang(lang)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Stratos</title></head>
<body style="margin:0;padding:0;background:#F3F2EE;font-family:Arial,Helvetica,sans-serif;color:#141413">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#F3F2EE">${esc(preheader)}${'&#8199;&#847;'.repeat(30)}</div>` : ''}
<div style="max-width:600px;margin:0 auto;padding:32px 16px">
<p style="margin:0 0 20px;font-size:13px;letter-spacing:5px;color:#141413">STRATOS</p>
<div style="background:#FAFAF8;border:1px solid #E2E1DC;border-radius:14px;padding:32px 28px">
${inner}
</div>
<div style="padding:20px 4px 0;font-size:12px;line-height:1.6;color:#5F5E5A">${footer}</div>
</div></body></html>`;
}

const button = (href, label) => `<p style="margin:8px 0 24px"><a href="${esc(href)}" style="display:inline-block;background:#141413;color:#FAFAF8;text-decoration:none;padding:13px 22px;border-radius:999px;font-size:15px;font-weight:bold">${esc(label)}</a></p>`;
const link = (href, label) => `<a href="${esc(href)}" style="color:#5F5E5A;text-decoration:underline">${esc(label)}</a>`;

function footer(lang, origin, { why, unsubscribe }) {
  const p = PAGES[pickLang(lang)];
  const html = [
    `<p style="margin:0 0 6px">${esc(c(why, lang))}${unsubscribe ? ` ${link(unsubscribe, c('unsubscribe', lang))}` : ''}</p>`,
    `<p style="margin:0">${esc(SENDER)} · ${link(`${origin}${p.privacy}`, c('privacy', lang))}</p>`,
  ].join('');
  const text = [c(why, lang), unsubscribe ? `${c('unsubscribe', lang)}: ${unsubscribe}` : '', SENDER, `${c('privacy', lang)}: ${origin}${p.privacy}`]
    .filter(Boolean).join('\n');
  return { html, text };
}

/** "Is this you?" — sent right after a signup. No unsubscribe link: there is nothing to leave yet. */
export function confirmationEmail({ lang, origin, token }) {
  const url = confirmUrl(origin, lang, token);
  const f = footer(lang, origin, { why: 'whyConfirm' });
  const inner = [
    `<p style="${P}">${esc(c('confirmHello', lang))}</p>`,
    `<p style="${P}">${esc(c('confirmBody', lang))}</p>`,
    button(url, c('confirmButton', lang)),
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#5F5E5A">${esc(c('confirmIgnore', lang))}</p>`,
  ].join('\n');
  return {
    subject: c('confirmSubject', lang),
    html: frame({ lang, preheader: c('confirmPre', lang), inner, footer: f.html }),
    text: [c('confirmHello', lang), '', c('confirmBody', lang), '', `${c('confirmButton', lang)}: ${url}`, '', c('confirmIgnore', lang), '', '—', f.text].join('\n'),
    headers: {},
  };
}

/** After the click: hello, three articles to start with, how to leave. */
export function welcomeEmail({ lang, origin, unsubscribeToken }) {
  const l = pickLang(lang);
  const p = PAGES[l];
  const unsub = unsubscribeUrl(origin, l, unsubscribeToken);
  const f = footer(l, origin, { why: 'why', unsubscribe: unsub });
  const posts = p.posts.map(([file, title]) => [postUrl(origin, l, file), title]);
  const inner = [
    `<p style="${P}">${esc(c('welcomeHello', l))}</p>`,
    `<p style="${P}">${esc(c('welcomeBody', l))}</p>`,
    `<p style="${P}">${esc(c('welcomeStart', l))}</p>`,
    `<ul style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.6">${posts.map(([href, title]) => `<li style="margin:0 0 6px"><a href="${esc(href)}" style="color:#141413;text-decoration:underline">${esc(title)}</a></li>`).join('')}</ul>`,
    button(`${origin}${p.blog}`, c('welcomeBlog', l)),
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#5F5E5A">${esc(c('welcomeReply', l))}</p>`,
  ].join('\n');
  return {
    subject: c('welcomeSubject', l),
    html: frame({ lang: l, preheader: c('welcomePre', l), inner, footer: f.html }),
    text: [c('welcomeHello', l), '', c('welcomeBody', l), '', c('welcomeStart', l), ...posts.map(([href, title]) => `• ${title}: ${href}`),
      '', `${c('welcomeBlog', l)}: ${origin}${p.blog}`, '', c('welcomeReply', l), '', '—', f.text].join('\n'),
    headers: listUnsubscribe(unsub),
  };
}

/** A campaign from the Portal, for one reader. `test` puts a banner on it. */
export function campaignEmail({ lang, origin, subject, preheader, body, unsubscribeToken, test = false }) {
  const l = pickLang(lang);
  const unsub = unsubscribeUrl(origin, l, unsubscribeToken);
  const f = footer(l, origin, { why: 'why', unsubscribe: unsub });
  const rendered = renderBody(body);
  const banner = test ? `<p style="margin:0 0 20px;padding:8px 12px;background:#FFEE25;border-radius:8px;font-size:13px;font-weight:bold;color:#141413">${esc(c('testBanner', l))}</p>` : '';
  return {
    subject: String(subject ?? '').trim().slice(0, 200),
    html: frame({ lang: l, preheader: preheader || '', inner: `${banner}${rendered.html}`, footer: f.html }),
    text: [test ? c('testBanner', l) : '', rendered.text, '', '—', f.text].filter((x, i) => x !== '' || i > 0).join('\n'),
    headers: listUnsubscribe(unsub),
  };
}

/** "We have it", after the contact form, the questionnaire or the Impact
 *  application. Fixed words only: nothing the sender typed is repeated, so
 *  the form cannot carry someone's text to someone else's inbox. */
export function receiptEmail({ lang, origin, formType }) {
  const l = pickLang(lang);
  const form = ['contact', 'questionnaire', 'impact'].includes(formType) ? formType : 'contact';
  const f = footer(l, origin, { why: `receiptWhy_${form}` });
  const action = form === 'impact'
    ? { text: null, href: `${origin}${IMPACT[l]}`, label: c('receiptImpactButton', l) }
    : { text: c('receiptBook', l), href: `${origin}${BOOK[l]}`, label: c('receiptBookButton', l) };
  const inner = [
    `<p style="${P}">${esc(c('confirmHello', l))}</p>`,
    `<p style="${P}">${esc(c(`receiptBody_${form}`, l))}</p>`,
    action.text ? `<p style="${P}">${esc(action.text)}</p>` : '',
    button(action.href, action.label),
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#5F5E5A">${esc(c('receiptReply', l))}</p>`,
  ].filter(Boolean).join('\n');
  return {
    subject: c(`receiptSubject_${form}`, l),
    html: frame({ lang: l, preheader: c('receiptPre', l), inner, footer: f.html }),
    text: [c('confirmHello', l), '', c(`receiptBody_${form}`, l), '', ...(action.text ? [action.text] : []),
      `${action.label}: ${action.href}`, '', c('receiptReply', l), '', '—', f.text].join('\n'),
    headers: {},
  };
}

/** About a day before a booked call: when, the Meet link, what to have to hand. */
export function bookingReminder({ lang, origin, kind, startsAt, timeZone = 'Europe/Budapest', meetUrl = null }) {
  const l = pickLang(lang);
  const at = when(startsAt, l, timeZone);
  const zone = timeZone === 'Europe/Budapest' ? c('zone', l) : timeZone;
  const meet = typeof meetUrl === 'string' && /^https:\/\/meet\.google\.com\/[A-Za-z0-9-]+$/.test(meetUrl) ? meetUrl : null;
  const items = COPY.callPrepItems[L[l]];
  const change = c(kind === 'client' ? 'callChange_client' : 'callChange_public', l);
  const f = footer(l, origin, { why: 'callWhy' });
  const inner = [
    `<p style="${P}">${esc(c('confirmHello', l))}</p>`,
    `<p style="${P}">${esc(c('callBody', l, { when: at, zone }))}</p>`,
    meet ? button(meet, c('callJoin', l)) : '',
    kind === 'client' ? '' : `<p style="${P}">${esc(c('callPrep', l))}</p>
<ul style="margin:0 0 20px;padding-left:22px;font-size:16px;line-height:1.6">${items.map((i) => `<li style="margin:0 0 6px">${esc(i)}</li>`).join('')}</ul>`,
    `<p style="margin:0;font-size:14px;line-height:1.6;color:#5F5E5A">${esc(change)}</p>`,
  ].filter(Boolean).join('\n');
  return {
    subject: c('callSubject', l, { when: at }).slice(0, 200),
    html: frame({ lang: l, preheader: c('callPre', l), inner, footer: f.html }),
    text: [c('confirmHello', l), '', c('callBody', l, { when: at, zone }), ...(meet ? ['', `${c('callJoin', l)}: ${meet}`] : []),
      ...(kind === 'client' ? [] : ['', c('callPrep', l), ...items.map((i) => `• ${i}`)]), '', change, '', '—', f.text].join('\n'),
    headers: {},
  };
}

/**
 * A new article or case study from the site's list
 * (assets/data/newsletter-feed.json), as one campaign per language it exists
 * in: { audience, subject, preheader, body } in the Portal's light markup.
 */
export function announcement(item, origin) {
  const type = item?.type === 'case' ? 'case' : 'post';
  return LANGS.filter((l) => item?.langs?.[l]?.title && item.langs[l].url).map((l) => {
    const { title, desc = '', url } = item.langs[l];
    const href = /^https?:\/\//.test(url) ? url : `${origin}${url.startsWith('/') ? '' : '/'}${url}`;
    const md = (t) => String(t).replace(/[[\]*]/g, '');
    return {
      audience: l,
      subject: c(`announceSubject_${type}`, l, { title }).slice(0, 200),
      preheader: String(desc).slice(0, 200),
      body: [`## ${md(title)}`, md(desc), `[${c(`announceRead_${type}`, l)}](${href})`].filter((x) => x.trim()).join('\n\n'),
    };
  });
}

/* ================================================================== pages */

// What the links open: [title, text, button?] per state, per language.
const PAGE = {
  confirm_ask: [
    ['Feliratkozás megerősítése', 'Egy kattintás, és feliratkoztál a Stratos hírlevelére.', 'Igen, feliratkozom'],
    ['Confirm your subscription', 'One click and you are subscribed to the Stratos newsletter.', 'Yes, subscribe me'],
    ['Anmeldung bestätigen', 'Ein Klick, und Sie erhalten den Stratos-Newsletter.', 'Ja, ich möchte den Newsletter'],
  ],
  confirm_done: [
    ['Kész, feliratkoztál!', 'Küldtünk egy üdvözlő levelet. Addig is nézz körül a blogon.', 'A blog'],
    ['You are subscribed!', 'We have sent you a welcome e-mail. Meanwhile, have a look at the blog.', 'The blog'],
    ['Sie sind angemeldet!', 'Wir haben Ihnen eine Willkommens-E-Mail geschickt. Schauen Sie inzwischen in den Blog.', 'Zum Blog'],
  ],
  confirm_already: [
    ['Már feliratkoztál', 'Ezt a címet korábban megerősítetted — nincs több teendőd.', 'A blog'],
    ['Already subscribed', 'This address was confirmed before — there is nothing more to do.', 'The blog'],
    ['Bereits angemeldet', 'Diese Adresse wurde bereits bestätigt — Sie müssen nichts weiter tun.', 'Zum Blog'],
  ],
  confirm_expired: [
    ['Ez a link lejárt', 'A megerősítő link 30 napig érvényes. Iratkozz fel újra az oldal alján, és küldünk egy újat.', 'Vissza az oldalra'],
    ['This link has expired', 'A confirmation link is valid for 30 days. Sign up again at the bottom of the site and we will send a new one.', 'Back to the site'],
    ['Dieser Link ist abgelaufen', 'Ein Bestätigungslink gilt 30 Tage. Melden Sie sich unten auf der Website erneut an, dann senden wir einen neuen.', 'Zur Website'],
  ],
  confirm_unknown: [
    ['Ez a link nem érvényes', 'Lehet, hogy egy újabb levél váltotta fel. Iratkozz fel újra az oldal alján, és küldünk egy új linket.', 'Vissza az oldalra'],
    ['This link is not valid', 'A newer e-mail may have replaced it. Sign up again at the bottom of the site and we will send a new link.', 'Back to the site'],
    ['Dieser Link ist nicht gültig', 'Vielleicht wurde er durch eine neuere E-Mail ersetzt. Melden Sie sich unten auf der Website erneut an, dann senden wir einen neuen Link.', 'Zur Website'],
  ],
  unsubscribe_ask: [
    ['Leiratkozás', 'Biztosan nem kérsz több levelet a Stratos hírlevélből?', 'Leiratkozom'],
    ['Unsubscribe', 'Do you really want no more e-mails from the Stratos newsletter?', 'Unsubscribe'],
    ['Abmelden', 'Möchten Sie den Stratos-Newsletter wirklich nicht mehr erhalten?', 'Abmelden'],
  ],
  unsubscribe_done: [
    ['Leiratkoztál', 'Erre a címre több hírlevelet nem küldünk.', 'Mégis maradok'],
    ['You are unsubscribed', 'We will send no more newsletters to this address.', 'Keep me subscribed'],
    ['Sie sind abgemeldet', 'Wir senden keinen Newsletter mehr an diese Adresse.', 'Doch angemeldet bleiben'],
  ],
  unsubscribe_already: [
    ['Már leiratkoztál', 'Erről a címről korábban leiratkoztál — nem küldünk rá hírlevelet.', 'Vissza az oldalra'],
    ['Already unsubscribed', 'This address was unsubscribed before — we send it no newsletter.', 'Back to the site'],
    ['Bereits abgemeldet', 'Diese Adresse wurde bereits abgemeldet — sie erhält keinen Newsletter.', 'Zur Website'],
  ],
  unsubscribe_unknown: [
    ['Ez a link nem érvényes', 'Ha továbbra is kapsz tőlünk hírlevelet, írj a hello@stratosweb.hu címre, és kézzel leiratkoztatunk.', 'Vissza az oldalra'],
    ['This link is not valid', 'If you still receive our newsletter, write to hello@stratosweb.hu and we will unsubscribe you by hand.', 'Back to the site'],
    ['Dieser Link ist nicht gültig', 'Wenn Sie weiterhin unseren Newsletter erhalten, schreiben Sie an hello@stratosweb.hu, dann melden wir Sie von Hand ab.', 'Zur Website'],
  ],
  resubscribe_done: [
    ['Örülünk, hogy maradsz!', 'Visszavettünk a listára — a következő hírlevél hozzád is megérkezik.', 'A blog'],
    ['Glad you are staying!', 'You are back on the list — the next newsletter will reach you too.', 'The blog'],
    ['Schön, dass Sie bleiben!', 'Sie stehen wieder auf der Liste — der nächste Newsletter erreicht auch Sie.', 'Zum Blog'],
  ],
  resubscribe_no: [
    ['Így nem lehet visszairatkozni', 'Iratkozz fel újra az oldal alján — küldünk egy megerősítő levelet.', 'Vissza az oldalra'],
    ['You cannot rejoin this way', 'Sign up again at the bottom of the site — we will send a confirmation e-mail.', 'Back to the site'],
    ['So ist keine erneute Anmeldung möglich', 'Melden Sie sich unten auf der Website erneut an — wir senden eine Bestätigungs-E-Mail.', 'Zur Website'],
  ],
  error: [
    ['Valami nem sikerült', 'Most nem értük el a rendszert. Próbáld újra pár perc múlva.', 'Vissza az oldalra'],
    ['Something went wrong', 'We could not reach the system just now. Please try again in a few minutes.', 'Back to the site'],
    ['Etwas ist schiefgegangen', 'Das System war gerade nicht erreichbar. Bitte versuchen Sie es in einigen Minuten erneut.', 'Zur Website'],
  ],
};
// Where a state's button goes, when it is a link rather than a form.
const PAGE_LINK = { confirm_done: 'blog', confirm_already: 'blog', resubscribe_done: 'blog' };

/**
 * One small page, in the site's colours, with no script. `form` makes the
 * button a POST back to the same address (confirm, unsubscribe, rejoin):
 * a mail scanner that opens links does not press buttons, so nobody is
 * subscribed or unsubscribed by a robot.
 */
export function page({ lang, state, origin = '', form = null }) {
  const l = pickLang(lang);
  const [title, text, label] = (PAGE[state] ?? PAGE.error)[L[l]];
  const p = PAGES[l];
  const action = form
    ? `<form method="post" action="${esc(form.action)}">${Object.entries(form.fields ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<button type="submit">${esc(label)}</button></form>`
    : `<a class="btn" href="${esc(`${origin}${PAGE_LINK[state] === 'blog' ? p.blog : p.home}`)}">${esc(label)}</a>`;
  return `<!doctype html>
<html lang="${l}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>${esc(title)} — Stratos</title>
<link rel="icon" href="/assets/img/favicon-192.png">
<link rel="stylesheet" href="/assets/css/type.css">
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px;
         background: #F3F2EE; color: #141413; font-family: 'Archivo', Arial, Helvetica, sans-serif; }
  main { width: 100%; max-width: 520px; background: #FAFAF8; border: 1px solid rgba(20,20,19,.10); border-radius: 28px; padding: 40px 32px; }
  .wm { margin: 0 0 32px; font-family: 'Aboreto', 'Archivo', sans-serif; font-size: 15px; letter-spacing: .22em; text-transform: uppercase; }
  .wm a { color: inherit; text-decoration: none; }
  h1 { margin: 0 0 12px; font-size: clamp(1.6rem, 1.2rem + 1.5vw, 2.2rem); font-weight: 520; line-height: 1.1; letter-spacing: -.01em; }
  p { margin: 0 0 28px; font-size: 1.0625rem; line-height: 1.55; color: #3d3d3a; }
  form { margin: 0; }
  button, .btn { display: inline-block; border: 0; cursor: pointer; background: #141413; color: #FAFAF8; font: inherit;
                 font-weight: 520; font-size: 1rem; padding: 14px 24px; border-radius: 999px; text-decoration: none; }
  button:hover, .btn:hover { background: #2b2b29; }
  button:focus-visible, .btn:focus-visible { outline: 3px solid #FFEE25; outline-offset: 3px; }
  .note { margin: 28px 0 0; font-size: .8125rem; color: #6b6a66; }
</style></head>
<body><main>
<p class="wm"><a href="${esc(`${origin}${p.home}`)}">Stratos</a></p>
<h1>${esc(title)}</h1>
<p>${esc(text)}</p>
${action}
<p class="note">${esc(SENDER)}</p>
</main></body></html>`;
}

/* ================================================================ webhook */

/**
 * Resend signs its webhooks the Svix way: HMAC-SHA256 over
 * `${svix-id}.${svix-timestamp}.${raw body}` with the base64 key after
 * `whsec_`, sent as space-separated `v1,<base64>` signatures. Five minutes of
 * clock skew at most, so an old delivery cannot be replayed.
 */
export function verifyWebhook({ secret, id, timestamp, signature, body, now = Date.now() }) {
  if (!secret || !id || !timestamp || !signature || typeof body !== 'string') return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now / 1000 - ts) > 300) return false;
  let key;
  try { key = Buffer.from(String(secret).replace(/^whsec_/, ''), 'base64'); } catch { return false; }
  if (key.length === 0) return false;
  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest();
  return String(signature).split(' ').some((part) => {
    const [version, sig] = part.split(',');
    if (version !== 'v1' || !sig) return false;
    const given = Buffer.from(sig, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}
