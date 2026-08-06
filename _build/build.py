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
from contextlib import contextmanager
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

# ---------------------------------------------------------- case-study status
#
# Three states, and the difference between them is what a route is ALLOWED to
# claim — not how much text it has.
#
#   draft    not linked, not in the sitemap, not indexable.
#   summary  reachable and linked from the Work index and the homepage, but not
#            promoted as a case study: no sitemap entry, `noindex, follow`, and
#            no "read the full case study" call to action anywhere.
#   full     the works — public case-study navigation, sitemap, indexable
#            metadata, homepage full-case CTA, the Work -> Case transition.
#
# `full` is earned, not assumed. It requires professional media, a documented
# challenge and strategy, design rationale, a technical account and verified
# results. The three current projects have none of that yet — each one says so
# on its own page, in a section headed "result figures are deliberately absent"
# — so publishing them under `full` route rules was the site claiming a maturity
# its own copy denies. They are `summary` until the real case studies exist.
#
# Note what this does NOT do: it does not delete a route or a word. All nine
# routes stay live and reachable, keep their content, keep their hreflang set.
# Promoting one later is a one-word edit here.
CASE_STATUS = {
    "case-rapidkert": "summary",
    "case-barbershop": "summary",
    "case-mentaltrening": "summary",
}


def case_status(key):
    return CASE_STATUS.get(key, "full")


def indexable(key):
    return case_status(key) == "full"


POSTS = ("post-seo", "post-arak", "post-cegprofil", "post-hirdetes",
         "post-elavult", "post-konverzio")

# ------------------------------------------------- organisations and their marks
#
# One table, and it is the only place an organisation's name, its mark and what
# may be said about it are written down. Nothing renders a logo that is not
# here, and nothing here renders unless `ready` is true.
#
# WHY `ready` EXISTS
# ------------------
# Because "we have a logo for them" and "we have a logo we can publish" are
# different claims, and the gap between them is where a stretched, keylined,
# white-boxed or reconstructed mark gets shipped. `ready` is false unless the
# supplied file is the official artwork, at a usable size, with real
# transparency, legible on the Stratos void. A false here is a production
# blocker to be reported, never a placeholder to be drawn.
#
# WHY THE WORDING IS NEUTRAL
# --------------------------
# Five of these carry `collab`, and that is deliberate: nothing in this
# repository establishes which of them are clients and which are collaborations,
# and inventing per-organisation claims is exactly the kind of thing that is
# checked. They sit under one honest heading — "Selected collaborations" —
# which claims association and nothing more. It specifically does not claim
# partnership, endorsement, sponsorship or a commercial engagement.
#
# `sponsor` and `impact` are the two exceptions, and they were not invented
# here: both were stated directly by the owner of the relationship. They are
# also the two claims the neutral heading would get *wrong* rather than merely
# leave vague — Stratos pays HAIO and works for FICE for nothing, so filing
# either as a collaboration would overstate one and understate the other. They
# are named on the single page where each is the subject, and nowhere else.
ORGS = {
    "kontyos": {
        "name": "Kontyos.hu",
        "asset": "assets/img/logo-kontyos.webp",
        "ready": True,
        "relationship": "collab",
    },
    "grantool": {
        "name": "Grantool Kft.",
        "asset": "assets/img/logo-grantool.png",
        "ready": True,
        "relationship": "collab",
    },
    "synergy": {
        "name": "Synergy Digital Hungary Kft.",
        "asset": "assets/img/logo-synergy.png",
        "ready": True,
        "relationship": "collab",
    },
    "duna-hajok": {
        "name": "Duna Hajók",
        "asset": "assets/img/logo-duna-hajok.png",
        "ready": True,
        "relationship": "collab",
    },
    "duna-enterior": {
        # The mark reads "Duna ENTERIOR". Kept as the asset spells it.
        "name": "Duna Enterior",
        "asset": "assets/img/logo-duna-enterior.png",
        "ready": True,
        "relationship": "collab",
    },
    # ---- support relationships. Artwork arrived; neither is a collaboration.
    #
    # These two are the reason `relationship` exists as a field rather than a
    # comment. Stratos sponsors one and gives the other its work for free, which
    # runs the opposite way from a client, so neither may appear under
    # "Selected collaborations" with the five above. `logoset()` renders the
    # rail from collaborations only and these are addressed by name, on the one
    # page where each is the subject.
    #
    # Both were supplied as knockout artwork — see `ink` — which is also the
    # opposite of the five. That is a coincidence, but a convenient one: their
    # placements are dark bands anyway.
    "haio": {
        "name": "HAIO",
        "asset": "assets/img/logo-haio.png",
        "ready": True,
        "relationship": "sponsor",
        "ink": "light",
    },
    "fice": {
        "name": "FICE",
        "asset": "assets/img/logo-fice.png",
        "ready": True,
        "relationship": "impact",
        "ink": "light",
    },
}

# Marks whose own ink is light. They are given no plate and may only be placed
# on a dark band; `logoset()` raises rather than render one on paper, because a
# white mark on #F4F4F4 is not a subtle regression, it is a blank rectangle that
# passes every test that only counts <img> elements.
LIGHT_INK = {k for k, v in ORGS.items() if v.get("ink") == "light"}


