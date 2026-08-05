#!/usr/bin/env python3
"""
Stratos — translation engine.

The Hungarian pages in _build/pages/ are the single source of markup. English
and German are produced by swapping *text* inside that markup, so the layout,
the SVG art and the questionnaire logic exist exactly once.

A "unit" is one translatable string. Units are found at three levels:

  1. block leaves — the whole inner HTML of a <p>, <h2>, <li>… that contains no
     other block element. Inline tags (<span>, <br>, <a>) stay inside the unit
     so a translation can reorder them freely, which German needs constantly.
  2. loose text runs — text between tags that no block leaf covered
     (<span class="card__k">…</span> sitting straight in an <article>).
  3. attributes — alt, title, placeholder, aria-label.

<script> blocks are handled separately: quoted JS literals and the text inside
template literals. Replacement there is dictionary-driven and single-pass, so a
translated string is never re-translated.

Anything missing from the dictionary falls through untouched, and build.py
reports it — an untranslated page is visibly Hungarian, never broken.
"""
import re
import unicodedata

BLOCK_TAGS = ('h1|h2|h3|h4|h5|h6|p|li|figcaption|blockquote|button|label'
              '|summary|dt|dd|th|td|legend|caption')
CONTAINER = (BLOCK_TAGS + '|div|section|article|aside|header|footer|nav|main'
             '|ul|ol|dl|table|thead|tbody|tr|form|figure|svg|script|style|details')

# Any tag, for asking whether a chunk has text of its own.
_TAGS = re.compile(r'<[^>]*>')

BLOCK_RE = re.compile(r'<(' + BLOCK_TAGS + r')\b[^>]*>(.*?)</\1\s*>', re.S | re.I)
HAS_BLOCK = re.compile(r'</?(' + CONTAINER + r')\b', re.S | re.I)
TEXT_RUN = re.compile(r'>([^<>]+)<')
ATTR_RE = re.compile(r'\b(alt|title|placeholder|aria-label)="([^"]*)"')
SCRIPT_RE = re.compile(r'(<script\b[^>]*>)(.*?)(</script>)', re.S | re.I)
STYLE_RE = re.compile(r'(<style\b[^>]*>)(.*?)(</style>)', re.S | re.I)

JS_QUOTED = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"")
JS_TEMPLATE = re.compile(r'`((?:[^`\\]|\\.)*)`', re.S)

# Words that look translatable but are markup/technical plumbing.
SKIP_EXACT = {
    'text', 'tel', 'email', 'radio', 'check', 'consent', 'textarea', 'inp',
    'err', 'other', 'prev', 'next', 'start', 'retry', 'bar', 'app', 'r',
    'button', 'checkbox', 'hidden', 'POST', 'Content-Type', 'application/json',
    'Accept', 'keydown', 'Enter', 'TEXTAREA', 'change', 'click', 'a, button',
    '/api/lead', 'questionnaire', 'company_website', 'Company website',
    'hp-quiz', 'index.html', 'hu', '\\n', '\\n\\n',
    # stored in the lead's service_interest column, so it stays one value
    # in every language rather than three
    'Igényfelmérő – KKV', 'Igényfelmérő – nagyvállalat',
    'width', 'style', 'show', 'selected', 'checked', 'value', 'span',
    '.opt input', '.opt', '.other-input', 'label.opt', 'input',
    'lukacs.artur@media-stratos.com', 'Stratos', 'GDPR', 'SEO', 'CRM', 'ERP',
    'SAP', 'HubSpot', 'Salesforce', 'LinkedIn', 'Instagram', 'Facebook',
    'TikTok', 'Google', 'Meta', 'B2B', 'B2C', 'ISO', 'WCAG', 'NDA', 'API',
    'SLA', 'SSO', 'BI', 'IT',
    # Organisation names carried by logo alt text. A company's name is not
    # translated into German, and the alt text has to match the mark it
    # describes in every locale.
    'Kontyos.hu', 'Grantool Kft.', 'Synergy Digital Hungary Kft.', 'HAIO',
    'FICE', 'Duna Hajók', 'Duna Enterior', 'Rapidkert Kft.',
    'Barbershop Győr',
    # Identifiers from the questionnaire's inline wizard, not copy. The
    # extractor deliberately reads <script> because the wizard's buttons and
    # labels live there and do need translating; an element id and two class
    # names do not, and a German "is-at" would simply stop the progress path
    # lighting up.
    'path', 'is-past', 'is-at',
    # The locale-invariant branch identifier the questionnaire sends as
    # `fields.agazat`. It is compared by the server against a fixed enum (see
    # FORMS.questionnaire in netlify/functions/lead-contract.mjs) and is never
    # shown to anyone; translating it would make the German questionnaire fail
    # validation. The visitor-facing branch label is `szegmens`, which *is*
    # translated.
    'kkv', 'nagyvallalat',
    # questionnaire state keys — these are looked up by ans('…'), never shown
    'szegmens', 'cegnev', 'funkciok', 'konstrukcio', 'konzultacio',
    'kitolto', 'telefon', 'weboldal', 'weboldal_nagy', 'hatarido',
    'hatarido_nagy', 'koltsegkeret', 'koltsegkeret_nagy', 'havidij',
    # wizard end-state keys — the visible copy lives in DONE_HTML, not here
    'submitting', 'success', 'invalid', 'limited', 'error', 'retry', 'fix',
    'quiz__hint',
    '&amp;', '&lt;', '&gt;', '&quot;', '&nbsp;',
}

