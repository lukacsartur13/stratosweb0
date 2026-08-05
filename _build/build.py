#!/usr/bin/env python3
"""
Stratos — static page generator, three languages.

Hungarian is the source language: _build/pages/*.html holds the only copy of
the markup. English and German are generated from it by swapping text through
_build/i18n/en.json and de.json (see _build/i18n.py for how units are found).

    python3 _build/build.py

Output:
    /*.html      Hungarian
    /en/*.html   English
    /de/*.html   German

Nothing at runtime depends on this script; the result is a plain static site.
"""
import json
import os
import re
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import i18n as tr

ROOT = Path(__file__).resolve().parent.parent
PAGES = Path(__file__).resolve().parent / "pages"
DICTS = Path(__file__).resolve().parent / "i18n"

LANGS = ("hu", "en", "de")

# canonical key -> filename per language. The Hungarian name is also the name
# used in hrefs inside the fragments, so it doubles as the lookup key.
SLUGS = {
    "index":       {"hu": "index.html",                    "en": "index.html",                 "de": "index.html"},
    "about":       {"hu": "rolunk.html",                   "en": "about.html",                 "de": "ueber-uns.html"},
    "services":    {"hu": "szolgaltatasok.html",           "en": "services.html",              "de": "leistungen.html"},
    "sme":         {"hu": "kkv.html",                      "en": "web-design-sme.html",        "de": "webdesign-kmu.html"},
    "enterprise":  {"hu": "nagyvallalat.html",             "en": "web-design-enterprise.html", "de": "webdesign-grossunternehmen.html"},
    "branding":    {"hu": "branding.html",                 "en": "branding.html",              "de": "branding.html"},
    "ads":         {"hu": "hirdeteskezeles.html",          "en": "ads-management.html",        "de": "werbeanzeigen.html"},
    "impact":      {"hu": "impact-program.html",           "en": "impact-program.html",        "de": "impact-programm.html"},
    "work":        {"hu": "munkaink.html",                 "en": "work.html",                  "de": "projekte.html"},
    "case-rapidkert":    {"hu": "munka-rapidkert.html",    "en": "work-rapidkert.html",        "de": "projekt-rapidkert.html"},
    "case-barbershop":   {"hu": "munka-barbershop.html",   "en": "work-barbershop.html",       "de": "projekt-barbershop.html"},
    "case-mentaltrening": {"hu": "munka-mentaltrening.html", "en": "work-mentaltrening.html",  "de": "projekt-mentaltrening.html"},
    "blog":        {"hu": "blog.html",                     "en": "blog.html",                  "de": "blog.html"},
    "post-seo":       {"hu": "blog-google-elso-oldal.html",     "en": "blog-google-first-page.html",       "de": "blog-google-erste-seite.html"},
    "post-arak":      {"hu": "blog-weboldal-arak.html",         "en": "blog-website-cost.html",            "de": "blog-website-kosten.html"},
    "post-cegprofil": {"hu": "blog-google-cegprofil.html",      "en": "blog-google-business-profile.html", "de": "blog-google-unternehmensprofil.html"},
    "post-hirdetes":  {"hu": "blog-google-vagy-facebook.html",  "en": "blog-google-or-facebook.html",      "de": "blog-google-oder-facebook.html"},
    "post-elavult":   {"hu": "blog-elavult-weboldal.html",      "en": "blog-outdated-website.html",        "de": "blog-veraltete-website.html"},
    "post-konverzio": {"hu": "blog-miert-nem-hoz-ugyfelet.html", "en": "blog-no-enquiries.html",           "de": "blog-keine-anfragen.html"},
    "contact":     {"hu": "ugyfelszolgalat.html",          "en": "contact.html",               "de": "kontakt.html"},
    "quote":       {"hu": "arajanlat.html",                "en": "quote.html",                 "de": "angebot.html"},
    "privacy":     {"hu": "adatkezelesi-tajekoztato.html", "en": "privacy-policy.html",        "de": "datenschutz.html"},
    "imprint":     {"hu": "impresszum.html",               "en": "imprint.html",               "de": "impressum.html"},
}
BY_HU = {v["hu"]: k for k, v in SLUGS.items()}

NAV = ("about", "work", "blog", "contact")
SERVICES = ("sme", "enterprise", "branding", "ads", "impact")
# The case studies and the six articles are reachable from their index routes
# and from the pages they belong to, not from the global menu — a nav that
# lists every leaf is a sitemap, not a navigation.
MENU = ("index", "about", "services", "sme", "enterprise", "branding", "ads",
        "impact", "work", "blog", "contact", "quote")
CASES = ("case-rapidkert", "case-barbershop", "case-mentaltrening")
POSTS = ("post-seo", "post-arak", "post-cegprofil", "post-hirdetes",
         "post-elavult", "post-konverzio")

