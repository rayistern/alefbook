#!/usr/bin/env python3
"""
Convert IDML (InDesign Markup Language) to HTML template for AI-powered book designer.

This script parses the extracted IDML files from a Passover Haggadah and generates
a structured HTML template that an AI can work with on the live AlefBook site.

Book specs:
  - 40 pages, 5.625" x 5.625" square board book
  - RTL (right-to-left) Hebrew binding
  - Bilingual Hebrew/English with transliterations
  - 13.5pt bleed, 9pt margins
"""

import xml.etree.ElementTree as ET
import os
import re
import html as html_module

EXTRACTED_DIR = "idml_extracted"
OUTPUT_FILE = "haggadah_template.html"

# ─── COLOR CONVERSION ───────────────────────────────────────────────

def cmyk_to_rgb_hex(c, m, y, k):
    """Convert CMYK percentages (0-100) to RGB hex string."""
    c, m, y, k = c / 100, m / 100, y / 100, k / 100
    r = int(255 * (1 - c) * (1 - k))
    g = int(255 * (1 - m) * (1 - k))
    b = int(255 * (1 - y) * (1 - k))
    return f"#{r:02x}{g:02x}{b:02x}"


def parse_colors():
    """Parse all named colors from Graphic.xml into a lookup dict."""
    colors = {}
    tree = ET.parse(os.path.join(EXTRACTED_DIR, "Resources/Graphic.xml"))
    for color_elem in tree.getroot().findall(".//Color"):
        name = color_elem.get("Name", "")
        self_id = color_elem.get("Self", "")
        space = color_elem.get("Space", "")
        raw = color_elem.get("ColorValue", "")
        if not raw:
            continue
        vals = [float(v) for v in raw.split()]
        if space == "CMYK" and len(vals) == 4:
            h = cmyk_to_rgb_hex(vals[0], vals[1], vals[2], vals[3])
        elif space == "RGB" and len(vals) == 3:
            h = f"#{int(vals[0]):02x}{int(vals[1]):02x}{int(vals[2]):02x}"
        else:
            h = "#888888"
        entry = {"name": name, "hex": h}
        colors[self_id] = entry
        if name:
            colors[name] = entry
    return colors


# ─── STORY EXTRACTION ────────────────────────────────────────────────

def detect_language(text):
    """Detect if text is primarily Hebrew or English."""
    heb = len(re.findall(r'[\u0590-\u05FF\uFB1D-\uFB4F]', text))
    lat = len(re.findall(r'[a-zA-Z]', text))
    if heb > lat:
        return "he"
    if lat > 0:
        return "en"
    return "he"


def extract_story(story_id):
    """Extract structured paragraphs from an IDML story file."""
    path = os.path.join(EXTRACTED_DIR, "Stories", f"Story_{story_id}.xml")
    if not os.path.exists(path):
        return []
    tree = ET.parse(path)
    story_elem = tree.getroot().find(".//Story")
    if story_elem is None:
        return []

    # Story-level direction
    pref = story_elem.find("StoryPreference")
    story_dir = "rtl"
    if pref is not None and "LeftToRight" in pref.get("StoryDirection", ""):
        story_dir = "ltr"

    paragraphs = []

    for psr in story_elem.findall("ParagraphStyleRange"):
        para_style = psr.get("AppliedParagraphStyle", "").replace("ParagraphStyle/", "").replace("$ID/", "")
        justification = psr.get("Justification", "")
        parts_buf = []

        for csr in psr.findall("CharacterStyleRange"):
            char_style = csr.get("AppliedCharacterStyle", "").replace("CharacterStyle/", "").replace("$ID/", "")
            font_style = csr.get("FontStyle", "")
            point_size = csr.get("PointSize", "")
            fill_color = csr.get("FillColor", "")
            language = csr.get("AppliedLanguage", "")

            font_family = ""
            props = csr.find("Properties")
            if props is not None:
                af = props.find("AppliedFont")
                if af is not None and af.text:
                    font_family = af.text

            for content in csr.findall("Content"):
                if content.text:
                    parts_buf.append({
                        "text": content.text,
                        "char_style": char_style,
                        "font_style": font_style,
                        "point_size": point_size,
                        "fill_color": fill_color,
                        "font_family": font_family,
                        "language": language,
                    })

            # <Br/> = paragraph break within a ParagraphStyleRange
            for _ in csr.findall("Br"):
                if parts_buf:
                    paragraphs.append({
                        "style": para_style,
                        "justification": justification,
                        "parts": parts_buf,
                        "direction": story_dir,
                    })
                    parts_buf = []

        if parts_buf:
            paragraphs.append({
                "style": para_style,
                "justification": justification,
                "parts": parts_buf,
                "direction": story_dir,
            })

    return paragraphs


def story_text(story_id):
    """Get plain text from a story for quick preview."""
    paras = extract_story(story_id)
    return " ".join(
        part["text"] for p in paras for part in p.get("parts", [])
    ).strip()


# ─── HTML RENDERING ──────────────────────────────────────────────────