# Never prose: CSS selectors, hex colours, bare URLs, and the stray fragment the
# JS literal scanner produces from the character class in /[&<>"]/g.
NEVER = re.compile(r'''^(?:
      \#[0-9A-Fa-f]{3,8}                 # colour code
    | https?://\S*                       # bare URL
    | [.\#\[][\w\-.\#\[\]=:,()>+~ ]*     # CSS selector
    | input\[type=.*                     # the wizard's field selector
    | \]/g,.*                            # scanner artefact, see module docstring
)$''', re.X)


def normalise(s):
    """Collapse whitespace so a key survives re-indentation of the markup."""
    return re.sub(r'\s+', ' ', s).strip()


def translatable(s):
    s = normalise(s)
    if len(s) < 2 or s in SKIP_EXACT or NEVER.match(s):
        return False
    # needs at least one cased letter to be prose
    return any(unicodedata.category(c) in ('Ll', 'Lu') for c in s)


def _leaf_spans(src, base=0, out=None):
    """Character ranges of block-leaf inner HTML, in source order."""
    if out is None:
        out = []
    for m in BLOCK_RE.finditer(src):
        inner = m.group(2)
        if HAS_BLOCK.search(inner):
            _leaf_spans(inner, base + m.start(2), out)
        elif normalise(_TAGS.sub('', inner)):
            # A leaf with actual text is one unit, so a sentence broken across
            # <b> and <em> is translated whole rather than in fragments.
            out.append((base + m.start(2), base + m.end(2)))
        # A leaf holding only markup — a logo <li> that is one <img>, a figure
        # that is one <svg> — has no sentence in it. Claiming it as a unit put
        # the whole `<img src=... alt="Kontyos.hu">` tag into missing-en.json as
        # a string to translate. Left alone here it falls through to the gap
        # path, which translates the alt attribute on its own, correctly.
    return out


def _gaps(length, spans):
    """Complement of `spans` over [0, length)."""
    out, cur = [], 0
    for a, b in sorted(spans):
        if a > cur:
            out.append((cur, a))
        cur = max(cur, b)
    if cur < length:
        out.append((cur, length))
    return out


def _attr_safe(text):
    """A translation is dropped into `attr="..."`, so a straight double quote in
    it closes the attribute early and the rest of the sentence becomes stray
    tag soup.

    This is not hypothetical: the English alt text for the Rapidkert screenshot
    quoted the client's own headline, which silently produced a malformed
    <img> — the browser recovered, the page looked fine, and the generator's
    image-dimension stamper simply stopped matching that tag, so the one route
    that needed intrinsic sizes most lost them without a single error.

    Escaping here rather than asking every translator to remember: the
    dictionaries are prose, and prose contains quotation marks.
    """
    return text.replace('"', '&quot;')


def _walk_markup(src, on_unit):
    """Rewrite `src`, handing every translatable unit to on_unit(text) -> text."""
    spans = _leaf_spans(src)
    pieces, cursor = [], 0

    def gap_text(chunk):
        def sub_run(m):
            raw = m.group(1)
            return '>' + on_unit(raw) + '<' if translatable(raw) else m.group(0)

        def sub_attr(m):
            raw = m.group(2)
            return (f'{m.group(1)}="{_attr_safe(on_unit(raw))}"'
                    if translatable(raw) else m.group(0))

        return ATTR_RE.sub(sub_attr, TEXT_RUN.sub(sub_run, chunk))

    for a, b in sorted(spans):
        if a < cursor:
            continue
        pieces.append(gap_text(src[cursor:a]))
        raw = src[a:b]
        pieces.append(on_unit(raw) if translatable(raw) else raw)
        cursor = b
    pieces.append(gap_text(src[cursor:]))
    return ''.join(pieces)


# After one of these, a `/` opens a regular expression rather than dividing.
# Without this the character class in /[&<>"]/g would read as a string opener.
_REGEX_AFTER = set('(,=:[!&|?{};+-*%~^<>') | {''}


HTMLISH = re.compile(r'<[a-zA-Z/][^<>]*>')