# Clients with a live project route. Separate from ORGS because these are
# evidenced by the work itself — there is a page about each — and they carry a
# scope label the collaborations cannot honestly carry.
CLIENTS = ("rapidkert", "barbershop")
CLIENT_MARKS = {
    "rapidkert": ("Rapidkert Kft.", "assets/img/client-rapidkert.png"),
    "barbershop": ("Barbershop Győr", "assets/img/client-barbershop.png"),
}


def logoset(lang, kind="rail", keys=None, base=""):
    """Render a LogoSignalRail / LogoConstellation / LogoIndex.

    Only `ready` marks are emitted. An organisation whose artwork is missing
    produces no markup at all — not a box, not a name in a border, not a grey
    rectangle where a logo should be. A placeholder that ships is a placeholder
    that gets screenshotted.

    Every mark sits on the same plate. Three of the five are dark artwork and
    this site's background is near-black, so they had to be given something to
    sit on — and once three are plated, plating only those three is the thing
    that looks wrong: two marks floating free beside three in boxes reads as a
    patch for broken assets. Five identical plates reads as a system.

    No `data-on` and no `--optical` any more. Both existed to compensate for
    marks being different shapes on a shared background; a fixed plate with
    `object-fit: contain` makes the box the constant and lets each mark find its
    own size inside it, which is what optical alignment wanted in the first
    place. Nothing is stretched, cropped or recoloured.

    The default set is the collaborations, not everything that happens to be
    ready. HAIO and FICE are support relationships and must be asked for by
    name; letting them fall into an unqualified rail is the one mistake this
    function is in a position to prevent.
    """
    keys = keys or [k for k, v in ORGS.items()
                    if v["ready"] and v["relationship"] == "collab"]
    items = []
    for k in keys:
        o = ORGS.get(k)
        if not o or not o["ready"] or not o["asset"]:
            continue
        # A light mark has no plate, so the band under it is the only thing it
        # is legible against. See LIGHT_INK.
        ink = f' data-ink="{o["ink"]}"' if o.get("ink") else ""
        items.append(
            f'\n        <li data-logo{ink}>'
            f'<img src="{base}{o["asset"]}" alt="{o["name"]}" loading="lazy">'
            f'</li>')
    if not items:
        return ""
    return (f'<ul class="logoset logoset--{kind}" data-logo-group>'
            + "".join(items) + '\n      </ul>')

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
        # ---- Phase 8.5: flight-deck header, full-screen menu, Arrival footer.
        # Every factual line here is quoted from copy that already ships. The
        # response expectation is the Contact page's own wording; the location
        # is the one in the site description. Nothing in this block is new fact.
        "p85": {
            "alt": "MAG",
            "menu": "MENÜ",
            "close": "Bezárás",
            "menu_aria_full": "Teljes navigáció",
            "start": "Projekt indítása",
            "explore": "Kiemelt munkáink",
            "nav_group": "Navigáció",
            "cap_group": "Amit csinálunk",
            "status_group": "Állapot",
            "st_reply": "Válasz jellemzően pár órán belül",
            "st_where": "Győr és Budapest",
            "st_langs": "Magyarul, angolul és németül dolgozunk",
            "to_top": "VISSZA 0 MÉTERRE",
            "converge_state": "KALIBRÁCIÓ KÉSZ",
            # The homepage is the one route that actually flies the ascent, so
            # its convergence reports the ascent rather than the calibration.
            "converge_state_home": "EMELKEDÉS BEFEJEZVE",
            "converge_lede": "Hova vigyük innen a vállalkozásodat?",
            "cta_head": "A következő szint innen indul.",
            # Archetype-specific closing lines (brief §8.5).
            "cta_service": "Hasonló feladatod van?",
            "cta_work": "Építsük meg a következő projektet.",
            "cta_about": "Nézzük meg, mit tudunk együtt felépíteni.",
            "cta_article": "Váltsd működő rendszerré, amit most olvastál.",
            "collab": "Kiválasztott együttműködések",
        },
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
        "p85": {
            "alt": "ALT",
            "menu": "MENU",
            "close": "Close",
            "menu_aria_full": "Full navigation",
            "start": "Start a project",
            "explore": "Explore selected work",
            "nav_group": "Navigate",
            "cap_group": "Capabilities",
            "status_group": "Status",
            "st_reply": "A reply usually within a few hours",
            "st_where": "Győr and Budapest",
            "st_langs": "We work in Hungarian, English and German",
            "to_top": "RETURN TO 0 M",
            "converge_state": "CALIBRATION COMPLETE",
            "converge_state_home": "ASCENT COMPLETE",
            "converge_lede": "Where should we take your business next?",
            "cta_head": "Your next altitude starts here.",
            "cta_service": "Have a similar challenge?",
            "cta_work": "Build the next project with us.",
            "cta_about": "Let's see what we can build together.",
            "cta_article": "Turn this insight into a working system.",
            "collab": "Selected collaborations",
        },
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
        "p85": {
            "alt": "HÖHE",
            "menu": "MENÜ",
            "close": "Schließen",
            "menu_aria_full": "Vollständige Navigation",
            "start": "Projekt starten",
            "explore": "Ausgewählte Arbeiten",
            "nav_group": "Navigation",
            "cap_group": "Leistungen",
            "status_group": "Status",
            "st_reply": "Antwort in der Regel innerhalb weniger Stunden",
            "st_where": "Győr und Budapest",
            "st_langs": "Wir arbeiten auf Ungarisch, Englisch und Deutsch",
            "to_top": "ZURÜCK AUF 0 M",
            "converge_state": "KALIBRIERUNG ABGESCHLOSSEN",
            "converge_state_home": "AUFSTIEG ABGESCHLOSSEN",
            "converge_lede": "Wohin soll es mit deinem Unternehmen als Nächstes gehen?",
            "cta_head": "Die nächste Höhe beginnt hier.",
            "cta_service": "Eine ähnliche Aufgabe?",
            "cta_work": "Lass uns das nächste Projekt bauen.",
            "cta_about": "Sehen wir, was wir gemeinsam aufbauen können.",
            "cta_article": "Mach aus dieser Erkenntnis ein funktionierendes System.",
            "collab": "Ausgewählte Kooperationen",
        },
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
# Link mode.
#
# The 66 generated routes link relatively — `rolunk.html` from `/`,
# `about.html` from `/en/` — which is what they have always done. The React
# homepage cannot: see `root_href` below for the three reasons. `href` and
# `cross` are the only two places any chrome link is built, so one switch here
# covers the nav, the menu, the language switch and the whole footer, and it is
# a context manager so it cannot be left on by a later edit.
_ROOT_LINKS = False


