// =============================================================================
// The client help assistant's matcher — pure, no imports, no network.
//
// It answers ONLY from the published help articles it is given
// (client_help_articles()). No external AI, nothing stored: the conversation
// lives in the page's memory and is gone on reload.
//
// How a question is matched:
//   1. normalise: lower case, accents removed (ő→o, ű→u …), punctuation out;
//   2. tokens: drop Hungarian function words, cut common suffixes (a light
//      stemmer: "fájlokat" → "fajl", "naptáramba" → "naptar");
//   3. score each article: how much of the question's (IDF-weighted) meaning
//      its question or any alternative phrasing covers, plus a smaller share
//      from its answer text;
//   4. decide: a clear winner → the answer; close runners-up or a middling
//      score → "Erre gondoltál?" with the candidates; too little → an honest
//      "no ready answer" and the topics.
// =============================================================================

export interface HelpTranslation {
  question: string;
  answer: string;
  topic: string;
  alt_questions?: string[];
}

export interface HelpArticle {
  article_id: string;
  question: string;
  answer: string;
  topic: string;
  alt_questions: string[];
  /** English and German (20261010000100_help_translations.sql). */
  translations?: Partial<Record<'en' | 'de', HelpTranslation>> | null;
  /** The Hungarian topic, kept by `localise` for grouping that keys on it. */
  source_topic?: string;
}

/**
 * The articles as a reader of `lang` sees them: each one's English or German
 * text where it has one, its Hungarian otherwise. Matching then runs on the
 * same text the answer is shown in. `source_topic` keeps the Hungarian topic.
 */
export function localise(articles: HelpArticle[], lang: string | null): HelpArticle[] {
  return articles.map((a) => {
    const tr = lang === 'en' || lang === 'de' ? a.translations?.[lang] : undefined;
    if (!tr) return { ...a, source_topic: a.topic };
    return {
      ...a,
      question: tr.question,
      answer: tr.answer,
      topic: tr.topic,
      alt_questions: tr.alt_questions ?? [],
      source_topic: a.topic,
    };
  });
}

/** Whether every article has a text in `lang` (Hungarian always does). */
export const fullyTranslated = (articles: HelpArticle[], lang: string | null) =>
  lang !== 'en' && lang !== 'de' ? true : articles.every((a) => Boolean(a.translations?.[lang]));

export type HelpReply =
  | { kind: 'answer'; article: HelpArticle; related: HelpArticle[]; score: number }
  | { kind: 'clarify'; options: HelpArticle[]; score: number }
  | { kind: 'unknown'; topics: string[]; score: number };

const STOP = new Set([
  'a', 'az', 'egy', 'es', 'is', 'hogy', 'van', 'vannak', 'nincs', 'nem', 'de', 'mi', 'mit', 'mik', 'hol', 'hova', 'honnan',
  'hogyan', 'mikor', 'meg', 'ha', 'ki', 'kell', 'lehet', 'tudok', 'tudom', 'tudunk', 'en', 'te', 'ti', 'mi', 'ez', 'az', 'azt',
  'ezt', 'vagy', 'mar', 'csak', 'fel', 'be', 'le', 'el', 'at', 'ra', 're', 'ba', 'be', 'nal', 'nel', 'mert', 'mint', 'akkor',
  'itt', 'ott', 'ezzel', 'azzal', 'nekem', 'neked', 'engem', 'vele', 'velem', 'kerem', 'szeretnek', 'szeretném', 'szeretnem',
  'kerdes', 'kerdezni', 'milyen', 'melyik', 'mennyi', 'minden', 'sok', 'jo', 'olyan', 'amit', 'ami', 'aki', 'hanem', 'tehat',
  'most', 'pedig', 'vajon', 'lesz', 'volt', 'lenne', 'valami', 'barmi', 'kapok', 'kaphatok', 'tudnatok', 'tudtok', 'tudsz',
  'egyaltalan', 'eleg', 'sem', 'se', 'meddig', 'miert', 'hany', 'ide', 'oda', 'ot',
  // English and German function words, for the translated articles. None of
  // them is a Hungarian content word the articles depend on.
  'the', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'my', 'your', 'can', 'could', 'do', 'does', 'how',
  'what', 'where', 'when', 'which', 'who', 'why', 'are', 'was', 'it', 'this', 'that', 'there', 'have', 'has', 'get',
  'would', 'should', 'want', 'need', 'from', 'about', 'any', 'me', 'we', 'you', 'our', 'will',
  'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'und', 'oder', 'ich', 'du', 'sie', 'wir', 'ihr',
  'mein', 'meine', 'dein', 'deine', 'wie', 'was', 'wo', 'wann', 'wer', 'warum', 'welche', 'welcher', 'kann', 'ist',
  'sind', 'zu', 'zum', 'zur', 'im', 'ins', 'auf', 'von', 'fur', 'nicht', 'auch', 'noch', 'ob', 'bei', 'mir', 'mich',
]);

const SUFFIXES = [
  'jaimat', 'eimet', 'aimat', 'ainkat', 'einket', 'jainkat', 'unkat', 'unket', 'okat', 'eket', 'akat', 'oket',
  'omat', 'emet', 'amat', 'imat', 'jat', 'jet', 'mat', 'met',
  'jaim', 'aimban', 'ban', 'ben', 'bol', 'rol', 'tol', 'nak', 'nek', 'val', 'vel', 'hoz', 'hez', 'kor', 'ert',
  'ig', 'ra', 're', 'ba', 'be', 'on', 'en', 'ot', 'at', 'et', 'ok', 'ek', 'ak', 'ja', 'je', 'om', 'am', 'em',
  'nk', 'ai', 'ei', 'id', 'unk', 'ni', 'es', 'as', 'os', 't', 'k', 'm', 's',
];

