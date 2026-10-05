// =============================================================================
// What a notification SAYS — e-mail subject and body, push title and body —
// in Hungarian, English and German. Pure: no imports, no network, so a test
// renders every kind in every language (tests/notify.spec.ts).
//
// Clients are addressed informally ("te" / "du"), like the client portal; the
// owner gets short operational lines. Every text value that came from a person
// (a file name, a feedback excerpt) is HTML-escaped where it goes into HTML.
// =============================================================================

export const LANGS = ['hu', 'en', 'de'];
export const pickLang = (locale, fallback) => (LANGS.includes(locale) ? locale : fallback);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** A date and time in Budapest (or the meeting's zone), in the reader's language. */
export function when(iso, lang, zone = 'Europe/Budapest') {
  if (!iso) return '';
  try {
    return new Intl.DateTimeFormat({ hu: 'hu-HU', en: 'en-GB', de: 'de-DE' }[lang], {
      timeZone: zone, year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

// One line per message: [hu, en, de]. `{x}` placeholders are filled from ctx.
const LINES = {
  // ---- to the owner
  client_upload: ['{client} feltöltött egy fájlt: {name} ({project})', '{client} uploaded a file: {name} ({project})', '{client} hat eine Datei hochgeladen: {name} ({project})'],
  client_feedback: ['{client} észrevételt írt a demóhoz ({project}): „{excerpt}”', '{client} wrote feedback on the demo ({project}): “{excerpt}”', '{client} hat Feedback zur Demo geschrieben ({project}): „{excerpt}“'],
  client_reschedule: ['{client} új időpontot javasol ({project}): {when}', '{client} proposes a new time ({project}): {when}', '{client} schlägt einen neuen Termin vor ({project}): {when}'],
  client_reschedule_withdrawn: ['{client} visszavonta az időpont-javaslatát ({project})', '{client} withdrew their proposed time ({project})', '{client} hat den Terminvorschlag zurückgezogen ({project})'],
  test: ['Próbaértesítés — ha ezt látod, az értesítések működnek.', 'Test notification — if you can see this, notifications work.', 'Testbenachrichtigung — wenn Sie das sehen, funktionieren die Benachrichtigungen.'],
  // ---- to a client
  document_shared: ['Új dokumentumot osztottunk meg veled: {name}', 'We shared a new document with you: {name}', 'Wir haben ein neues Dokument mit dir geteilt: {name}'],
  demo_published: ['Elkészült egy új demó: {title}', 'A new demo is ready: {title}', 'Eine neue Demo ist fertig: {title}'],
  meeting_scheduled: ['Új megbeszélés: {title} — {when}', 'New meeting: {title} — {when}', 'Neuer Termin: {title} — {when}'],
  meeting_changed: ['Módosult a megbeszélés: {title} — {when}', 'The meeting has changed: {title} — {when}', 'Der Termin hat sich geändert: {title} — {when}'],
  meeting_cancelled: ['Elmarad a megbeszélés: {title} ({when})', 'The meeting is cancelled: {title} ({when})', 'Der Termin fällt aus: {title} ({when})'],
  reschedule_decided: ['Válaszoltunk az időpont-javaslatodra: {decision}', 'We answered your proposed time: {decision}', 'Wir haben auf deinen Terminvorschlag geantwortet: {decision}'],
  feedback_replied: ['Válaszoltunk az észrevételedre: „{reply}”', 'We replied to your feedback: “{reply}”', 'Wir haben auf dein Feedback geantwortet: „{reply}“'],
};

const DECISION = { accepted: ['elfogadva', 'accepted', 'angenommen'], declined: ['nem fogadtuk el', 'declined', 'abgelehnt'] };

const COPY = {
  ownerSubject: ['Stratos portál: {n} új esemény', 'Stratos portal: {n} new events', 'Stratos-Portal: {n} neue Ereignisse'],
  ownerSubjectOne: ['Stratos portál: {line}', 'Stratos portal: {line}', 'Stratos-Portal: {line}'],
  clientSubject: ['Újdonság a Stratos ügyfélportálon', 'News in your Stratos client portal', 'Neuigkeiten in deinem Stratos-Kundenportal'],
  greeting: ['Szia {name}!', 'Hi {name},', 'Hallo {name},'],
  clientIntro: ['Az ügyfélportálodon új dolog vár:', 'There is something new in your client portal:', 'In deinem Kundenportal gibt es etwas Neues:'],
  ownerIntro: ['A portálon ez történt:', 'This happened in the portal:', 'Das ist im Portal passiert:'],
  open: ['Megnyitom a portált', 'Open the portal', 'Portal öffnen'],
  clientFooter: ['Ezt az e-mailt a Stratos ügyfélportál küldte. Ha válaszolsz rá, a leveled a Stratoshoz érkezik.', 'This e-mail was sent by the Stratos client portal. If you reply, your message reaches Stratos.', 'Diese E-Mail kommt vom Stratos-Kundenportal. Wenn du antwortest, geht deine Nachricht an Stratos.'],
  ownerFooter: ['Stratos portál — értesítés', 'Stratos portal — notification', 'Stratos-Portal — Benachrichtigung'],
  pushMany: ['{n} új esemény a portálon', '{n} new events in the portal', '{n} neue Ereignisse im Portal'],
  someone: ['Egy ügyfél', 'A client', 'Ein Kunde'],
};

const L = { hu: 0, en: 1, de: 2 };
const fill = (s, ctx) => s.replace(/\{(\w+)\}/g, (_, k) => (ctx[k] === undefined || ctx[k] === null ? '' : String(ctx[k])));
const copy = (key, lang, ctx = {}) => fill(COPY[key][L[lang]], ctx);

/** One message as one line, in `lang`. */
export function line(msg, lang) {
  const p = msg.payload ?? {};
  const i = L[lang];
  const ctx = {
    client: p.client_name || msg.client_name || COPY.someone[i],
    project: msg.project_name ?? '',
    name: p.name ?? '',
    title: p.title ?? '',
    excerpt: String(p.excerpt ?? '').slice(0, 160),
    reply: String(p.reply ?? '').slice(0, 200),
    when: p.starts_at ? when(p.starts_at, lang, p.time_zone || 'Europe/Budapest') : '',
    decision: DECISION[p.decision]?.[i] ?? '',
  };
  return fill((LINES[msg.kind] ?? LINES.test)[i], ctx).replace(/\s+\(\)$/, '');
}

/** Where a message takes its reader in the portal. */
export function target(msg, audience) {
  if (audience === 'client') {
    if (msg.kind === 'document_shared') return '/portal/megosztott';
    return '/portal/';
  }
  if (msg.project_id) return `/portal/projects/${msg.project_id}`;
  return '/portal/';
}

/**
 * Several messages to ONE recipient, as one e-mail and one push.
 * `audience` is 'owner' or 'client'; `origin` is e.g. https://stratosweb.hu.
 */
export function compose(messages, { audience, lang, name, origin }) {
  const lines = messages.map((m) => line(m, lang));
  const url = `${origin}${messages.length === 1 ? target(messages[0], audience) : (audience === 'client' ? '/portal/' : '/portal/today')}`;
  const subject = audience === 'client'
    ? copy('clientSubject', lang)
    : (lines.length === 1 ? copy('ownerSubjectOne', lang, { line: lines[0] }).slice(0, 150) : copy('ownerSubject', lang, { n: lines.length }));
  const greeting = audience === 'client' && name ? copy('greeting', lang, { name }) : '';
  const intro = copy(audience === 'client' ? 'clientIntro' : 'ownerIntro', lang);
  const footer = copy(audience === 'client' ? 'clientFooter' : 'ownerFooter', lang);
  const button = copy('open', lang);

  const text = [greeting, intro, '', ...lines.map((l) => `• ${l}`), '', `${button}: ${url}`, '', '—', footer]
    .filter((x, i) => x !== '' || i > 0).join('\n');
  const html = `<!doctype html><html lang="${lang}"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#0b0d12">
<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e5ea;border-radius:6px;padding:28px">
<p style="margin:0 0 18px;font-size:13px;letter-spacing:4px;color:#0b0d12">STRATOS</p>
${greeting ? `<p style="margin:0 0 12px;font-size:15px">${esc(greeting)}</p>` : ''}
<p style="margin:0 0 12px;font-size:15px">${esc(intro)}</p>
<ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.5">${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p style="margin:0 0 24px"><a href="${esc(url)}" style="display:inline-block;background:#f5d90a;color:#0b0d12;text-decoration:none;padding:10px 16px;border-radius:4px;font-size:14px;font-weight:bold">${esc(button)}</a></p>
<p style="margin:0;font-size:12px;color:#5b6170">${esc(footer)}</p>
</div></body></html>`;

  const push = lines.length === 1
    ? { title: 'Stratos', body: lines[0].slice(0, 180), url }
    : { title: 'Stratos', body: copy('pushMany', lang, { n: lines.length }), url };
  return { subject, text, html, push };
}