@contextmanager
def root_links():
    """Build links root-absolutely for the duration of the block."""
    global _ROOT_LINKS
    _ROOT_LINKS = True
    try:
        yield
    finally:
        _ROOT_LINKS = False


def href(lang, key):
    """Link to page `key` from any page of the same language."""
    if _ROOT_LINKS:
        return root_href(lang, key)
    return SLUGS[key][lang]


def cross(lang_from, lang_to, key):
    """Link to page `key` in another language."""
    if _ROOT_LINKS:
        return root_href(lang_to, key)
    if lang_from == lang_to:
        return SLUGS[key][lang_to]
    up = "" if lang_from == "hu" else "../"
    down = "" if lang_to == "hu" else lang_to + "/"
    return up + down + SLUGS[key][lang_to]


def absolute(lang, key):
    """Root-relative URL — used for hreflang."""
    return "/" + ("" if lang == "hu" else lang + "/") + SLUGS[key][lang]


# The three homepage routes, as the homepage itself spells them. Kept in step
# with HOME_PATH in experiments/src/full/i18n.ts, which is the React side of the
# same three URLs.
HOME_PATH = {"hu": "/", "en": "/en/", "de": "/de/"}


def root_href(lang, key):
    """Link to page `key` from the React homepage.

    The homepage is one application served at three URLs, and every link it
    already renders is root-absolute (`pageHref` in i18n.ts). Its chrome has to
    match: a relative `rolunk.html` is correct from `/` and wrong from
    `/en/index.html`, and the Vite dev server serves the shells from
    `/home/hu.html`, where a relative link resolves to `/home/rolunk.html` and
    404s. The index is `/` rather than `/index.html` because that is what the
    homepage's own canonical says it is.
    """
    return HOME_PATH[lang] if key == "index" else absolute(lang, key)


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
      {"" if _ROOT_LINKS else ARROW}
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


# The full-screen menu's primary column. Six destinations, numbered, large.
# The services are a second column rather than six more numbered lines, and the
# case studies are in neither: under the `summary` status they do not get public
# case-study navigation, so the Work index is the one route that leads to them.
MENU_PRIMARY = ("index", "about", "services", "work", "blog", "contact")