def render_span(part, colors):
    """Render a text run as an HTML span (or bare text)."""
    text = html_module.escape(part["text"])
    if not text.strip():
        return text

    classes = []
    styles = []
    lang = detect_language(part["text"])

    # Font family mapping
    ff = part.get("font_family", "")
    if "EFT_Texty" in ff or "EFT" in ff:
        classes.append("font-hebrew-body")
    elif "Gill Sans" in ff:
        classes.append("font-english-body")
    elif "Fredoka" in ff:
        classes.append("font-display")
    elif "Assistant" in ff:
        classes.append("font-assistant")
    elif "Secular One" in ff:
        classes.append("font-secular")
    elif "Yiddishkeit" in ff:
        classes.append("font-yiddishkeit")
    elif "CrimeFighter" in ff or "Anime Ace" in ff or "ACME" in ff or "Blowhole" in ff:
        classes.append("font-comic")

    # Character style
    cs = part.get("char_style", "")
    if cs == "bold 2" or part.get("font_style") == "Bold":
        classes.append("bold")
    if part.get("font_style") == "Italic":
        classes.append("italic")

    # Point size (only emit if non-default)
    ps = part.get("point_size", "")
    if ps:
        try:
            size = float(ps)
            if size > 0:
                styles.append(f"font-size: {size}pt")
        except ValueError:
            pass

    # Fill color
    fc = part.get("fill_color", "").replace("Color/", "")
    if fc and fc != "Black" and fc in colors:
        styles.append(f"color: {colors[fc]['hex']}")

    if not classes and not styles:
        if lang == "he":
            return f'<span lang="he">{text}</span>'
        return text

    attrs = ""
    if classes:
        attrs += f' class="{" ".join(classes)}"'
    if styles:
        attrs += f' style="{"; ".join(styles)}"'
    if lang == "he":
        attrs += ' lang="he"'
    return f"<span{attrs}>{text}</span>"


def render_paragraph(para, colors):
    """Render a paragraph to an HTML <p> tag."""
    classes = []
    style = para.get("style", "")

    if "Words" in style and "Hebrew" in style:
        classes.append("words-hebrew")
    elif "Sub Titlle" in style or "Sub Title" in style:
        classes.append("seder-step-label")
    elif "Cover" in style and "White" in style:
        classes.append("cover-text")
    elif "Cover" in style:
        classes.append("section-header")

    j = para.get("justification", "")
    if "Center" in j:
        classes.append("text-center")
    elif "Left" in j:
        classes.append("text-left")

    direction = para.get("direction", "rtl")

    spans = [render_span(p, colors) for p in para.get("parts", [])]
    content = "".join(spans)
    if not content.strip():
        return ""

    cls = f' class="{" ".join(classes)}"' if classes else ""
    d = f' dir="{direction}"'
    return f"<p{cls}{d}>{content}</p>"


def render_story_block(story_id, colors, extra_class="", data_attrs=""):
    """Render a full story as an HTML div block."""
    paras = extract_story(story_id)
    if not paras:
        return ""

    full_text = " ".join(p["text"] for para in paras for p in para.get("parts", []))
    if not full_text.strip():
        return ""

    lang = detect_language(full_text)
    is_personalize = "personalize" in full_text.lower()
    is_instruction = all(
        "Assistant" in (p.get("font_family", "") or "")
        for para in paras for p in para.get("parts", []) if p.get("font_family")
    ) and len(full_text) < 200

    cls = "text-block"
    if lang == "he":
        cls += " hebrew-text"
    else:
        cls += " english-text"
    if is_personalize:
        cls += " personalize-block"
    if is_instruction:
        cls += " instruction"
    if extra_class:
        cls += f" {extra_class}"

    da = f' data-story-id="{story_id}"'
    if is_personalize:
        da += ' data-editable="true"'
    if data_attrs:
        da += f" {data_attrs}"

    lines = []
    for para in paras:
        h = render_paragraph(para, colors)
        if h:
            lines.append(f"        {h}")

    if not lines:
        return ""

    return f'      <div class="{cls}"{da}>\n' + "\n".join(lines) + "\n      </div>"


def image_tag(filename, extra_class=""):
    """Create an image placeholder div."""
    alt = filename.replace(".png", "").replace(".jpg", "").replace(".jpeg", "")
    alt = alt.replace(".svg", "").replace(".psd", "")
    alt = re.sub(r'Asset \d+', '', alt).strip() or "Decorative"

    cls = "page-image"
    fn_lower = filename.lower()
    if any(x in fn_lower for x in ["matz", "cup", "parsley", "egg", "maror", "plate"]):
        cls += " seder-item"
    elif "makot" in fn_lower:
        cls += " plague-illustration"
    elif "artwork" in fn_lower or "shape" in fn_lower:
        cls += " decorative"
    elif "logo" in fn_lower:
        cls += " logo"
    elif "frame" in fn_lower:
        cls += " photo-frame"
    if extra_class:
        cls += f" {extra_class}"

    return f'      <div class="{cls}" data-image="{filename}"><img src="images/{filename}" alt="{alt}" /></div>'