/** Verb prefixes: "feltöltés", "letöltés", "visszajelzés" share their core with "töltsem", "jelez". */
const PREFIXES = ['vissza', 'ossze', 'fel', 'meg', 'le', 'be', 'ki', 'at', 'el'];

export function normalise(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}

export function stem(word: string): string {
  let w = word;
  const prefix = PREFIXES.find((p) => w.startsWith(p) && w.length - p.length >= 5);
  if (prefix) w = w.slice(prefix.length);
  for (let pass = 0; pass < 2; pass += 1) {
    const suffix = SUFFIXES.find((s) => w.endsWith(s) && w.length - s.length >= 4);
    if (!suffix) break;
    w = w.slice(0, -suffix.length);
  }
  return w;
}

export function tokens(s: string): string[] {
  return normalise(s).split(' ').filter((w) => w.length >= 2 && !STOP.has(w)).map(stem);
}

/**
 * Two stems are the same word if equal, if one begins the other (≥ 4
 * letters), or if they share all but the last two letters of the shorter one
 * (≥ 6 letters): "feltolteni" ~ "feltoltes", "javitott" ~ "javitas".
 */
function same(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  if (a.startsWith(b) || b.startsWith(a)) return true;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i >= 6 && i >= Math.min(a.length, b.length) - 2;
}

export interface HelpIndex {
  articles: HelpArticle[];
  phrasings: string[][][]; // per article: [question tokens, ...alternative tokens]
  answers: string[][];
  topics: string[][];
  idf: (t: string) => number;
}

export function buildIndex(articles: HelpArticle[]): HelpIndex {
  const phrasings = articles.map((a) => [a.question, ...a.alt_questions].map(tokens));
  const answers = articles.map((a) => tokens(a.answer));
  // The topic's words are never MISSING from an article ("Impact Program" in a
  // question about the Impact Program's "Is it really free?"), but they add
  // nothing to its score — a score from the topic would reorder articles across
  // topics.
  const topics = articles.map((a) => tokens(a.topic));
  const docs = articles.map((_, i) => new Set([...phrasings[i].flat(), ...answers[i]]));
  const n = Math.max(articles.length, 1);
  const cache = new Map<string, number>();
  const idf = (t: string) => {
    if (!cache.has(t)) {
      const df = docs.filter((d) => [...d].some((x) => same(x, t))).length;
      cache.set(t, Math.log(1 + n / (1 + df)));
    }
    return cache.get(t)!;
  };
  return { articles, phrasings, answers, topics, idf };
}

function coverage(query: string[], target: string[], idf: (t: string) => number): number {
  const total = query.reduce((s, t) => s + idf(t), 0);
  if (total === 0) return 0;
  const hit = query.reduce((s, t) => s + (target.some((x) => same(x, t)) ? idf(t) : 0), 0);
  return hit / total;
}

export function scoreAll(index: HelpIndex, question: string): { article: HelpArticle; score: number; missing: string[] }[] {
  const q = [...new Set(tokens(question))];
  if (q.length === 0) return [];
  return index.articles.map((article, i) => {
    const best = Math.max(...index.phrasings[i].map((p) => {
      const forward = coverage(q, p, index.idf);
      // A phrasing that is mostly made of the question's words is a closer fit
      // than a long one that merely contains them.
      const backward = coverage(p, q, index.idf);
      return 0.75 * forward + 0.25 * backward;
    }));
    const fromAnswer = coverage(q, index.answers[i], index.idf);
    // Distinctive words of the question that this article does not mention at
    // all — "weboldal" asked, a webshop article found. Such a match is never
    // given as THE answer (see reply()).
    const covered = [...index.phrasings[i].flat(), ...index.answers[i], ...index.topics[i]];
    const missing = q.filter((t) => index.idf(t) >= DISTINCTIVE && !covered.some((x) => same(x, t)));
    return { article, score: Math.min(1, best + 0.2 * fromAnswer), missing };
  }).sort((a, b) => b.score - a.score);
}

/** A word is distinctive when fewer than roughly half the articles use it. */
export const DISTINCTIVE = 1.0;

export const THRESHOLD = { answer: 0.6, clarify: 0.4, margin: 0.08 };

export function reply(index: HelpIndex, question: string): HelpReply {
  // Asked word for word (a suggested question, or typed exactly): that article.
  const asked = normalise(question);
  const exact = asked ? index.articles.find((a) => [a.question, ...a.alt_questions].some((p) => normalise(p) === asked)) : undefined;
  if (exact) {
    const related = index.articles.filter((a) => a.topic === exact.topic && a.article_id !== exact.article_id).slice(0, 3);
    return { kind: 'answer', article: exact, related, score: 1 };
  }
  const ranked = scoreAll(index, question);
  const top = ranked[0];
  if (!top || top.score < THRESHOLD.clarify) {
    return { kind: 'unknown', topics: [...new Set(index.articles.map((a) => a.topic))], score: top?.score ?? 0 };
  }
  const close = ranked.filter((r) => r.score >= THRESHOLD.clarify && top.score - r.score < THRESHOLD.margin);
  if (top.score >= THRESHOLD.answer && close.length === 1 && top.missing.length === 0) {
    const related = ranked.slice(1).filter((r) => r.article.topic === top.article.topic || r.score >= THRESHOLD.clarify)
      .slice(0, 3).map((r) => r.article);
    return { kind: 'answer', article: top.article, related, score: top.score };
  }
  return { kind: 'clarify', options: ranked.filter((r) => r.score >= THRESHOLD.clarify).slice(0, 3).map((r) => r.article), score: top.score };
}