def build_menu(lang, key):
    """The §7.4 editorial navigation layer.

    Two columns. The left is the six primary destinations at display size,
    numbered — the number is the Meridian's station marker, not decoration, so
    it is `aria-hidden` and the link text stands alone. The right is the service
    architecture, which is a list of five and reads better as one.
    """
    u = UI[lang]
    primary = "".join(
        '\n        <li><a href="%s"%s><b aria-hidden="true">%02d</b><span>%s</span></a></li>'
        % (href(lang, k), ' aria-current="page"' if k == key else "", i + 1, u["menu"][k])
        for i, k in enumerate(MENU_PRIMARY))
    svc = "".join(
        '\n        <li><a href="%s"%s>%s<em>%s</em></a></li>'
        % (href(lang, k), ' aria-current="page"' if k == key else "",
           u["svc"][k][0], u["svc"][k][1])
        for k in SERVICES)
    return f"""
    <ul class="menu__primary">{primary}
    </ul>
    <div class="menu__svc">
      <h2 class="menu__h">{u['services']}</h2>
      <ul>{svc}
      </ul>
    </div>"""


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

    Aboreto joins it, and only its `latin` subset. It sets the logo wordmark,
    which is in the header of every page in every language and is therefore
    first-screen text by definition. It is also the one face where the `swap` is
    visible as a *shape* change rather than a weight change — Aboreto's letter
    widths are nothing like Archivo's, so an unpreloaded wordmark reflows the
    whole left end of the nav a moment after paint. 10.6 kB buys that away.
    `latin-ext` is not preloaded for it: "Stratos" has no character outside
    `latin` in any of the three languages, so that file is never requested by
    the wordmark at all.

    JetBrains Mono is deliberately not preloaded. It sets the altimeter rail and
    the small technical labels, none of which is the LCP element, and it arrives
    in time through the normal stylesheet path.

    `crossorigin` is required even though these are same-origin: font fetches
    are always made in CORS mode, and a preload without it is a second, wasted
    request rather than a warm cache entry.
    """
    faces = ["archivo/archivo-normal-latin.woff2", "aboreto/aboreto-normal-latin.woff2"]
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


# ---------------------------------------------------------------- analytics
#
# Phase 9, Workstream C. The site ships NO measurement at all unless an endpoint
# is configured at build time — not a disabled script, not a stub, nothing. An
# unconfigured build emits neither the config block nor the script tag, so an
# unconfigured site pays zero bytes and makes zero requests.
#
# This is deliberate rather than merely tidy. The site sets no cookies and uses
# no device storage, which is exactly why it needs no consent banner today; a
# measurement system that loads unconditionally and decides at runtime whether
# to collect is one configuration mistake away from changing that answer.
#
#   ANALYTICS_ENDPOINT   required. A SAME-ORIGIN path, e.g. /api/event.
#                        The CSP is `connect-src 'self' https://*.supabase.co`,
#                        so a third-party URL here cannot transmit and must not
#                        be set without widening the policy deliberately.
#   ANALYTICS_SITE       optional. Property/site identifier, echoed as `site`.
#   ANALYTICS_CONSENT    optional. "1" holds events until consent is granted.
#                        Only needed if measurement ever starts using storage.
#   ANALYTICS_DEBUG      optional. "1" logs dropped events to the console.
#
# No provider is named here, and none is chosen: the adapter posts a neutral
# envelope to a first-party endpoint. Selecting a vendor is an explicit decision
# and is out of scope for Phase 9. See _build/reports/phase9-event-taxonomy.md.
def analytics_config():
    """The config dict, or None when the build is not configured to measure."""
    endpoint = os.environ.get("ANALYTICS_ENDPOINT", "").strip()
    if not endpoint:
        return None
    cfg = {"enabled": True, "endpoint": endpoint}
    site = os.environ.get("ANALYTICS_SITE", "").strip()
    if site:
        cfg["site"] = site
    if os.environ.get("ANALYTICS_CONSENT", "").strip() == "1":
        cfg["requireConsent"] = True
    if os.environ.get("ANALYTICS_DEBUG", "").strip() == "1":
        cfg["debug"] = True
    return cfg


def analytics_head(base):
    """The JSON config block and the adapter tag, or "" when unconfigured.

    The config is a non-executable `type="application/json"` block, the same
    mechanism the i18n dictionary uses, so it stays inside `script-src 'self'`
    with no inline execution.
    """
    cfg = analytics_config()
    if cfg is None:
        return ""
    return (
        '\n<script id="analytics-config" type="application/json">'
        + json.dumps(cfg, ensure_ascii=False)
        + "</script>"
        + f'\n<script src="{base}assets/js/analytics.js" defer></script>'
    )


# The flight deck and the full-screen navigation layer, as one template.
#
# Extracted from SHELL because there are two surfaces now. The 66 generated
# routes get it through SHELL; the React homepage gets the same rendered
# string through `write_home_chrome()`, which its Vite build substitutes into
# the three locale shells. One copy of the markup, one copy of the CSS in
# assets/css/chrome.css, one copy of the behaviour in assets/js/header.js.
DECK = """<!-- Flight deck. Three deterministic states — opening, journey, destination —
     written to `data-state` by assets/js/header.js from one number: how far
     down the document you are. The old direction-based hide/show is gone; a
     header that vanishes because you nudged the wheel upward is jitter, not
     navigation. -->
<header class="nav" data-state="opening">
  <a class="brand" href="{{home}}" aria-label="{{brand_aria}}">
    <img src="{{base}}assets/img/plane-cursor.png" alt="">
    <span class="brand__wm"><span class="brand__full">Stratos</span><span class="brand__mark" aria-hidden="true">S/</span></span>
  </a>
  <p class="nav__alt" aria-hidden="true"><span class="nav__alt-k">{{alt_k}}</span><b class="nav__alt-v">00000</b><span class="nav__alt-u">{{unit_short}}</span></p>
  <nav class="nav__links" aria-label="{{nav_aria}}">{{nav}}
  </nav>
  <a class="nav__cta" href="{{quote_href}}">{{start}}</a>
  <button class="burger" aria-expanded="false" aria-controls="menu" aria-label="{{burger_aria}}"><span class="burger__t" aria-hidden="true"><span class="burger__open">{{menu_label}}</span><span class="burger__shut">{{close}}</span></span><span class="burger__bars" aria-hidden="true"><i></i><i></i></span></button>
</header>

<!-- Full-viewport editorial navigation (§7.4). Still a plain list of anchors:
     no router, no interception, so middle-click, ctrl-click, back and the
     browser's own history all behave exactly as they did. -->
<div class="menu" id="menu" hidden>
  <div class="menu__veil" data-menu-dismiss></div>
  <nav class="menu__panel" aria-label="{{menu_aria_full}}">
    <svg class="menu__trace" data-trace viewBox="0 0 120 600" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M8 0 V600"/>
    </svg>
    {{menu}}
    <div class="menu__aside">
      {{langs}}
      <a class="btn menu__cta" href="{{quote_href}}">{{start}}</a>
      <div class="menu__foot">
        <a href="mailto:lukacs.artur@media-stratos.com">lukacs.artur@media-stratos.com</a>
        <a href="tel:+36305848024">+36 30 584 8024</a>
      </div>
    </div>
  </nav>