# ─── PAGE DEFINITIONS ────────────────────────────────────────────────
# Hand-mapped from comprehensive IDML spread analysis.
# Each page defines its background, story IDs (in display order), images, and section info.

# Background color mapping (from actual background image colors)
BG_TAN    = "#e8d5b7"   # LB1A.jpg - warm tan/parchment
BG_GREEN  = "#c8dcc0"   # GREEN1A.jpg - sage green
BG_ORANGE = "#f5d5b0"   # ORANGE1A.jpg - warm peach/orange

PAGE_DEFS = [
    # ── Page 1: Front Cover ──
    {
        "name": "1", "bg": BG_TAN, "type": "cover",
        "stories": ["u332d", "u3344", "u33a1", "u33b8", "u33cf", "u33e6", "u3404", "u341b", "u3432", "u337f"],
        "images": ["LOGO11B-2X1.psd", "Asset 5matzawhole.png", "Asset 4cup.png", "AdobeStock_108838120.jpeg"],
    },
    # ── Page II: Book ownership / B"H ──
    {
        "name": "II", "bg": BG_GREEN, "type": "intro",
        "stories": ["u2ff", "u316", "u32f", "u346"],
        "images": [],
    },
    # ── Page III: Seder Order ──
    {
        "name": "III", "bg": BG_GREEN, "type": "seder-order",
        "stories": [
            "u2c8", "u2df", "u181",
            "u19a", "u1b1", "u1c8", "u1df", "u1f6", "u20e",
            "u225", "u23c", "u253", "u26b", "u282", "u299", "u2b0",
        ],
        "images": ["Asset 16plate.png"],
    },
    # ── Page 4: Kadesh (1) & Urchatz (2) ──
    {
        "name": "4", "bg": BG_ORANGE, "type": "content",
        "section": "Kadesh / Urchatz",
        "stories": [
            "ue07", "ue20",  # קַדֵּשׁ label, step 1
            "ud98", "ue7d",  # Shabbat instruction
            "ud81", "uec2",  # Vayechulu (Shabbat)
            "ueab", "ud53",  # Savri Maranan
            "ud3b", "ue94",  # Borei Pri Hagafen
            "ud24", "ue66",  # Kiddush Hebrew/English
            "ud05",          # Saturday night instruction
            "ucee", "ue4e",  # Havdalah Hebrew/English
            "ucd5", "ue37",  # Shehecheyanu Hebrew/English
            "u3c4f",         # Atkinu Seudata
            "uf9a", "uf83",  # וּרְחַץ label, step 2
            "ufc9", "ufb2",  # Urchatz label/instruction
        ],
        "images": ["Asset 4cup.png"],
    },
    # ── Page 5: Karpas (3) & Yachatz (4) ──
    {
        "name": "5", "bg": BG_ORANGE, "type": "content",
        "section": "Karpas / Yachatz",
        "stories": [
            "ub96", "ub68",  # כַּרְפַּס label, step 3
            "ubad",          # Karpas English label
            "ub7f",          # Karpas instruction
            "ufe2", "uff9",  # Borei Pri Ha'adama Hebrew/English
            "uc5a", "uc8a",  # יַחַץ label, step 4
            "uc71",          # Yachatz English label
            "uca1",          # Yachatz instruction
            "ucb8",          # Kadesh summary instruction
        ],
        "images": ["Asset 7parsley.png", "Asset 6matzabroken.png"],
    },
    # ── Page 6: Maggid (5) - Ha Lachma / Four Questions ──
    {
        "name": "6", "bg": BG_TAN, "type": "content",
        "section": "Maggid",
        "stories": [
            "u11a3", "u118c",  # מַגִּיד label
            "u10c6",           # step 5
            "u11ba",           # Fill second cup instruction
            "u10ac", "u11d2",  # Ha Lachma Anya Hebrew/English
        ],
        "images": ["Asset 5matzawhole.png", "Asset 10leftmatza.png"],
    },
    # ── Page 7: Four Questions (Ma Nishtana) ──
    {
        "name": "7", "bg": BG_TAN, "type": "content",
        "section": "Ma Nishtana",
        "stories": [
            "u1202",                         # Children ask intro
            "u1219", "u1230", "u11eb",       # Ma Nishtana header (Heb/translit/Eng)
            "u1247",                         # ???
            "u12e6", "u12fe", "u12cf", "u12b8",  # Q1 (Heb/translit/Eng/num)
            "u128a", "u12a1", "u1273", "u1315",  # Q2
            "u1345", "u135c", "u132e", "u1374",  # Q3
            "u13a3", "u13ba", "u138b", "u13d1",  # Q4
        ],
        "images": [],
    },
    # ── Page 8: Four Children intro + Avadim Hayinu ──
    {
        "name": "8", "bg": BG_GREEN, "type": "content",
        "section": "Four Children",
        "stories": [
            "u15ae",           # Four children intro (English)
            "u14c8", "u1524",  # Wise child Heb/Eng
            "u14df", "u1552",  # Wicked child Heb/Eng
            "u14f6", "u153b",  # Simple child Heb/Eng
            "u150d", "u1569",  # Cannot-ask child Heb/Eng
        ],
        "images": ["Artwork 30.png", "Artwork 32.png", "Artwork 28.png", "Artwork 29.png"],
    },
    # ── Page 9: Avadim Hayinu ──
    {
        "name": "9", "bg": BG_GREEN, "type": "content",
        "section": "Avadim Hayinu",
        "stories": ["u15c5", "u15dc"],  # Hebrew / English
        "images": [],
    },
    # ── Pages 10-11: Maggid body text (beginning) ──
    {
        "name": "10", "bg": BG_ORANGE, "type": "content",
        "section": "Maggid (continued)",
        "stories": ["u16bc"],  # Hebrew body (threaded)
        "note": "Hebrew Maggid text continues through page 17",
        "images": [],
    },
    {
        "name": "11", "bg": BG_ORANGE, "type": "content",
        "stories": [
            "u16d5",           # English body (threaded)
            "u3cd6", "u3cef",  # Instructions: cover matzah/put down cup
            "u3fd8", "u3ff2",  # Instructions (duplicates for facing page)
        ],
        "note": "English Maggid text continues through page 19",
        "images": [],
    },
    # ── Pages 12-13: Maggid continued ──
    {
        "name": "12", "bg": BG_TAN, "type": "content",
        "stories": [],  # Continuation of u16bc (threaded frame)
        "note": "Hebrew text continued from page 10",
        "images": [],
    },
    {
        "name": "13", "bg": BG_TAN, "type": "content",
        "stories": [],  # Continuation of u16d5
        "note": "English text continued from page 11",
        "images": [],
    },
    # ── Pages 14-15: Ten Plagues ──
    {
        "name": "14", "bg": BG_ORANGE, "type": "content",
        "section": "Ten Plagues",
        "stories": [
            "u1ab6", "u1acd", "u1a91", "u1ae4", "u1afb",  # Blood, Frogs, Lice, Wild Animals, Pestilence
            "u1b12", "u1a24", "u1b29", "u1b40", "u1b58",   # Boils, Hail, Locusts, Darkness, Firstborn
            "u3d21", "u3d3a",  # Pour instructions
            "u4009", "u4021", "u403a",  # More pour instructions
        ],
        "images": [
            "Makot-21.png", "Makot-12.png", "Makot-19.png", "Makot-11.png",
            "Makot-20.png", "Makot-15.png", "Makot-16.png", "Makot-17.png", "Makot-18.png",
        ],
    },
    {
        "name": "15", "bg": BG_ORANGE, "type": "content",
        "stories": [],  # Continuation of u16bc/u16d5
        "note": "Hebrew/English text continued",
        "images": [],
    },
    # ── Pages 16-17: Maggid continued ──
    {
        "name": "16", "bg": BG_GREEN, "type": "content",
        "stories": ["u3d51"],  # Pour instruction
        "note": "Hebrew text continued",
        "images": [],
    },
    {
        "name": "17", "bg": BG_GREEN, "type": "content",
        "stories": [],
        "note": "English text continued",
        "images": [],
    },
    # ── Pages 18-19: Dayenu / Rabban Gamliel ──
    {
        "name": "18", "bg": BG_TAN, "type": "content",
        "section": "Dayenu / Rabban Gamliel",
        "stories": [
            "u1cf8",           # Hebrew (Dayenu conclusion, Rabban Gamliel)
            "u3d9a", "u4053",  # Hold the Matzah
            "u3d6b", "u406a",  # Hold the Maror
            "u3db2",           # Cover Matzah, raise cup
        ],
        "images": [],
    },
    {
        "name": "19", "bg": BG_TAN, "type": "content",
        "stories": [],  # English continuation
        "note": "English text continued",
        "images": [],
    },
    # ── Pages 20-21: End of Maggid / Second Cup ──
    {
        "name": "20", "bg": BG_GREEN, "type": "content",
        "section": "Halleluyah / Second Cup",
        "stories": [
            "u1d84",           # Hebrew (Halleluyah, Psalms 113-114, Geulah blessing)
            "u1db4",           # Drink second cup instruction
            "u3631", "u3648",  # Borei Pri Hagafen Hebrew/English
            "u4082",           # Cover Matzah instruction
        ],
        "images": ["Asset 4cup.png"],
    },
    {
        "name": "21", "bg": BG_GREEN, "type": "content",
        "stories": [],  # English continuation
        "note": "English text continued",
        "images": [],
    },
    # ── Pages 22-23: Rachtzah through Tzafun (Steps 6-11) ──
    {
        "name": "22", "bg": BG_TAN, "type": "content",
        "section": "Rachtzah / Motzi Matzah / Maror",
        "stories": [
            "u20df", "u20f8",  # רָחְצָה, step 6
            "u20a5",           # Wash hands instruction
            "u213f", "u2156",  # Netilat Yadayim Hebrew/English
            "u2186", "u216f",  # מוֹצִיא מַצָּה, step 7
            "u2126",           # Motzi Matzah label
            "u210f",           # Hamotzi instruction
            "u3dcd", "u3de4",  # Hamotzi blessing Hebrew/English
            "u3e4b", "u3e62",  # Al Achilat Matzah Hebrew/English
            "u3e96", "u3eaf",  # Instructions (put down / eat)
            "u2251", "u226a",  # מָרוֹר, step 8
            "u21e4",           # Maror instruction
            "u244c", "u2463",  # Al Achilat Maror Hebrew/English
        ],
        "images": ["Asset 13matza3.png", "Asset 12egg.png", "Asset 11marorwhole.png"],
    },
    {
        "name": "23", "bg": BG_TAN, "type": "content",
        "section": "Korech / Shulchan Orech / Tzafun",
        "stories": [
            "u236f", "u2358",  # כּוֹרֵךְ, step 9
            "u233f",           # Korech English label
            "u2328",           # Korech instruction
            "u2388", "u239f",  # Hillel sandwich Hebrew/English
            "u2058", "u23b8",  # שֻׁלְחָן עוֹרֵךְ, step 10
            "u2077",           # Shulchan Orech English label
            "u208e",           # We eat the meal
            "u242d", "u23e8",  # צָפוּן, step 11
            "u2415",           # Tzafun English label
            "u23cf",           # Afikoman instruction
        ],
        "images": [],
    },
    # ── Pages 24-25: Birkat Hamazon (Grace After Meals) ──
    {
        "name": "24", "bg": BG_GREEN, "type": "content",
        "section": "Beirach",
        "stories": [
            "u2558", "u2595",  # בֵּרַךְ label, step 12
            "u257b",           # Beirach label
            "u25ac",           # Grace after meals instruction
            "u250d",           # Hebrew Birkat Hamazon (threaded)
            "u3ec8", "u3ef8",  # Leader instructions
        ],
        "note": "Hebrew Grace continues through page 29",
        "images": [],
    },
    {
        "name": "25", "bg": BG_GREEN, "type": "content",
        "stories": ["u25c3"],  # English Birkat Hamazon (threaded)
        "note": "English Grace continues through page 29",
        "images": [],
    },
    # ── Pages 26-27: Birkat Hamazon continued ──
    {
        "name": "26", "bg": BG_TAN, "type": "content",
        "stories": [],  # Continuation
        "note": "Hebrew Grace continued",
        "images": [],
    },
    {
        "name": "27", "bg": BG_TAN, "type": "content",
        "stories": [],
        "note": "English Grace continued",
        "images": [],
    },
    # ── Pages 28-29: Third Cup ──
    {
        "name": "28", "bg": BG_GREEN, "type": "content",
        "section": "Third Cup",
        "stories": [
            "u26c6",           # Drink third cup instruction
            "u26e5", "u26fc",  # Borei Pri Hagafen Hebrew/English
        ],
        "note": "Hebrew/English text continued",
        "images": ["Asset 4cup.png"],
    },
    {
        "name": "29", "bg": BG_GREEN, "type": "content",
        "stories": [],
        "note": "Text continued",
        "images": [],
    },
    # ── Pages 30-31: Hallel / Nirtzah (Step 13) ──
    {
        "name": "30", "bg": BG_ORANGE, "type": "content",
        "section": "Hallel - Nirtzah",
        "stories": [
            "u27a3", "u27bb",  # הַלֵּל נִרְצָה label
            "u27d6",           # Step 13
            "u27ed",           # Fourth cup & Elijah instruction
            "u2732",           # Hebrew Shfoch/Hallel (threaded)
        ],
        "note": "Hebrew Hallel continues through page 37",
        "images": [],
    },
    {
        "name": "31", "bg": BG_ORANGE, "type": "content",
        "stories": ["u274a"],  # English Hallel (threaded)
        "note": "English Hallel continues through page 37",
        "images": [],
    },
    # ── Pages 32-33: Hallel continued ──
    {
        "name": "32", "bg": BG_TAN, "type": "content",
        "stories": ["u284b"],  # Hebrew Hallel Psalms
        "note": "Hebrew Hallel continued",
        "images": [],
    },
    {
        "name": "33", "bg": BG_TAN, "type": "content",
        "stories": [],
        "note": "English Hallel continued",
        "images": [],
    },
    # ── Pages 34-35: Hallel continued ──
    {
        "name": "34", "bg": BG_GREEN, "type": "content",
        "stories": [],
        "note": "Hebrew Hallel continued",
        "images": [],
    },
    {
        "name": "35", "bg": BG_GREEN, "type": "content",
        "stories": [],
        "note": "English Hallel continued",
        "images": [],
    },
    # ── Pages 36-37: Fourth Cup ──
    {
        "name": "36", "bg": BG_TAN, "type": "content",
        "section": "Fourth Cup",
        "stories": [
            "u36f0",           # Drink fourth cup instruction
            "u370e", "u3725",  # Borei Pri Hagafen Hebrew/English
        ],
        "note": "Hebrew/English text continued",
        "images": ["Asset 4cup.png"],
    },
    {
        "name": "37", "bg": BG_TAN, "type": "content",
        "stories": [],
        "note": "Text continued",
        "images": [],
    },
    # ── Pages 38-39: Concluding Blessings / Next Year in Jerusalem ──
    {
        "name": "38", "bg": BG_GREEN, "type": "content",
        "section": "Concluding Blessing",
        "stories": ["u2a86"],  # Hebrew concluding blessing
        "images": [],
    },
    {
        "name": "39", "bg": BG_GREEN, "type": "content",
        "section": "Next Year in Jerusalem",
        "stories": [
            "u2afc",           # English concluding blessing
            "u2acd", "u2ae4",  # לשנה הבאה בירושלים! / Next Year in Jerusalem!
        ],
        "images": [],
    },
    # ── Page 40: Back Cover ──
    {
        "name": "40", "bg": BG_TAN, "type": "back-cover",
        "stories": ["u2cf6", "u2d0d", "u2d6d", "u2d84", "u2d9b", "u2db3", "u2dd1", "u2de8", "u2dff", "u2d4b"],
        "images": ["LOGO11B-2X1.psd", "Asset 5matzawhole.png", "Asset 4cup.png", "frame.svg"],
    },
]