UI = {
    "hu": {
        "locale": "hu-HU",
        "name": "Magyar",
        "skip": "Ugrás a tartalomra",
        "brand_aria": "Stratos — főoldal",
        "nav_aria": "Fő navigáció",
        "menu_aria": "Mobil navigáció",
        "burger_aria": "Menü",
        "lang_aria": "Nyelvválasztás",
        "services": "Szolgáltatások",
        "quote_cta": "Árajánlat",
        "unit": "MÉTER",
        "unit_short": "M",
        "boot": "RENDSZEREK INDÍTÁSA",
        "skip_top": "UGRÁS 30 000 MÉTERRE",
        "hud": ["MAGASSÁG M", "OXIGÉN %", "HŐMÉRSÉKLET °C", "EMELKEDÉS M/S", "RÉTEG"],
        "rail_aria": "Az emelkedés szakaszai",
        "layers": ["TROPOSZFÉRA", "SZTRATOSZFÉRA", "MEZOSZFÉRA"],
        "nav": {"about": "Rólunk", "work": "Munkáink", "blog": "Blog",
                "contact": "Kapcsolat"},
        "svc_all": "Minden szolgáltatás",
        "svc": {
            "sme": ("Webdesign KKV-nak", "1 200 M"),
            "enterprise": ("Webdesign nagyvállalatoknak", "9 400 M"),
            "branding": ("Branding", "4 800 M"),
            "ads": ("Hirdetéskezelés", "17 000 M"),
            "impact": ("Impact Program", "30 000 M"),
        },
        "menu": {
            "index": "Főoldal", "about": "Rólunk", "services": "Szolgáltatások",
            "sme": "KKV", "enterprise": "Nagyvállalat", "branding": "Branding",
            "ads": "Hirdetés", "impact": "Impact", "work": "Munkáink",
            "blog": "Blog", "contact": "Kapcsolat", "quote": "Árajánlat",
        },
        "nl_lede": "Félsz, hogy kimaradsz? Többé nem kell — iratkozz fel a hírlevelünkre.",
        "nl_label": "E-mail cím",
        "nl_placeholder": "e-mail cím",
        "nl_button": "Feliratkozom",
        "f_links": "Linkek",
        "f_contact": "Kapcsolat",
        "f_social": "Közösség",
        "f_rights": "© 2026 Stratos Media Agency — Minden jog fenntartva.",
        "f_privacy": "Adatkezelési tájékoztató",
        "f_imprint": "Impresszum",
        "js": {
            "sending": "Küldés…",
            "sent": "Elküldve",
            "thanks": "Köszönjük — hamarosan válaszolunk a megadott címre.",
            "fail": "A küldés nem sikerült. Írj közvetlenül: lukacs.artur@media-stratos.com",
            "invalid": "Kérjük, ellenőrizd a kiemelt mezőket.",
            "need_name": "Kérjük, add meg a nevedet.",
            "need_email": "Ez az e-mail cím nem tűnik helyesnek.",
            "too_long": "Az egyik mező túl hosszú — kérjük, rövidítsd le.",
            "limited": "Túl sok beküldés egymás után. Kérlek, várj egy percet.",
        },
    },
    "en": {
        "locale": "en-GB",
        "name": "English",
        "skip": "Skip to content",
        "brand_aria": "Stratos — home",
        "nav_aria": "Main navigation",
        "menu_aria": "Mobile navigation",
        "burger_aria": "Menu",
        "lang_aria": "Choose language",
        "services": "Services",
        "quote_cta": "Get a quote",
        "unit": "METRES",
        "unit_short": "M",
        "boot": "SYSTEMS STARTING",
        "skip_top": "SKIP TO 30,000 M",
        "hud": ["ALTITUDE M", "OXYGEN %", "TEMPERATURE °C", "CLIMB M/S", "LAYER"],
        "rail_aria": "Stages of the ascent",
        "layers": ["TROPOSPHERE", "STRATOSPHERE", "MESOSPHERE"],
        "nav": {"about": "About", "work": "Work", "blog": "Blog",
                "contact": "Contact"},
        "svc_all": "All services",
        "svc": {
            "sme": ("Web design for SMEs", "1,200 M"),
            "enterprise": ("Web design for enterprises", "9,400 M"),
            "branding": ("Branding", "4,800 M"),
            "ads": ("Ads management", "17,000 M"),
            "impact": ("Impact Program", "30,000 M"),
        },
        "menu": {
            "index": "Home", "about": "About", "services": "Services",
            "sme": "SME", "enterprise": "Enterprise", "branding": "Branding",
            "ads": "Ads", "impact": "Impact", "work": "Work", "blog": "Blog",
            "contact": "Contact", "quote": "Get a quote",
        },
        "nl_lede": "Afraid of missing out? Not any more — subscribe to our newsletter.",
        "nl_label": "Email address",
        "nl_placeholder": "email address",
        "nl_button": "Subscribe",
        "f_links": "Links",
        "f_contact": "Contact",
        "f_social": "Social",
        "f_rights": "© 2026 Stratos Media Agency — All rights reserved.",
        "f_privacy": "Privacy policy",
        "f_imprint": "Imprint",
        "js": {
            "sending": "Sending…",
            "sent": "Sent",
            "thanks": "Thank you — we'll reply to the address you gave us shortly.",
            "fail": "Sending failed. Write to us directly: lukacs.artur@media-stratos.com",
            "invalid": "Please check the highlighted fields.",
            "need_name": "Please give us your name.",
            "need_email": "That email address does not look right.",
            "too_long": "One of the fields is too long — please shorten it.",
            "limited": "Too many submissions in a row. Please wait a minute.",
        },
    },
    "de": {
        "locale": "de-DE",
        "name": "Deutsch",
        "skip": "Zum Inhalt springen",
        "brand_aria": "Stratos — Startseite",
        "nav_aria": "Hauptnavigation",
        "menu_aria": "Mobile Navigation",
        "burger_aria": "Menü",
        "lang_aria": "Sprache wählen",
        "services": "Leistungen",
        "quote_cta": "Angebot",
        "unit": "METER",
        "unit_short": "M",
        "boot": "SYSTEME STARTEN",
        "skip_top": "DIREKT AUF 30.000 M",
        "hud": ["HÖHE M", "SAUERSTOFF %", "TEMPERATUR °C", "STEIGEN M/S", "SCHICHT"],
        "rail_aria": "Etappen des Aufstiegs",
        "layers": ["TROPOSPHÄRE", "STRATOSPHÄRE", "MESOSPHÄRE"],
        "nav": {"about": "Über uns", "work": "Projekte", "blog": "Blog",
                "contact": "Kontakt"},
        "svc_all": "Alle Leistungen",
        "svc": {
            "sme": ("Webdesign für KMU", "1.200 M"),
            "enterprise": ("Webdesign für Großunternehmen", "9.400 M"),
            "branding": ("Branding", "4.800 M"),
            "ads": ("Werbeanzeigen", "17.000 M"),
            "impact": ("Impact-Programm", "30.000 M"),
        },
        "menu": {
            "index": "Start", "about": "Über uns", "services": "Leistungen",
            "sme": "KMU", "enterprise": "Konzerne", "branding": "Branding",
            "ads": "Werbung", "impact": "Impact", "work": "Projekte",
            "blog": "Blog", "contact": "Kontakt", "quote": "Angebot",
        },
        "nl_lede": "Angst, etwas zu verpassen? Ab jetzt nicht mehr — abonniere unseren Newsletter.",
        "nl_label": "E-Mail-Adresse",
        "nl_placeholder": "E-Mail-Adresse",
        "nl_button": "Abonnieren",
        "f_links": "Links",
        "f_contact": "Kontakt",
        "f_social": "Social Media",
        "f_rights": "© 2026 Stratos Media Agency — Alle Rechte vorbehalten.",
        "f_privacy": "Datenschutzerklärung",
        "f_imprint": "Impressum",
        "js": {
            "sending": "Wird gesendet…",
            "sent": "Gesendet",
            "thanks": "Danke — wir melden uns in Kürze an der angegebenen Adresse.",
            "fail": "Das Senden ist fehlgeschlagen. Schreib uns direkt: lukacs.artur@media-stratos.com",
            "invalid": "Bitte überprüfe die markierten Felder.",
            "need_name": "Bitte gib deinen Namen an.",
            "need_email": "Diese E-Mail-Adresse sieht nicht richtig aus.",
            "too_long": "Eines der Felder ist zu lang — bitte kürze es.",
            "limited": "Zu viele Übermittlungen hintereinander. Bitte warte eine Minute.",
        },
    },
}