</div>"""


def build_deck(lang, key, base, home):
    """Render the flight deck for one route. `home` is the wordmark's href —
    relative on the generated routes, root-absolute on the homepage."""
    u = UI[lang]
    quote = root_href(lang, "quote") if base == "/" else href(lang, "quote")
    return render(DECK, dict(
        base=base, home=home,
        brand_aria=u["brand_aria"], nav_aria=u["nav_aria"],
        burger_aria=u["burger_aria"],
        alt_k=u["p85"]["alt"], unit_short=u["unit_short"],
        quote_href=quote, start=u["p85"]["start"],
        menu_label=u["p85"]["menu"], close=u["p85"]["close"],
        menu_aria_full=u["p85"]["menu_aria_full"],
        nav=build_nav(lang, key), menu=build_menu(lang, key),
        langs=build_langs(lang, key),
    ))


SHELL = """<!DOCTYPE html>
<html lang="{{lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{{title}}</title>
<meta name="description" content="{{desc}}">
<link rel="icon" href="{{base}}assets/img/favicon.png">{{robots}}{{alternates}}{{social}}
{{fontpreload}}
<link rel="stylesheet" href="{{base}}assets/css/type.css">
<!-- The site chrome — tokens, flight deck, full-screen menu, Arrival, footer.
     Before main.css because it carries the token block main.css reads, and
     because the homepage links this file and not main.css. See chrome.css. -->
<link rel="stylesheet" href="{{base}}assets/css/chrome.css">
<link rel="stylesheet" href="{{base}}assets/css/main.css">
<link rel="stylesheet" href="{{base}}assets/css/motion.css">
<link rel="stylesheet" href="{{base}}assets/css/transitions.css">{{extra_css}}
<script id="i18n" type="application/json">{{i18n}}</script>
<!-- The canonical lead submission controller. In <head> with `defer` on
     purpose: deferred scripts run in document order after parsing, so this is
     guaranteed to have defined `window.Stratos.lead` before any per-page
     script in <body> runs — including the generated questionnaire wizard,
     which is a separate file and cannot import it. It also reads the i18n
     block above, which parsing has already delivered by then. -->
<script src="{{base}}assets/js/lead.js" defer></script>{{analytics}}
</head>
<!-- data-page-key is the canonical page key from SLUGS, not the slug: the slug
     is translated, so /en/web-design-sme.html and /de/webdesign-kmu.html are
     both `sme`. Anything that needs to know what a page *is* should read this
     rather than parse the URL. -->
<body data-ceiling="{{ceiling}}" data-page-key="{{pagekey}}"{{body_class}}>

<a class="skip" href="#main">{{skip}}</a>
<div class="grain" aria-hidden="true"></div>
<canvas class="contrail" aria-hidden="true"></canvas>
<div class="plane-cursor" aria-hidden="true"><img src="{{base}}assets/img/plane-cursor.png" alt=""></div>
{{instruments}}

{{deck}}

<div class="shell">
<main id="main">
{{body}}
</main>
{{footer}}
</div>

<script src="{{base}}assets/js/main.js"></script>
<!-- The flight deck. Not deferred: the header's opening state is above the
     fold on every route, and a header that snaps into place one frame after
     paint is a layout shift the user watches happen. -->
<script src="{{base}}assets/js/header.js"></script>
<!-- The Meridian Trace motion primitives. `defer` because every primitive
     measures layout at boot — an SVG path's length is wrong until the web fonts
     have settled the box around it — and because nothing on the page depends on
     it having run. See assets/js/motion.js. -->
<script src="{{base}}assets/js/motion.js" defer></script>
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