# ─── HTML GENERATION ─────────────────────────────────────────────────

def generate_page_html(page_def, colors):
    """Generate HTML for a single page."""
    name = page_def["name"]
    bg = page_def["bg"]
    ptype = page_def.get("type", "content")
    section = page_def.get("section", "")
    note = page_def.get("note", "")

    # Render story blocks
    story_blocks = []
    for sid in page_def.get("stories", []):
        block = render_story_block(sid, colors)
        if block:
            story_blocks.append(block)

    # Render image placeholders
    img_blocks = []
    seen = set()
    for fn in page_def.get("images", []):
        if fn not in seen:
            seen.add(fn)
            img_blocks.append(image_tag(fn))

    # Section header comment
    section_comment = ""
    if section:
        section_comment = f"\n      <!-- Section: {section} -->"

    note_comment = ""
    if note:
        note_comment = f"\n      <!-- {note} -->"

    content_html = ""
    if story_blocks or img_blocks:
        content_html = "\n".join(story_blocks + img_blocks)
    elif note:
        content_html = f'      <div class="text-block continuation-marker">\n        <p class="text-center" dir="ltr"><em>[Text continues from previous page]</em></p>\n      </div>'

    return f"""    <div class="page page-{ptype}" id="page-{name}" data-page="{name}" style="background-color: {bg};">{section_comment}{note_comment}
      <div class="page-content">
{content_html}
      </div>
    </div>"""