# The legal pages exist in three languages, but only one of them is binding.
# Fragments carry a <!--legal-note--> marker where this goes.
LEGAL_NOTE = {
    "hu": "",
    "en": '<p class="legal__note" role="note"><b>Please note:</b> this is a courtesy '
          'translation. In any question of interpretation the '
          '<a href="%s" hreflang="hu" lang="hu">Hungarian version</a> is the '
          'legally binding one.</p>',
    "de": '<p class="legal__note" role="note"><b>Hinweis:</b> Dies ist eine Übersetzung '
          'zur Information. In allen Auslegungsfragen ist die '
          '<a href="%s" hreflang="hu" lang="hu">ungarische Fassung</a> rechtlich '
          'verbindlich.</p>',
}

ARROW = ('<svg viewBox="0 0 16 16" fill="none" aria-hidden="true">'
         '<path d="M3 13L13 3M13 3H5M13 3v8" stroke="currentColor" stroke-width="1.4"/></svg>')


# --------------------------------------------------------------------- paths
def href(lang, key):
    """Link to page `key` from any page of the same language."""
    return SLUGS[key][lang]


def cross(lang_from, lang_to, key):
    """Link to page `key` in another language."""
    if lang_from == lang_to:
        return SLUGS[key][lang_to]
    up = "" if lang_from == "hu" else "../"
    down = "" if lang_to == "hu" else lang_to + "/"
    return up + down + SLUGS[key][lang_to]