# ARRIVAL / GROUND CONTROL — the §8 footer.
#
# The old footer was a rule followed by four columns of links, which is the one
# thing §8.1 names as not good enough: it ended the page without concluding it.
# This one has three movements.
#
#   1. Convergence. The page's own Meridian Trace runs out of the content and
#      meets itself. A system state, then one question.
#   2. The hero CTA the whole page has been walking towards. Its headline is
#      archetype-specific — a service page asks a service question, an article
#      asks an article question — so it reads as this page's conclusion rather
#      than as the same block stamped 66 times.
#   3. The information grid, and only then the utility line.
#
# The homepage gets the full cinematic version of movement 1; every other route
# gets a short one, per §8.5.
FOOTER = """<section class="arrival{{arrival_mod}}" data-converge>
  <div class="wrap">
    <svg class="arrival__trace" data-trace data-trace-stagger="0.5" viewBox="0 0 1200 240" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <path d="M0 12 C 300 12, 420 120, 600 120"/>
      <path d="M1200 12 C 900 12, 780 120, 600 120"/>
      <path d="M600 120 V 228" class="trace__lit"/>
      <circle class="trace__node" cx="600" cy="120" r="4"/>
    </svg>
    <p class="arrival__state" aria-hidden="true"><span>{{ceiling_label}}</span><span>{{converge_state}}</span></p>
    <p class="arrival__lede">{{converge_lede}}</p>
    <h2 class="arrival__h display" data-kinetic data-kinetic-from="104 700 0" data-kinetic-to="88 780 -.015">{{cta_head}}</h2>
    <p class="arrival__cta converge__cta">
      <a class="btn" href="{{quote}}" data-magnet><span>{{start}}</span>{{arrow}}</a>
      <a class="btn btn--ghost" href="{{work}}"><span>{{explore}}</span></a>
    </p>
  </div>
</section>
<footer class="foot">
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
          <li><a href="https://www.linkedin.com/company/stratos-media-agency" target="_blank" rel="noopener">LinkedIn</a></li>
          <li><a href="https://www.instagram.com/stratosweb/" target="_blank" rel="noopener">Instagram</a></li>
          <li><a href="https://www.facebook.com/profile.php?id=61590329356257" target="_blank" rel="noopener">Facebook</a></li>
        </ul>
      </div>
      <!-- Status. Three statements, every one of them already published
           elsewhere on this site: the reply expectation is the Contact page's
           own sentence, the location is the one in the site description, and
           the languages are the three locales this build emits. Nothing here
           is an availability claim the site cannot support. -->
      <div>
        <h4>{{f_status}}</h4>
        <ul class="foot__status">
          <li>{{st_reply}}</li>
          <li>{{st_where}}</li>
          <li>{{st_langs}}</li>
        </ul>
      </div>
    </div>
    <div class="foot__bottom">
      <span>{{f_rights}}</span>
      <span class="foot__utility">
        <a href="{{privacy}}">{{f_privacy}}</a>
        <a href="{{imprint}}">{{f_imprint}}</a>
        {{f_langs}}
        <button class="foot__top" type="button" data-to-top>{{to_top}}</button>
        <img src="{{base}}assets/img/gdpr.png" alt="GDPR Ready">
      </span>
    </div>
  </div>
</footer>"""


def render(tpl, ctx):
    return re.sub(r"\{\{(\w+)\}\}", lambda m: str(ctx[m.group(1)]), tpl)


# Which closing question a route asks. §8.5: the same core system, archetype-
# specific language — so a service page's footer concludes a service argument
# and an article's concludes the article, instead of 66 routes repeating one
# sentence. Anything not listed gets the general line.
ARCHETYPE_CTA = {
    **{k: "cta_service" for k in SERVICES},
    "services": "cta_service",
    "work": "cta_work",
    **{k: "cta_work" for k in CASES},
    "about": "cta_about",
    "impact": "cta_about",
    **{k: "cta_article" for k in POSTS},
    "blog": "cta_article",
}

# The altitude the convergence reports. It is the page's own ceiling — the same
# number the altimeter rail has been climbing towards all the way down — so the
# footer closes the instrument rather than announcing an unrelated figure.
CEILINGS = {"impact": 30000, "ads": 17000, "enterprise": 9400,
            "branding": 4800, "sme": 1200}