def _markup_chunk(chunk, on_unit):
    """Translate the text runs and attributes of a piece of markup."""
    chunk = TEXT_RUN.sub(
        lambda t: '>' + on_unit(t.group(1)) + '<'
        if translatable(t.group(1)) else t.group(0), chunk)
    return ATTR_RE.sub(
        lambda a: '%s="%s"' % (a.group(1), _attr_safe(on_unit(a.group(2))))
        if translatable(a.group(2)) else a.group(0), chunk)


def _rewrite_js(s, on_unit, i=0, stop=None):
    """Rewrite a run of JavaScript, returning (text, index_stopped_at).

    Walks the source rather than pattern-matching it, because the strings that
    need translating live at every nesting level: plain literals, template
    literals, and literals inside a template's ${…} interpolations. `stop='}'`
    makes it return at the brace that closes an interpolation.
    """
    out, n, prev, depth = [], len(s), '', 0
    while i < n:
        c = s[i]
        if stop == '}' and c == '}':
            if not depth:
                return ''.join(out), i
            depth -= 1
        elif c == '{':
            depth += 1

        if c == '/' and s[i:i + 2] == '//':
            j = s.find('\n', i)
            j = n if j < 0 else j
            out.append(s[i:j]); i = j; continue
        if c == '/' and s[i:i + 2] == '/*':
            j = s.find('*/', i + 2)
            j = n if j < 0 else j + 2
            out.append(s[i:j]); i = j; continue
        if c == '/' and prev in _REGEX_AFTER:
            j, in_class = i + 1, False
            while j < n:
                d = s[j]
                if d == '\\':
                    j += 2; continue
                if d == '\n':
                    break
                if d == '[':
                    in_class = True
                elif d == ']':
                    in_class = False
                elif d == '/' and not in_class:
                    break
                j += 1
            out.append(s[i:j + 1]); i = j + 1; prev = '/'; continue

        if c in '\'"':
            j = i + 1
            while j < n:
                d = s[j]
                if d == '\\':
                    j += 2; continue
                if d == c or d == '\n':
                    break
                j += 1
            raw = s[i + 1:j]
            # a literal that carries markup gets its text runs translated, not
            # the whole string — e.g. '<button id="prev">Vissza</button>'
            new = _markup_chunk(raw, on_unit) if HTMLISH.search(raw) else (
                on_unit(raw) if translatable(raw) else raw)
            if new != raw:
                raw = new.replace('\\', '\\\\').replace(c, '\\' + c)
            out.append(c + raw + c); i = j + 1; prev = c; continue

        if c == '`':
            body, i = _rewrite_template(s, i + 1, on_unit)
            out.append('`' + body + '`'); prev = '`'; continue

        out.append(c)
        if not c.isspace():
            prev = c
        i += 1
    return ''.join(out), i


def _rewrite_template(s, i, on_unit):
    """Rewrite a template literal body; returns (body, index_after_backtick)."""
    out, lit = [], []

    def flush():
        if not lit:
            return
        chunk = ''.join(lit)
        del lit[:]
        out.append(_markup_chunk(chunk, on_unit))

    n = len(s)
    while i < n:
        c = s[i]
        if c == '\\':
            lit.append(s[i:i + 2]); i += 2; continue
        if c == '`':
            flush(); return ''.join(out), i + 1
        if s[i:i + 2] == '${':
            flush()
            inner, j = _rewrite_js(s, on_unit, i + 2, stop='}')
            out.append('${' + inner + '}')
            i = j + 1; continue
        lit.append(c); i += 1
    flush()
    return ''.join(out), i


def _walk_script(src, on_unit):
    return _rewrite_js(src, on_unit)[0]


def transform(src, on_unit):
    """Run on_unit over every translatable string in a page fragment."""
    parts, cursor = [], 0
    for m in re.finditer(SCRIPT_RE.pattern + '|' + STYLE_RE.pattern,
                         src, re.S | re.I):
        parts.append(_walk_markup(src[cursor:m.start()], on_unit))
        if m.group(1):                                    # <script>
            parts.append(m.group(1) + _walk_script(m.group(2), on_unit) + m.group(3))
        else:                                             # <style> — never text
            parts.append(m.group(0))
        cursor = m.end()
    parts.append(_walk_markup(src[cursor:], on_unit))
    return ''.join(parts)


def collect(src):
    """Every translatable unit in a fragment, de-duplicated, in source order."""
    seen, order = set(), []

    def note(raw):
        key = normalise(raw)
        if key not in seen:
            seen.add(key)
            order.append(key)
        return raw

    transform(src, note)
    return order


def apply(src, table, missing=None):
    """Return `src` with every unit replaced from `table` (key -> translation)."""
    def swap(raw):
        key = normalise(raw)
        if key in table:
            return table[key]
        if missing is not None and key not in missing:
            missing.append(key)
        return raw

    return transform(src, swap)