def absolute(lang, key):
    """Root-relative URL — used for hreflang."""
    return "/" + ("" if lang == "hu" else lang + "/") + SLUGS[key][lang]


# --------------------------------------------------------------------- chrome
def build_nav(lang, key):
    u = UI[lang]

    def cur(k):
        return ' aria-current="page"' if k == key else ""

    first = (f'\n    <a class="navlink" href="{href(lang, "about")}"{cur("about")}>'
             f'{u["nav"]["about"]}</a>')
    # The overview route heads its own dropdown. Before Phase 8 the dropdown's
    # trigger pointed at /kkv.html, so "Services" meant "the SME page" and there
    # was no way to see the services as a set at all.
    drop = (f'\n        <a href="{href(lang, "services")}"{cur("services")}>'
            f'{u["svc_all"]} <em>—</em></a>')
    drop += "".join(
        f'\n        <a href="{href(lang, k)}"{cur(k)}>{u["svc"][k][0]} '
        f'<em>{u["svc"][k][1]}</em></a>' for k in SERVICES)
    in_svc = ' aria-current="true"' if key in SERVICES or key == "services" else ""
    rest = "".join(
        f'\n    <a class="navlink" href="{href(lang, k)}"{cur(k)}>{u["nav"][k]}</a>'
        for k in NAV[1:])
    return f"""{first}
    <div class="drop">
      <a class="navlink" href="{href(lang, 'services')}" aria-haspopup="true"{in_svc}>{u['services']}</a>
      <div class="drop__panel">{drop}
      </div>
    </div>{rest}
    {build_langs(lang, key)}
    <a class="btn" href="{href(lang, 'quote')}" data-magnet><span>{u['quote_cta']}</span>
      {ARROW}
    </a>"""


def build_langs(lang, key):
    """Compact HU / EN / DE switcher that keeps the reader on the same page."""
    items = "".join(
        '<a href="%s" hreflang="%s" lang="%s"%s>%s</a>'
        % (cross(lang, l, key), l, l,
           ' aria-current="true"' if l == lang else "", l.upper())
        for l in LANGS)
    return (f'<div class="lang" role="group" aria-label="{UI[lang]["lang_aria"]}">'
            f'{items}</div>')


def build_menu(lang, key):
    u = UI[lang]
    return "".join(
        '\n  <a href="%s"%s><b>%02d</b> %s</a>'
        % (href(lang, k), ' aria-current="page"' if k == key else "", i, u["menu"][k])
        for i, k in enumerate(MENU))


def build_font_preload(lang, base):
    """Preload only the font files the first screen genuinely needs.

    The brief is explicit that this is not "preload every weight and family":
    a preload competes with the stylesheet and the LCP image for the same
    connection, so a file that is not needed to paint the first screen is worse
    than useless here.

    What is left is the upright Archivo `latin` subset, which sets the nav, the
    H1 and the lede on every page in all three languages, plus `latin-ext` on
    Hungarian only — ő and ű are outside `latin`, they are common enough in
    Hungarian headlines to be first-screen text, and English and German never
    touch that file at all.

    JetBrains Mono is deliberately not preloaded. It sets the altimeter rail and
    the small technical labels, none of which is the LCP element, and it arrives
    in time through the normal stylesheet path.

    `crossorigin` is required even though these are same-origin: font fetches
    are always made in CORS mode, and a preload without it is a second, wasted
    request rather than a warm cache entry.
    """
    faces = ["archivo/archivo-normal-latin.woff2"]
    if lang == "hu":
        faces.append("archivo/archivo-normal-latin-ext.woff2")
    return "".join(
        f'\n<link rel="preload" href="{base}assets/fonts/{f}" as="font" '
        f'type="font/woff2" crossorigin>'
        for f in faces)


def build_alternates(key):
    tags = "".join(
        f'\n<link rel="alternate" hreflang="{l}" href="{absolute(l, key)}">'
        for l in LANGS)
    return tags + f'\n<link rel="alternate" hreflang="x-default" href="{absolute("hu", key)}">'


# The origin every absolute URL in <head> is built from.
#
# Resolved, not written down, and the resolution order is the same one
# scripts/site-origin.mjs documents at length: SITE_URL, then Netlify's URL —
# which is the site's PRIMARY address, so whichever of stratosweb.hu or
# www.stratosweb.hu is marked primary is the one that appears here — then the
# intended main domain as a fallback for local builds.
#
# This used to say https://media-stratos.com, which is a Wix site that 301s
# somewhere else and was never this project's address.
SITE = (os.environ.get("SITE_URL")
        or os.environ.get("VITE_SITE_URL")
        or os.environ.get("URL")
        or "https://stratosweb.hu").strip().rstrip("/")