def build_footer(lang, key):
    u = UI[lang]
    p = u["p85"]
    pages = "".join(
        f'\n          <li><a href="{href(lang, k)}">{u["menu"][k]}</a></li>'
        for k in ("about", "work", "contact", "blog", "quote"))
    svc = f'\n          <li><a href="{href(lang, "services")}">{u["svc_all"]}</a></li>'
    svc += "".join(
        f'\n          <li><a href="{href(lang, k)}">{u["svc"][k][0]}</a></li>'
        for k in SERVICES)

    ceiling = CEILINGS.get(key, 30000)
    # Thin space between the thousands, which is how the altimeter reads it.
    ceiling_label = f"{ceiling:,}".replace(",", " ") + " " + u["unit_short"]

    home = key == "index"

    return render(FOOTER, dict(
        home=href(lang, "index"),
        # Root-absolute on the homepage, for the reason root_href gives: one
        # application, three URLs, and a dev server that serves it from a fourth.
        base="/" if _ROOT_LINKS else ("" if lang == "hu" else "../"),
        nl_lede=u["nl_lede"], nl_label=u["nl_label"],
        nl_placeholder=u["nl_placeholder"], nl_button=u["nl_button"],
        f_links=u["f_links"], f_pages=pages, f_services=u["services"], f_svc=svc,
        f_contact=u["f_contact"], f_social=u["f_social"], f_rights=u["f_rights"],
        privacy=href(lang, "privacy"), f_privacy=u["f_privacy"],
        imprint=href(lang, "imprint"), f_imprint=u["f_imprint"],
        # ---- Phase 8.5
        arrival_mod=" arrival--home" if home else "",
        ceiling_label=ceiling_label,
        # The homepage has actually flown the 30 000 m the label reports, so it
        # says so. Every other route is reporting its own ceiling as a position
        # on the instrument, which is what "calibration complete" means there.
        converge_state=p["converge_state_home"] if home else p["converge_state"],
        converge_lede=p["converge_lede"],
        cta_head=p[ARCHETYPE_CTA.get(key, "cta_head")] if key in ARCHETYPE_CTA else p["cta_head"],
        quote=href(lang, "quote"), start=p["start"],
        work=href(lang, "work"), explore=p["explore"],
        # No arrow glyph on the homepage — the same rule `build_nav` applies to
        # the header's own button. `.btn svg` is sized in main.css, which the
        # homepage does not link: its buttons are the journey's, and an inline
        # SVG with a viewBox and no dimensions collapsed to 0×0 inside one.
        # An invisible glyph in the markup is worse than no glyph.
        arrow="" if home else ARROW,
        f_status=p["status_group"], st_reply=p["st_reply"],
        st_where=p["st_where"], st_langs=p["st_langs"],
        f_langs=build_langs(lang, key), to_top=p["to_top"],
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
    """(width, height) of a local image, or None. PNG, JPEG and WebP headers,
    read directly — a dependency for this would be a dependency for the whole
    build.

    WebP arrived with the first approved collaboration mark. Without it the tag
    went out with no width and no height, the route audit failed six routes on
    exactly that, and the logo rail reflowed when the bytes landed. All three
    WebP flavours are read because which one you get is a property of whoever
    exported the file, not a choice this build makes."""
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
        elif data[:4] == b"RIFF" and data[8:12] == b"WEBP":
            chunk = data[12:16]
            if chunk == b"VP8X":
                # Extended format. The canvas size is two 24-bit little-endian
                # values, each stored one less than the real dimension.
                w = int.from_bytes(data[24:27], "little") + 1
                h = int.from_bytes(data[27:30], "little") + 1
                size = (w, h)
            elif chunk == b"VP8L":
                # Lossless. 14 bits of width then 14 of height, both minus one,
                # packed into the 32 bits after the 0x2f signature byte.
                bits = int.from_bytes(data[21:25], "little")
                size = ((bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1)
            elif chunk == b"VP8 " and data[23:26] == b"\x9d\x01\x2a":
                # Lossy. The sync code is checked because the two bytes before
                # it are a frame tag, and reading those as a dimension gives a
                # plausible-looking wrong answer rather than an error.
                w = int.from_bytes(data[26:28], "little") & 0x3FFF
                h = int.from_bytes(data[28:30], "little") & 0x3FFF
                size = (w, h)
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


def page_css(meta, base):
    """Per-archetype stylesheets, named by the fragment's own front matter.

    `css: services` in a fragment loads assets/css/page-services.css and only
    there. The signature interactions the brief asks for are page-shaped —
    a branching service map, a pinned process, an artboard wall — and putting
    their rules in main.css would bill all 66 routes for geometry one route
    uses. The shared layer stays the vocabulary every page speaks; this is the
    sentence one page says with it.

    Fingerprinting needs no change: scripts/fingerprint-assets.mjs rewrites any
    CSS or JS reference it finds, by content hash, whatever the filename.
    """
    names = [n.strip() for n in str(meta.get("css", "")).split(",") if n.strip()]
    return "".join(
        f'\n<link rel="stylesheet" href="{base}assets/css/page-{n}.css">'
        for n in names)


LOGOSET_RE = re.compile(r"\{\{logoset:(\w+)(?::([\w,-]+))?\}\}")

# The opening <section> a placeholder sits inside, found by scanning backwards.
SECTION_RE = re.compile(r'<section\b[^>]*>')


def expand_logosets(html, lang, base):
    """Replace `{{logoset:rail}}` / `{{logoset:index:haio}}` in a fragment.

    The fragments are the editorial source and they should name what they want —
    a credibility rail, a capability constellation — not carry a hand-written
    copy of an <img> list that goes stale the moment an asset is approved or
    withdrawn. One table, one renderer, every appearance.

    An optional comma-separated key list after the kind names the marks. Without
    it the set is the collaborations; `{{logoset:index:fice}}` is how a page
    asks for one specific organisation because that page is about it.

    A light-ink mark is refused on a pale band. It has no plate — that is the
    whole point of it — so on #F4F4F4 it renders as nothing at all, and nothing
    at all is precisely what an <img> assertion cannot see. Better to fail the
    build than to ship a section whose subject is an invisible rectangle.
    """
    def render(m):
        kind, keylist = m.group(1), m.group(2)
        keys = [k.strip() for k in keylist.split(",")] if keylist else None
        if keys:
            unknown = [k for k in keys if k not in ORGS]
            if unknown:
                raise SystemExit(f"logoset names no such organisation: {unknown}")
            lit = [k for k in keys if k in LIGHT_INK]
            if lit:
                opens = SECTION_RE.findall(html[:m.start()])
                if opens and "band--pale" in opens[-1]:
                    raise SystemExit(
                        f"logoset: {lit} is light-ink artwork and cannot sit on "
                        f"a band--pale section — it would render invisible. "
                        f"Move the placeholder to a dark band.")
        return logoset(lang, kind, keys=keys, base=base)

    return LOGOSET_RE.sub(render, html)


CASELINK_RE = re.compile(r'\sdata-case="([\w-]+)"')


def gate_case_links(html):
    """Turn `data-case="case-x"` into the shared Work -> Case transition, but
    only where that project is `full`.

    Brief §9.5 reserves the shared transition for a finished case study, and a
    `summary` project is not one — the flourish would promise a destination the
    route does not yet deliver. Doing it here rather than by deleting the
    attribute from the fragment is the point: the link, its markup and its
    place in the index are untouched, and promoting a project later is the same
    one-word edit in CASE_STATUS that flips its sitemap entry and its robots
    tag. The activation path stays wired up while it is switched off.
    """
    def swap(m):
        return (' data-transition="work-to-case"' if indexable(m.group(1))
                else '')
    return CASELINK_RE.sub(swap, html)


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


# --------------------------------------------------------------- the homepage
#
# The homepage is the one route this script does not generate. It is a React and
# WebGL bundle built by experiments/vite.home.config.ts from three hand-written
# locale shells, and it stays that way — see ARCHITECTURE.md for why rebuilding
# the ascent as a generated page was never on the table.
#
# What it was missing was the site: it had no header, no menu, and a footer of
# its own invention. The answer is not a second navigation system for one route.
# It is this: the chrome is rendered here, by the one place that owns the slug
# table, the six destinations, the five services and all three locales, and
# handed to the Vite build as four strings per language. The homepage then
# carries byte-identical header, menu, Arrival and footer markup to the other 66
# routes, styled by the same assets/css/chrome.css and driven by the same
# assets/js/header.js.
#
# The four slots are ordinary HTML comments in the shells, so a shell is still a
# valid document to open, and a shell that loses one is a build error rather
# than a page that quietly ships without a footer.
HOME_HEAD = """<!-- The site chrome, generated by _build/build.py. Same stylesheet as the
         other 66 routes; main.css is deliberately NOT linked, because it
         carries the page-level resets the journey's own stylesheet contradicts.
         See the note at the top of assets/css/chrome.css. -->
    <link rel="stylesheet" href="/assets/css/chrome.css">
    <!-- motion.css is deliberately absent, and so is main.css. The journey's
         eleven panels carry `data-stage` and `data-kinetic`, which are two of
         that file's own primitives, driven here by the journey's clock instead.
         The two primitives the chrome actually needs — TraceLine and
         CTAConvergence — live in chrome.css above. assets/js/motion.js keeps out
         of the journey subtree for the same reason; see `data-motion-external`. -->
    <script id="i18n" type="application/json">{{i18n}}</script>
    <!-- The canonical lead controller, for the footer newsletter. Event-bound
         only: it starts no loop and reads no layout. -->
    <script src="/assets/js/lead.js" defer></script>{{analytics}}"""

# Not deferred, for the reason SHELL gives: the header's opening state is above
# the fold and a header that snaps into place a frame after paint is a layout
# shift the visitor watches happen. It is at the end of <body>, after the header
# markup it binds to.
HOME_SCRIPTS = """<script src="/assets/js/header.js"></script>
    <script src="/assets/js/motion.js" defer></script>"""


def build_home_chrome(lang):
    """The four chrome strings for one homepage locale."""
    u = UI[lang]
    js = dict(u["js"], locale=u["locale"], unit=u["unit"], layers=u["layers"])
    with root_links():
        return {
            "head": render(HOME_HEAD, dict(
                i18n=json.dumps(js, ensure_ascii=False),
                analytics=analytics_head("/"))),
            # `base="/"` so the wordmark's plane resolves from `/`, `/en/` and
            # `/de/` alike, and from the dev server's `/home/hu.html`.
            "deck": build_deck(lang, "index", "/", HOME_PATH[lang]),
            "footer": build_footer(lang, "index"),
            "scripts": HOME_SCRIPTS,
        }


def write_home_chrome():
    (Path(__file__).resolve().parent / "home-chrome.json").write_text(
        json.dumps({l: build_home_chrome(l) for l in LANGS},
                   ensure_ascii=False, indent=1),
        encoding="utf-8")


def write_route_manifest():
    """The slug table, as data, for the tools downstream of this script.

    scripts/assemble.mjs used to carry a hand-copied duplicate of SLUGS to build
    the sitemap from, with a comment admitting it was mirrored rather than
    guessed. Phase 8 more than doubles the route count, and a hand-mirrored copy
    of a 23-entry table is a sitemap that silently goes stale. It is emitted
    here instead, by the one place that actually owns the mapping.
    """
    (Path(__file__).resolve().parent / "routes.json").write_text(
        json.dumps({"langs": list(LANGS), "slugs": SLUGS,
                    "status": {k: case_status(k) for k in SLUGS}},
                   ensure_ascii=False, indent=1),
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
    write_home_chrome()

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
            # Logo sets are expanded before translation. The token itself is
            # not a sentence, and what it produces is organisation names and
            # asset paths — feed either to the translator and they arrive in
            # missing-en.json as strings nobody can translate.
            body = expand_logosets(body, lang, "" if lang == "hu" else "../")
            body = gate_case_links(body)
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
                analytics=analytics_head(base),
                pagekey=key,
                ceiling=meta.get("ceiling", "20000"),
                # A `summary` or `draft` case study is reachable and its links
                # are worth following; it is simply not a page to rank as a case
                # study. `follow` keeps the outbound equity, `noindex` keeps the
                # claim honest.
                robots="" if indexable(key)
                       else '\n<meta name="robots" content="noindex, follow">',
                body_class="",
                instruments=chrome,
                extra_css=page_css(meta, base),
                extra_js="",
                skip=u["skip"], unit=u["unit"], layer0=u["layers"][0],
                burger_aria=u["burger_aria"],
                # ---- Phase 8.5 flight deck, shared with the React homepage
                deck=build_deck(lang, key, base, href(lang, "index")),
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