def _color(colors, name, fallback="#888888"):
    """Safely get a color hex value."""
    entry = colors.get(name)
    if entry:
        return entry.get("hex", fallback)
    return fallback


def generate_full_html(colors):
    """Generate the complete HTML document."""
    pages_html = []
    for page_def in PAGE_DEFS:
        pages_html.append(generate_page_html(page_def, colors))

    total = len(PAGE_DEFS)

    # Pre-resolve colors for CSS variables
    c_main_hebrew = _color(colors, 'mainHebrew', '#095354')
    c_cover_text = _color(colors, 'covertext copy', '#4b0007')
    c_pantone_red = _color(colors, 'PANTONE P 52-15 C', '#f9194f')
    c_pantone_blue = _color(colors, 'PANTONE 300 C', '#008eff')
    c_letre = _color(colors, 'letre', '#0019e5')
    c_letre2 = _color(colors, 'letre 2', '#0d32d1')
    c_rouge = _color(colors, 'Rouge', '#bc0000')
    c_navy = _color(colors, 'texte', '#0054aa')
    c_cream = _color(colors, 'BRACHOSBKGRND copy', '#fff0ec')
    c_rich_black = _color(colors, 'Rich Black 2', '#0d1010')

    return f"""<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Haggadah - AlefBook Template</title>
  <style>
    /* ================================================================
       AlefBook Haggadah HTML Template
       Converted from InDesign IDML: 20220301Haggadah10A.idml
       Page size: 5.625 x 5.625 in (405 x 405 pt) - square board book
       Binding: Right-to-Left (Hebrew)
       Bleed: 13.5pt (0.1875in) all sides
       Margins: 9pt all sides
       ================================================================ */

    /* ── Web Fonts ──
       InDesign fonts -> Web equivalents:
       EFT_Texty (Hebrew body) -> Frank Ruhl Libre
       Gill Sans MT (English body) -> Gill Sans, Lato
       Fredoka One (section headers) -> Fredoka One
       Assistant (instructions) -> Assistant
       Secular One (branding) -> Secular One
    */
    @import url('https://fonts.googleapis.com/css2?family=Assistant:wght@200;300;400;700;800&family=Frank+Ruhl+Libre:wght@400;500;700&family=Fredoka+One&family=Secular+One&family=Lato:wght@400;700&display=swap');

    :root {{
      --page-width: 405pt;
      --page-height: 405pt;
      --bleed: 13.5pt;
      --margin: 9pt;

      /* Named colors from InDesign swatches (CMYK -> RGB) */
      --color-main-hebrew: {c_main_hebrew};
      --color-cover-text: {c_cover_text};
      --color-pantone-red: {c_pantone_red};
      --color-pantone-blue: {c_pantone_blue};
      --color-letre: {c_letre};
      --color-letre2: {c_letre2};
      --color-rouge: {c_rouge};
      --color-navy: {c_navy};
      --color-cream: {c_cream};
      --color-rich-black: {c_rich_black};

      /* Page backgrounds (from background images) */
      --bg-tan: #e8d5b7;
      --bg-green: #c8dcc0;
      --bg-orange: #f5d5b0;
    }}

    * {{ margin: 0; padding: 0; box-sizing: border-box; }}

    body {{
      font-family: 'Frank Ruhl Libre', 'David Libre', serif;
      font-size: 11pt;
      line-height: 1.35;
      color: #000;
      background: #e0e0e0;
      direction: rtl;
    }}

    /* ── Book Container ── */
    .book {{
      max-width: 1000px;
      margin: 20px auto;
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 12px;
      padding: 12px;
    }}

    /* ── Individual Page ── */
    .page {{
      width: var(--page-width);
      min-height: var(--page-height);
      padding: var(--margin);
      background: white;
      position: relative;
      overflow: hidden;
      box-shadow: 0 2px 10px rgba(0,0,0,0.18);
      page-break-after: always;
      border-radius: 2px;
    }}

    .page-content {{
      width: 100%;
      height: 100%;
    }}

    /* ── Text Blocks ── */
    .text-block {{
      margin-bottom: 6pt;
      position: relative;
    }}

    .text-block.hebrew-text {{
      direction: rtl;
      text-align: right;
    }}

    .text-block.english-text {{
      direction: ltr;
      text-align: left;
    }}

    .text-block.instruction {{
      font-family: 'Assistant', sans-serif;
      font-weight: 200;
      font-size: 7pt;
      color: var(--color-rich-black);
      opacity: 0.85;
      margin: 3pt 0;
    }}

    .text-block.personalize-block {{
      border: 2px dashed var(--color-pantone-red);
      padding: 8pt;
      border-radius: 4pt;
      background: rgba(255,255,200,0.25);
    }}

    .text-block.personalize-block::before {{
      content: "\\270F Customizable";
      position: absolute;
      top: -11pt;
      right: 4pt;
      font-size: 7pt;
      color: var(--color-pantone-red);
      font-family: 'Assistant', sans-serif;
      direction: ltr;
    }}

    .text-block.continuation-marker {{
      text-align: center;
      color: #999;
      font-style: italic;
      font-size: 9pt;
      padding: 40pt 0;
    }}

    /* ── Typography ── */
    p {{ margin-bottom: 3pt; }}
    p[dir="rtl"] {{ text-align: right; direction: rtl; }}
    p[dir="ltr"] {{ text-align: left; direction: ltr; }}
    .text-center {{ text-align: center !important; }}
    .text-left {{ text-align: left !important; }}
    .text-right {{ text-align: right !important; }}

    /* Font classes (mapping InDesign fonts to web fonts) */
    .font-hebrew-body {{ font-family: 'Frank Ruhl Libre', serif; }}
    .font-english-body {{ font-family: 'Lato', 'Gill Sans', sans-serif; }}
    .font-display {{ font-family: 'Fredoka One', cursive; }}
    .font-assistant {{ font-family: 'Assistant', sans-serif; }}
    .font-secular {{ font-family: 'Secular One', sans-serif; }}
    .font-yiddishkeit {{ font-family: 'Frank Ruhl Libre', serif; font-weight: 700; }}
    .font-comic {{ font-family: 'Fredoka One', 'Comic Sans MS', cursive; }}

    .bold {{ font-weight: 700; }}
    .italic {{ font-style: italic; }}

    /* ── Paragraph Styles (from InDesign) ── */

    /* Seder step labels (Fredoka One 48pt, deep purple-blue) */
    .seder-step-label {{
      font-family: 'Fredoka One', cursive;
      font-size: 48pt;
      line-height: 1.0;
      color: var(--color-letre2);
      margin: 4pt 0;
    }}

    /* Section headers (Fredoka One 16pt) */
    .section-header {{
      font-family: 'Fredoka One', cursive;
      font-size: 16pt;
      color: var(--color-cover-text);
      margin: 4pt 0;
    }}

    /* "Words (Hebrew)" style - large Hebrew vocabulary */
    .words-hebrew {{
      font-family: 'Assistant', sans-serif;
      font-weight: 300;
      font-size: 48pt;
      color: var(--color-pantone-red);
      line-height: 1.15;
    }}

    /* Cover text (white bold) */
    .cover-text {{
      font-family: 'Fredoka One', cursive;
      font-size: 48pt;
      line-height: 0.83;
      color: white;
      direction: ltr;
      text-align: left;
    }}

    /* Blessing background */
    .blessing-bg {{
      background-color: var(--color-cream);
      padding: 4pt 6pt;
      border-radius: 2pt;
      margin: 3pt 0;
    }}

    /* ── Images ── */
    .page-image {{
      margin: 4pt 0;
      text-align: center;
    }}

    .page-image img {{
      max-width: 100%;
      height: auto;
    }}

    .page-image.seder-item img {{ max-height: 100pt; object-fit: contain; }}
    .page-image.plague-illustration img {{ max-height: 70pt; object-fit: contain; }}
    .page-image.logo img {{ max-height: 40pt; object-fit: contain; }}
    .page-image.photo-frame {{ border: 2pt solid var(--color-pantone-blue); padding: 2pt; }}
    .page-image.decorative {{ opacity: 0.8; }}

    /* ── Spread View ── */
    .spread {{
      display: flex;
      flex-direction: row-reverse;
      justify-content: center;
      gap: 2px;
    }}

    .spread .page {{ margin: 0; }}

    /* ── Print ── */
    @media print {{
      body {{ background: none; }}
      .book {{ gap: 0; }}
      .page {{ box-shadow: none; margin: 0; }}
      .text-block.personalize-block {{ border: none; }}
      .text-block.personalize-block::before {{ display: none; }}
      .continuation-marker {{ display: none; }}
    }}

    /* ── Responsive ── */
    @media screen and (max-width: 600px) {{
      .page {{
        width: 100%;
        min-height: auto;
        aspect-ratio: 1;
      }}
    }}
  </style>
</head>
<body>

<div class="book" id="haggadah-book"
     data-total-pages="{total}"
     data-page-width-pt="405"
     data-page-height-pt="405"
     data-binding="rtl"
     data-bleed-pt="13.5">

{chr(10).join(pages_html)}

</div>

<script type="application/json" id="book-metadata">
{{
  "title": "Passover Haggadah",
  "subtitle": "My Passover Haggadah",
  "hebrew_title": "הגדה של פסח",
  "publisher": "Alef Book",
  "format": "board-book",
  "page_size": {{
    "width_inches": 5.625,
    "height_inches": 5.625,
    "width_pt": 405,
    "height_pt": 405
  }},
  "bleed_pt": 13.5,
  "margin_pt": 9,
  "binding": "right-to-left",
  "total_pages": {total},
  "languages": ["he", "en"],
  "font_mapping": {{
    "EFT_Texty": "Frank Ruhl Libre",
    "Gill Sans MT": "Lato",
    "Fredoka One": "Fredoka One",
    "Assistant": "Assistant",
    "Secular One": "Secular One",
    "FbAvshalom": "Frank Ruhl Libre Bold",
    "CrimeFighter BB": "Fredoka One"
  }},
  "customizable_fields": [
    "child_name",
    "family_photos",
    "personal_messages",
    "dedication"
  ],
  "page_backgrounds": {{
    "tan": "#e8d5b7",
    "green": "#c8dcc0",
    "orange": "#f5d5b0"
  }},
  "seder_sections": [
    {{"step": 1, "name": "Kadesh", "hebrew": "קַדֵּשׁ", "pages": [4]}},
    {{"step": 2, "name": "Urchatz", "hebrew": "וּרְחַץ", "pages": [4]}},
    {{"step": 3, "name": "Karpas", "hebrew": "כַּרְפַּס", "pages": [5]}},
    {{"step": 4, "name": "Yachatz", "hebrew": "יַחַץ", "pages": [5]}},
    {{"step": 5, "name": "Maggid", "hebrew": "מַגִּיד", "pages": [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]}},
    {{"step": 6, "name": "Rachtzah", "hebrew": "רָחְצָה", "pages": [22]}},
    {{"step": 7, "name": "Motzi Matzah", "hebrew": "מוֹצִיא מַצָּה", "pages": [22]}},
    {{"step": 8, "name": "Maror", "hebrew": "מָרוֹר", "pages": [22]}},
    {{"step": 9, "name": "Korech", "hebrew": "כּוֹרֵךְ", "pages": [23]}},
    {{"step": 10, "name": "Shulchan Orech", "hebrew": "שֻׁלְחָן עוֹרֵךְ", "pages": [23]}},
    {{"step": 11, "name": "Tzafun", "hebrew": "צָפוּן", "pages": [23]}},
    {{"step": 12, "name": "Beirach", "hebrew": "בֵּרַךְ", "pages": [24, 25, 26, 27, 28, 29]}},
    {{"step": 13, "name": "Hallel Nirtzah", "hebrew": "הַלֵּל נִרְצָה", "pages": [30, 31, 32, 33, 34, 35, 36, 37, 38, 39]}}
  ]
}}
</script>

</body>
</html>"""


# ─── MAIN ────────────────────────────────────────────────────────────

def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print("Parsing IDML colors...")
    colors = parse_colors()
    print(f"  Found {len(colors)} color definitions")

    print("Generating HTML template...")
    html = generate_full_html(colors)

    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write(html)

    # Count rendered stories
    rendered = 0
    for pd in PAGE_DEFS:
        for sid in pd.get("stories", []):
            paras = extract_story(sid)
            if paras:
                rendered += 1

    print(f"  {len(PAGE_DEFS)} pages, {rendered} stories rendered")
    print(f"Written to {OUTPUT_FILE}")


if __name__ == "__main__":
    main()