# Open Graph needs an absolute image URL, and a page that names none still has
# to preview as something rather than as a blank card. This is the homepage
# hero, which is ours and is already the site's most representative image; a
# fragment overrides it with an `og_image:` line in its front matter.
DEFAULT_OG_IMAGE = ("assets/img/hero.jpg", 1800, 1012)

OG_LOCALE = {"hu": "hu_HU", "en": "en_GB", "de": "de_DE"}


def build_social(lang, key, title, desc, meta):
    """Canonical, Open Graph and Twitter tags.

    Before Phase 8 none of the 33 generated routes carried any of this — only
    the React homepage did — so a link to any subpage shared as a bare URL with
    no title, no description and no image. The hreflang set was already correct
    and is built separately, above.

    Everything here is derived from what the page already declares. There is no
    second copy of the title to keep in step.
    """
    image, width, height = DEFAULT_OG_IMAGE
    if meta.get("og_image"):
        image = meta["og_image"]
        width = meta.get("og_image_width", "")
        height = meta.get("og_image_height", "")

    alt_locales = "".join(
        f'\n<meta property="og:locale:alternate" content="{OG_LOCALE[l]}">'
        for l in LANGS if l != lang)

    dims = ""
    if width and height:
        dims = (f'\n<meta property="og:image:width" content="{width}">'
                f'\n<meta property="og:image:height" content="{height}">')

    return f"""
<link rel="canonical" href="{SITE}{absolute(lang, key)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Stratos">
<meta property="og:locale" content="{OG_LOCALE[lang]}">{alt_locales}
<meta property="og:url" content="{SITE}{absolute(lang, key)}">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{desc}">
<meta property="og:image" content="{SITE}/{image}">{dims}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{title}">
<meta name="twitter:description" content="{desc}">
<meta name="twitter:image" content="{SITE}/{image}">"""


SHELL = """<!DOCTYPE html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<meta name="description" content="{{desc}}">
<link rel="icon" href="{{base}}assets/img/favicon.png">{{alternates}}{{social}}
{{fontpreload}}
<link rel="stylesheet" href="{{base}}assets/css/type.css">
<link rel="stylesheet" href="{{base}}assets/css/main.css">
<link rel="stylesheet" href="{{base}}assets/css/transitions.css">{{extra_css}}
<script id="i18n" type="application/json">{{i18n}}</script>
<!-- The canonical lead submission controller. In <head> with `defer` on
     purpose: deferred scripts run in document order after parsing, so this is
     guaranteed to have defined `window.Stratos.lead` before any per-page
     script in <body> runs — including the generated questionnaire wizard,
     which is a separate file and cannot import it. It also reads the i18n
     block above, which parsing has already delivered by then. -->
<script src="{{base}}assets/js/lead.js" defer></script>
</head>
<body data-ceiling="{{ceiling}}"{{body_class}}>

<a class="skip" href="#main">{{skip}}</a>
<div class="grain" aria-hidden="true"></div>
<canvas class="contrail" aria-hidden="true"></canvas>
<div class="plane-cursor" aria-hidden="true"><img src="{{base}}assets/img/plane-cursor.png" alt=""></div>
{{instruments}}

<header class="nav">
  <a class="brand" href="{{home}}" aria-label="{{brand_aria}}">
    <img src="{{base}}assets/img/plane-cursor.png" alt=""><span>Stratos</span>
  </a>
  <nav class="nav__links" aria-label="{{nav_aria}}">{{nav}}
  </nav>
  <button class="burger" aria-expanded="false" aria-controls="menu" aria-label="{{burger_aria}}"><i></i><i></i></button>
</header>

<nav class="menu" id="menu" aria-label="{{menu_aria}}">{{menu}}
  {{langs}}
  <div class="menu__foot">
    <span>lukacs.artur@media-stratos.com</span>
    <span>+36 30 584 8024</span>
  </div>
</nav>

<div class="shell">
<main id="main">
{{body}}
</main>
{{footer}}
</div>

<script src="{{base}}assets/js/main.js"></script>
<!-- Page transitions. First-party, so the policy stays `script-src 'self'`, and
     `defer` rather than `async` so it runs after parsing. It is not ordered
     before `pagereveal` and does not need to be — see assets/js/transitions.js. -->
<script src="{{base}}assets/js/transitions.js" defer></script>{{extra_js}}
</body>
</html>
"""

# Subpages carry the altimeter rail; the homepage carries the full instrument
# panel, because there the climb *is* the page.
RAIL = """
<aside class="rail" aria-hidden="true">
  <img class="rail__mark" src="{{base}}assets/img/plane-cursor.png" alt="">
  <div class="rail__tape"><div class="rail__ticks"></div></div>
  <div class="rail__read"><b class="rail__alt">420</b><span class="rail__unit">{{unit}}</span></div>
  <div class="rail__layer">{{layer0}}</div>
</aside>
"""

# The home page is a single continuous ascent: valley floor to stratosphere.
# Everything below the content is one world — sky shader, weather, the range
# itself, the route line drawn across it — and it is all a function of one
# number, the altitude. The instruments read that number; they do not compute
# anything of their own.
# The HUD chrome was the old homepage's flight instrument. Removed with it.

FOOTER = """<footer class="foot">
  <div class="wrap">
    <div class="foot__grid">
      <div>
        <a class="brand" href="{{home}}" style="margin-bottom:1.4rem"><img src="{{base}}assets/img/plane-cursor.png" alt=""><span>Stratos</span></a>
        <p class="muted" style="max-width:32ch;font-size:var(--step--1)">{{nl_lede}}</p>
        <form class="newsletter" data-lead="newsletter" style="margin-top:1.2rem">
          <label class="vh" for="nl">{{nl_label}}</label>
          <input id="nl" type="email" name="email" placeholder="{{nl_placeholder}}" required>
          <div class="hp" aria-hidden="true">
            <label for="hp-foot">Company website</label>
            <input id="hp-foot" type="text" name="company_website" tabindex="-1" autocomplete="off">
          </div>
          <button type="submit">{{nl_button}}</button>
        </form>
        <p class="form__note" style="margin-top:.6rem" role="status"></p>
      </div>
      <div>
        <h4>{{f_links}}</h4>
        <ul>{{f_pages}}
        </ul>
      </div>
      <div>
        <h4>{{f_services}}</h4>
        <ul>{{f_svc}}
        </ul>
      </div>
      <div>
        <h4>{{f_contact}}</h4>
        <ul>
          <li><a href="mailto:lukacs.artur@media-stratos.com">lukacs.artur@media-stratos.com</a></li>
          <li><a href="tel:+36305848024">+36 30 584 8024</a></li>
        </ul>
        <h4 style="margin-top:1.6rem">{{f_social}}</h4>
        <ul>
          <li><a href="https://www.linkedin.com" target="_blank" rel="noopener">LinkedIn</a></li>
          <li><a href="https://www.instagram.com" target="_blank" rel="noopener">Instagram</a></li>
          <li><a href="https://www.facebook.com" target="_blank" rel="noopener">Facebook</a></li>
        </ul>
      </div>
    </div>
    <div class="foot__bottom">
      <span>{{f_rights}}</span>
      <span style="display:flex;gap:1.4rem;align-items:center">
        <a href="{{privacy}}">{{f_privacy}}</a>
        <a href="{{imprint}}">{{f_imprint}}</a>
        <img src="{{base}}assets/img/gdpr.png" alt="GDPR Ready">
      </span>
    </div>
  </div>
</footer>"""


def render(tpl, ctx):
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(ctx[m.group(1)]), tpl)


def build_footer(lang, key):
    u = UI[lang]
    pages = "".join(
        f'\n          <li><a href="{href(lang, k)}">{u["menu"][k]}</a></li>'
        for k in ("about", "work", "contact", "blog", "quote"))
    svc = f'\n          <li><a href="{href(lang, "services")}">{u["svc_all"]}</a></li>'
    svc += "".join(
        f'\n          <li><a href="{href(lang, k)}">{u["svc"][k][0]}</a></li>'
        for k in SERVICES)
    return render(FOOTER, dict(
        home=href(lang, "index"), base="" if lang == "hu" else "../",
        nl_lede=u["nl_lede"], nl_label=u["nl_label"],
        nl_placeholder=u["nl_placeholder"], nl_button=u["nl_button"],
        f_links=u["f_links"], f_pages=pages, f_services=u["services"], f_svc=svc,
        f_contact=u["f_contact"], f_social=u["f_social"], f_rights=u["f_rights"],
        privacy=href(lang, "privacy"), f_privacy=u["f_privacy"],
        imprint=href(lang, "imprint"), f_imprint=u["f_imprint"],
    ))



# ------------------------------------------------------------------- images
# Every <img> is stamped with the intrinsic size of the file it points at, so
# the browser reserves the right box before the bytes arrive.
#
# Done here rather than in the fragments for two reasons. It cannot drift — a
# replaced image is a re-measured image on the next build, where a hand-written
# attribute would quietly start lying. And it is 51 images across 11 fragments
# and three languages, which is not a thing to maintain by hand.
#
# A tag that already declares width or height is left exactly as it is: an
# author who wrote one meant it.
IMG_RE = re.compile(r'<img\b((?:"[^"]*"|\'[^\']*\'|[^>"\'])*)>')
SRC_RE = re.compile(r'\bsrc="([^"]+)"')

_dim_cache = {}


def image_size(src):
    """(width, height) of a local image, or None. PNG and JPEG headers only —
    those are the only formats in assets/img, and a dependency for this would
    be a dependency for the whole build."""
    if src in _dim_cache:
        return _dim_cache[src]

    rel = src.lstrip("/")
    while rel.startswith("../"):
        rel = rel[3:]
    path = ROOT / rel
    size = None
    try:
        data = path.read_bytes()
        if data[:8] == b"\x89PNG\r\n\x1a\n":
            size = struct.unpack(">II", data[16:24])
        elif data[:2] == b"\xff\xd8":
            i = 2
            while i < len(data) - 9:
                if data[i] != 0xFF:
                    i += 1
                    continue
                marker = data[i + 1]
                # SOFn carries the dimensions. SOF4/SOF8/SOFC are not frame
                # headers and must not be read as one.
                if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7,
                              0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                    h, w = struct.unpack(">HH", data[i + 5:i + 9])
                    size = (w, h)
                    break
                if marker in (0xD8, 0xD9) or 0xD0 <= marker <= 0xD7:
                    i += 2
                    continue
                i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    except (OSError, struct.error, IndexError):
        size = None

    _dim_cache[src] = size
    return size


def stamp_images(html):
    def stamp(m):
        attrs = m.group(1)
        if re.search(r"\bwidth=", attrs) or re.search(r"\bheight=", attrs):
            return m.group(0)
        src = SRC_RE.search(attrs)
        if not src:
            return m.group(0)
        size = image_size(src.group(1))
        if not size:
            return m.group(0)
        return f'<img{attrs} width="{size[0]}" height="{size[1]}">'

    return IMG_RE.sub(stamp, html)


# --------------------------------------------------------------------- links
LINK_RE = re.compile(r'(href|src)="([^"#?]+\.html)((?:[#?][^"]*)?)"')
ASSET_RE = re.compile(r'(href|src)="(assets/)')


def relink(html, lang):
    """Point every in-site link at this language's filenames and asset depth."""
    def swap(m):
        target = BY_HU.get(m.group(2))
        if target is None:
            return m.group(0)
        return f'{m.group(1)}="{SLUGS[target][lang]}{m.group(3)}"'

    html = LINK_RE.sub(swap, html)
    if lang != "hu":
        html = ASSET_RE.sub(lambda m: f'{m.group(1)}="../assets/', html)
    return html


# ------------------------------------------------------------------ inline js
# The site is served under `script-src 'self'` with no 'unsafe-inline' (see the
# CSP block in netlify.toml), so an inline <script> is refused by the browser.
# A CSP refusal is not a JavaScript error: nothing throws, nothing rejects, the
# console stays clean and the page simply renders empty. The quote wizard
# shipped that way in all three languages and was dead in production.
#
# So any executable inline script a fragment carries is written out as a real
# file instead. A <script> with a `type` is a data block (the i18n JSON), not
# code, and is left where it is.
INLINE_JS_RE = re.compile(
    r'<script(?![^>]*\bsrc=)(?![^>]*\btype=)[^>]*>(.*?)</script>', re.S)


def externalise_js(html, key, lang, base):
    """Move executable inline scripts into assets/js/<key>.<lang>.js.

    Runs after relink(), so the extracted code keeps the localised page links
    and asset depth it would have had inline.
    """
    blocks = [b.strip() for b in INLINE_JS_RE.findall(html) if b.strip()]
    if not blocks:
        return html, None

    name = f"{key}.{lang}.js"
    out = ROOT / "assets" / "js" / name
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")

    # `defer` runs the file after the document is parsed, which is a strictly
    # weaker requirement than the inline version had — it executed mid-body and
    # depended on #app already being above it.
    tag = f'<script src="{base}assets/js/{name}" defer></script>'
    seen = False

    def swap(_m):
        nonlocal seen
        if seen:
            return ""
        seen = True
        return tag

    return INLINE_JS_RE.sub(swap, html), name


# --------------------------------------------------------------------- build
def parse(path):
    raw = path.read_text(encoding="utf-8")
    head, _, body = raw.partition("\n---\n")
    meta = {}
    for line in head.strip().splitlines():
        k, _, v = line.partition(":")
        meta[k.strip()] = v.strip()
    return meta, body.strip()


def load_dict(lang):
    """Merge every _build/i18n/*.json. Each file maps a Hungarian string to
    ["<english>", "<german>"]; one file per page keeps them reviewable."""
    if lang == "hu":
        return {}
    col = LANGS.index(lang) - 1
    table = {}
    owner = {}
    for path in sorted(DICTS.glob("*.json")):
        for hu, vals in json.loads(path.read_text(encoding="utf-8")).items():
            if hu.startswith("_"):                        # notes, not strings
                continue
            if isinstance(vals, str):
                vals = [vals, vals]
            if vals[col]:
                key = tr.normalise(hu)
                # One flat namespace merged in filename order, so a key defined
                # twice is silently decided by which file sorts later. That is
                # not theoretical: a Phase 8 file defined "Kezdés" as a CTA
                # label and thereby renamed the questionnaire's Start button in
                # English and German, in generated JS nobody was reading.
                # Disagreements are worth a line of output; agreement is not.
                if key in table and table[key] != vals[col]:
                    print(f"  ! {lang}: '{hu[:48]}' redefined in "
                          f"{path.name} (was {owner[key]}) — later file wins")
                table[key] = vals[col]
                owner[key] = path.name
    if not table:
        print(f"  ! no strings in {DICTS.relative_to(ROOT)} — {lang} stays Hungarian")
    return table


def write_route_manifest():
    """The slug table, as data, for the tools downstream of this script.

    scripts/assemble.mjs used to carry a hand-copied duplicate of SLUGS to build
    the sitemap from, with a comment admitting it was mirrored rather than
    guessed. Phase 8 more than doubles the route count, and a hand-mirrored copy
    of a 23-entry table is a sitemap that silently goes stale. It is emitted
    here instead, by the one place that actually owns the mapping.
    """
    (Path(__file__).resolve().parent / "routes.json").write_text(
        json.dumps({"langs": list(LANGS), "slugs": SLUGS}, ensure_ascii=False, indent=1),
        encoding="utf-8")


def main():
    if not PAGES.is_dir():
        sys.exit(f"missing {PAGES}")

    frags = {f.stem: parse(f) for f in sorted(PAGES.glob("*.html"))}
    unknown = set(frags) - {v["hu"][:-5] for v in SLUGS.values()}
    if unknown:
        sys.exit(f"fragments with no slug entry: {', '.join(sorted(unknown))}")
    # The reverse is just as much a bug: a slug with no fragment produces a
    # nav link, a sitemap entry and an hreflang set pointing at a 404.
    missing_frag = {k for k, v in SLUGS.items()
                    if k != "index" and v["hu"][:-5] not in frags}
    if missing_frag:
        sys.exit(f"slug entries with no fragment: {', '.join(sorted(missing_frag))}")

    write_route_manifest()

    for lang in LANGS:
        table = load_dict(lang)
        missing = []
        scripts = []
        outdir = ROOT if lang == "hu" else ROOT / lang
        outdir.mkdir(exist_ok=True)
        u = UI[lang]
        js = dict(u["js"], locale=u["locale"], unit=u["unit"], layers=u["layers"])

        for stem, (meta, body) in frags.items():
            key = BY_HU[stem + ".html"]
            title = meta.get("title", "Stratos")
            desc = meta.get("desc", "")
            if table:
                title = table.get(tr.normalise(title), title)
                desc = table.get(tr.normalise(desc), desc)
                body = tr.apply(body, table, missing)
            if "<!--legal-note-->" in body:
                note = LEGAL_NOTE[lang]
                body = body.replace("<!--legal-note-->",
                                    note % cross(lang, "hu", key) if note else "")

            show_footer = meta.get("footer", "yes").lower() not in ("no", "false", "0")
            base = "" if lang == "hu" else "../"
            # The `mode: flight` branch and its HUD chrome went with the old
            # homepage — see the migration note in README.md. Every remaining
            # page carries the altimeter rail.
            chrome = render(RAIL, dict(
                base=base, unit=u["unit"], unit_short=u["unit_short"],
                layer0=u["layers"][0], boot=u["boot"], skip_top=u["skip_top"],
                rail_aria=u["rail_aria"],
                **{f"hud{i}": v for i, v in enumerate(u["hud"])}))
            html = render(SHELL, dict(
                lang=lang, title=title, desc=desc,
                base=base,
                alternates=build_alternates(key),
                social=build_social(lang, key, title, desc, meta),
                fontpreload=build_font_preload(lang, base),
                i18n=json.dumps(js, ensure_ascii=False),
                ceiling=meta.get("ceiling", "20000"),
                body_class="",
                instruments=chrome,
                extra_css="",
                extra_js="",
                skip=u["skip"], unit=u["unit"], layer0=u["layers"][0],
                home=href(lang, "index"), brand_aria=u["brand_aria"],
                nav_aria=u["nav_aria"], menu_aria=u["menu_aria"],
                burger_aria=u["burger_aria"],
                nav=build_nav(lang, key), menu=build_menu(lang, key),
                langs=build_langs(lang, key),
                body=body,
                footer=build_footer(lang, key) if show_footer else "",
            ))
            html, script = externalise_js(relink(html, lang), key, lang, base)
            html = stamp_images(html)
            if script:
                scripts.append(script)
            (outdir / SLUGS[key][lang]).write_text(html, encoding="utf-8")

        where = "/" if lang == "hu" else f"/{lang}/"
        note = f"  ({len(missing)} untranslated)" if missing else ""
        print(f"{lang}: {len(frags)} pages -> {where}{note}")
        if scripts:
            print(f"  inline js -> assets/js/{', '.join(sorted(scripts))}")
        # not inside i18n/ — that folder is only ever read as dictionaries
        report = DICTS.parent / f"missing-{lang}.json"
        if missing:
            report.write_text(
                json.dumps({m: ["", ""] for m in missing}, ensure_ascii=False, indent=1),
                encoding="utf-8")
        elif report.exists():
            report.unlink()


if __name__ == "__main__":
    main()
