# Haggadah Shel Pesach — Project Guidelines

## Overview

This document describes the Chabad Haggadah LaTeX project: a professionally typeset, bilingual (Hebrew/English) Passover Haggadah designed for Shluchim to customize and distribute at their local Chabad Houses. The source is a single `.tex` file compiled with **XeLaTeX**.

The project is managed by Merkos 302. The canonical source text comes from the Chabad.org Haggadah (Kehot-based text with instructional guide).

---

## 1. Project Architecture

### File Structure

```
haggadah.tex          ← single master file (all content, styles, layout)
images/               ← directory for illustrations (to be added)
  cover.jpg
  kiddush.jpg
  matzah.jpg
  ...
```

We deliberately use a **single-file architecture** — no separate `.sty` packages, no `\input` includes. This keeps the project simple for non-LaTeX-savvy agents and Shluchim to work with. Everything lives in `haggadah.tex`.

### Compilation

```bash
xelatex haggadah.tex
xelatex haggadah.tex   # always run twice (for cross-references, headers)
```

**Engine:** XeLaTeX only. Do not use pdfLaTeX (no Unicode/OpenType support) or LuaLaTeX (missing `luatexbase.sty` in our environment).

**Why XeLaTeX:** Native Unicode support for Hebrew with nikkud (vowel points), OpenType font features via `fontspec`, and proper RTL support via `polyglossia` + `bidi.sty` for automatic paragraph-level bidirectional text handling.

---

## 2. Design System

### Color Palette

| Name | Hex | Usage |
|------|-----|-------|
| `sederblue` | `#1B3A5C` | Headings, running heads, section titles |
| `sedergold` | `#C5962A` | Ornaments, rules, decorative elements, step numbers |
| `sederwine` | `#722F37` | Instructions/rubrics, English subtitles |
| `sederlight` | `#F5F0E6` | Instruction box background tint |
| `sederborder` | `#D4C5A0` | Image placeholder borders |

### Typography

| Role | Current Font | Scale | Notes |
|------|-------------|-------|-------|
| English body | FreeSerif | 1.0 | Ligatures=TeX enabled |
| English sans | FreeSans | 1.0 | Used for step numbers, UI elements |
| Hebrew body (`\hebrewfont`) | FreeSerif | 1.15× | Script=Hebrew |
| Hebrew large (`\hebrewfontlarge`) | FreeSerif | 1.5× | Sub-section titles |
| Hebrew display (`\hebrewfonttitle`) | FreeSerif | 2.0× | Section titles |

**Font replacement:** FreeSerif is a placeholder. For production, replace with professional Hebrew fonts (e.g., Hadassah, Frank Ruehl, David CLM, SBL Hebrew, Keter YG). To swap fonts, change the font name strings in the `\newfontfamily` declarations in the preamble. The font must:
- Support Hebrew with nikkud (U+05B0–U+05BD, U+05C1–U+05C2)
- Be installed on the compiling machine or placed in the project directory
- Be OpenType (.otf) or TrueType (.ttf)

### Page Geometry

- **Paper size:** 7" × 10" (classic Jewish book proportion, not letter/A4)
- **Margins:** inner 0.9", outer 0.75", top 0.8", bottom 0.85"
- **Rationale:** Larger inner margin accommodates binding. Smaller outer margin keeps text block centered visually.

### Decorative Elements

Every content page has:
- **Gold header rule** (0.4pt) spanning the text block
- **Gold footer rule** (0.3pt) spanning the text block
- **Corner ornaments** (pgfornament #63, 0.7cm, 18% opacity) at all four corners
- These are drawn via `eso-pic` background overlay and controlled by `\ifshowpageornaments`

The cover page and blank pages suppress these via `\showpageornamentsfalse`.

---

## 3. Custom Commands Reference

### Section Headers

```latex
\sedersection{Hebrew Name}{Transliteration}{English Subtitle}{step number}
```
Opens a new page with full decorative header: ornamental rule with "Step N" label, Hebrew title in display size, transliterated name in small caps, English subtitle in wine-colored italic, closing gold rule. Also sets the running header text.

### Content Blocks

```latex
\begin{hebrewblock}
  Hebrew liturgical text here (RTL, large, 1.7× line spacing)
\end{hebrewblock}

\begin{englishblock}
  English translation here (LTR, normal size, 1.25× line spacing)
\end{englishblock}
```

### Inline Hebrew

```latex
The word \texthebrew{מַצָּה} means matzah.
```

### Instructions / Rubrics

```latex
\instruction{Pour the second cup of wine. Uncover the matzot.}
```
Renders as a warm-tinted box with wine-colored left border — visually distinct from liturgical text.

### Separators

```latex
\hebrewenglishsep    % thin gold rule with diamond — between Hebrew and English
\sederdivider         % larger ornamental divider — between major sub-sections
\parasep              % three tiny diamonds — light paragraph break
```

### Sub-Section Titles (within a Seder step)

```latex
\subsedertitle{מַה נִּשְׁתַּנָּה}{Mah Nishtanah}
```

### Image Placeholders

```latex
\haggadahimagefixed{width}{height}{description text}
```
Example: `\haggadahimagefixed{4.5in}{2.5in}{Illustration --- Seder plate}`

To replace with actual images:
```latex
\begin{center}
  \includegraphics[width=4.5in]{images/seder-plate.jpg}
\end{center}
```

---

## 4. Content Structure — The 15 Seder Steps

Each step gets a `\sedersection` call. The standard pattern within each section is:

```
\sedersection{...}

\instruction{Ritual instruction text}

\begin{hebrewblock}
Hebrew liturgical text
\end{hebrewblock}

\hebrewenglishsep

\begin{englishblock}
English translation
\end{englishblock}

\instruction{Next instruction}

... repeat ...
```

**Section lengths vary dramatically:**
- Steps 2, 6, 7, 8, 10, 11, 12 are very short (a paragraph or two)
- Steps 1, 3, 4, 9, 15 are moderate
- Step 5 (Maggid) is roughly half the entire Haggadah
- Steps 13, 14 (Berach, Hallel) are long

### Maggid Sub-Sections

Maggid should be broken into recognizable sub-sections using `\subsedertitle`:
- Ha Lachma Anya ("This is the bread of affliction")
- Mah Nishtanah (The Four Questions)
- Avadim Hayinu ("We were slaves")
- The Four Sons
- "In the beginning our ancestors were idol worshippers"
- The Ten Plagues
- Dayeinu
- Rabban Gamliel's three things (Pesach, Matzah, Maror)
- "In every generation"
- First two paragraphs of Hallel
- Second cup of wine / blessing

---

## 5. Content Editing Rules

### Absolute Rules

1. **Do not add or remove any liturgical text.** The Hebrew and English text comes from the Kehot/Chabad.org Haggadah and must be preserved verbatim.
2. **Instructional/rubric text** (the italicized directions like "Lift the cup," "Lean to the left") may be lightly edited for clarity but should not change the halachic content.
3. If you find a **clear typo** in the source text, fix it and log the change in a `CHANGES.md` file with: original text, corrected text, and location.
4. **Hebrew text must include nikkud** (vowel points) throughout. Do not strip nikkud.
5. **Do not transliterate** Hebrew liturgical text into English. The Haggadah should have Hebrew in Hebrew script.

### Formatting Conventions

- Blessings (brachot) that begin with "Blessed are You..." should have the Hebrew in a `hebrewblock` immediately followed by `\hebrewenglishsep` and the English in an `englishblock`.
- Stage directions / ritual instructions use `\instruction{}`.
- When the text says to do something physical (drink wine, eat matzah, wash hands), always wrap it in `\instruction{}`.
- Use `\sederdivider` between major thematic transitions within a section.
- Use `\parasep` for lighter breaks (e.g., between stanzas of a song).

### Special Characters in LaTeX

Hebrew text goes directly into `hebrewblock` environments — no escaping needed since XeLaTeX handles Unicode natively. For English text, escape these LaTeX special characters:

| Character | Escape to |
|-----------|-----------|
| `&` | `\&` |
| `%` | `\%` |
| `$` | `\$` |
| `#` | `\#` |
| `_` | `\_` |
| `{` | `\{` |
| `}` | `\}` |
| `~` | `\textasciitilde` |
| `"` | use `` `` `` and `''` for proper quotes |
| `--` | en-dash (use `---` for em-dash) |

---

## 6. Customization for Shluchim

### What Shluchim Should Customize

1. **"Your Chabad House"** — appears on the cover page and title page. Replace with the actual Chabad House name.
   - Cover: search for `{\small\textcolor{sedergold}{Your Chabad House}}`
   - Title page: search for `{\Large\scshape Your Chabad House}`
   - PDF metadata: search for `pdfauthor={Your Chabad House}`

2. **Cover image** — replace the `\haggadahimagefixed` on the cover page with an `\includegraphics` of the Chabad House's own cover art, a local photo, or a provided stock image.

3. **Interior images** — all `\haggadahimagefixed` calls throughout the document are image placeholders. Replace them with `\includegraphics` pointing to actual image files.

4. **Optional: Add a dedication page** — insert after the title page with a sponsor's message.

5. **Optional: Add a back-cover page** — with Chabad House contact info, QR code, website.

### What Shluchim Should NOT Change

- The liturgical text (Hebrew or English)
- The order of the 15 steps
- The color palette or typographic hierarchy (for brand consistency)
- The page geometry (printing will be set up for 7×10)

### Automated Customization (for Agent)

An agent script should:
1. Accept a Chabad House name as input
2. Find-and-replace "Your Chabad House" in all three locations
3. Optionally accept a cover image path and replace the cover placeholder
4. Compile twice with `xelatex`
5. Output the final PDF

---

## 7. Compilation & QA Checklist

### Before Shipping a Build

- [ ] Compiled twice with `xelatex` (headers and cross-refs need two passes)
- [ ] Rendered at least 3 pages to PNG and visually inspected (use `pdftoppm -png -r 200 -f N -l N`)
- [ ] Hebrew text renders correctly with nikkud (not boxes or missing glyphs)
- [ ] All 15 section headers appear in order
- [ ] Running headers show correct section names
- [ ] Page numbers appear on all content pages
- [ ] Corner ornaments visible (subtle gold, corners only) on content pages
- [ ] Corner ornaments NOT visible on cover, blank pages, or title page
- [ ] Instruction boxes have cream tint and wine left-border
- [ ] No overfull hbox warnings (check `.log` file)
- [ ] No content overflows off the bottom of any page
- [ ] Cover page fits: Hebrew title, ornaments, English title, image placeholder, publisher name all visible
- [ ] Gold header and footer rules visible on content pages

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Hebrew shows as boxes | Font missing Hebrew glyphs | Install font with Hebrew support |
| `bidi.sty not found` | Missing `texlive-lang-other` package | Install `texlive-lang-other` in Dockerfile |
| Content falls off page bottom | Too much content + `\vspace` | Reduce spacing or let LaTeX break the page naturally |
| Corner ornaments on cover | `\showpageornamentsfalse` not set | Ensure it's set before `\begin{document}` content |
| Blurry PDF | Compiled with wrong engine | Must use `xelatex`, not `pdflatex` |

---

## 8. Printing Specifications

### For Professional Print

- **Trim size:** 7" × 10"
- **Bleed:** Add 0.125" bleed if printer requires it (adjust geometry)
- **Binding:** Perfect bind (softcover) or saddle stitch (if under ~80 pages)
- **Paper:** 80lb text weight, uncoated (cream/natural) recommended for readability
- **Cover:** 100lb cover stock, matte or soft-touch lamination
- **Color:** Interior can be full-color (for images) or 2-color (blue + gold) for cost savings
- **Spine:** Calculate based on final page count × paper thickness

### For Home/Office Printing

- Print at **100% scale** (do not "fit to page" — this will shrink the 7×10 to letter proportions)
- If printing on letter paper (8.5×11), the 7×10 content will be centered with margins
- Recommend duplex (two-sided) printing
- Staple or bind at the spine

---

## 9. Technical Notes

### Bidi (Bidirectional Text) Implementation

We use `polyglossia` with `\setotherlanguage{hebrew}`, which loads `bidi.sty` automatically. This provides proper paragraph-level RTL alignment (flush-right, ragged-left for short lines) and supports inline mixed bidi text. The `texlive-lang-other` package must be installed in the Docker image to provide `bidi.sty`. Custom environments (`hebrewblock`, `\texthebrew`) wrap polyglossia's `hebrew` environment with additional styling.

### Page Ornaments

The `eso-pic` package's `\AddToShipoutPictureBG` draws decorative elements on every page via a TikZ overlay. The `\ifshowpageornaments` toggle controls whether they appear. This runs in the output routine, so it affects ALL pages unless toggled off.

### tcolorbox for Instructions

The `\instruction` command uses `tcolorbox` with `enhanced` and `breakable` skins. This allows instruction boxes to break across pages naturally. The cream background + wine left-border is achieved via `colback=sederlight` and `borderline west`.

---

## 10. Roadmap

### Current Status (Part 1 Complete)
- [x] LaTeX skeleton with all 15 section headers
- [x] Cover page, title page, TOC
- [x] Decorative elements (corner ornaments, header/footer rules, tinted instruction boxes)
- [x] All custom commands defined and working
- [ ] Content: Kadesh through Yachatz (Part 2)
- [ ] Content: Maggid (Part 3)
- [ ] Content: Rachtzah through Nirtzah (Part 4)
- [ ] Images: Replace placeholders with actual illustrations (Part 5)
- [ ] Font upgrade: Swap FreeSerif for professional Hebrew fonts
- [ ] Agent automation: Script for Shliach customization
- [ ] Print-ready: Bleed marks, CMYK color, final proofing

---

## 11. Source Text Files

The content comes from two plain-text files:
- `haggadah_hebrew.txt` — Full Hebrew text with nikkud
- `haggadah_english.txt` — Full English translation with instructional guide

These files may not be in perfect section order. Use the Chabad.org Haggadah page (and the 15-step TOC) as the canonical ordering reference. The agent should scan the files, identify section boundaries by matching known Hebrew/English markers, and slot content into the correct `\sedersection` blocks.

### Section Boundary Markers

To identify where each section begins in the source text, look for these markers:

| Step | Hebrew Marker | English Marker |
|------|--------------|----------------|
| 1. Kadesh | קַדֵּשׁ | Kadesh / Kiddush |
| 2. Urchatz | וּרְחַץ | Urchatz / wash the hands |
| 3. Karpas | כַּרְפַּס | Karpas / vegetable |
| 4. Yachatz | יַחַץ | Yachatz / break the middle matzah |
| 5. Maggid | מַגִּיד | Maggid / Ha lachma anya |
| 6. Rachtzah | רָחְצָה | Rachtzah / wash the hands |
| 7. Motzi | מוֹצִיא | Motzi / Hamotzi |
| 8. Matzah | מַצָּה | Matzah |
| 9. Maror | מָרוֹר | Maror |
| 10. Korech | כּוֹרֵךְ | Korech / Hillel |
| 11. Shulchan Orech | שֻׁלְחָן עוֹרֵךְ | Shulchan Orech / Feast |
| 12. Tzafun | צָפוּן | Tzafun / Afikoman |
| 13. Berach | בָּרֵךְ | Berach / Grace |
| 14. Hallel | הַלֵּל | Hallel |
| 15. Nirtzah | נִרְצָה | Nirtzah / L'shanah |

---

## 12. Agent Instructions for Content Insertion

When processing the source text files and inserting content:

1. **Read both files completely** before making any edits.
2. **Map each paragraph** to its correct Seder step using the boundary markers above.
3. **Classify each paragraph** as one of:
   - **Hebrew liturgical text** → wrap in `\begin{hebrewblock}...\end{hebrewblock}`
   - **English translation** → wrap in `\begin{englishblock}...\end{englishblock}`
   - **Instruction/direction** → wrap in `\instruction{...}`
4. **Place `\hebrewenglishsep`** between each Hebrew block and its English translation.
5. **Place `\sederdivider`** between major sub-sections (e.g., between the Four Questions and the Four Sons in Maggid).
6. **Escape LaTeX special characters** in English text (see Section 5).
7. **Do not escape anything** in Hebrew text inside `hebrewblock` — XeLaTeX handles it natively.
8. **Replace the `\instruction{[Content will be placed here...]}` placeholder** lines with actual content. Remove the placeholder entirely.
9. **Keep image placeholders** — they will be replaced separately in a later step.
10. **After inserting content, compile twice** and visually inspect at least the first page of each section by converting to PNG.
11. **Log any text corrections** in `CHANGES.md`.

### Distinguishing Instructions from Liturgy

In the source text, instructions are typically:
- Parenthetical text: "(Lift the cup and say:)"
- Imperative directions: "Pour the wine", "Lean to the left", "Eat at least..."
- Text describing what to do rather than what to say/read
- Often in a different format or clearly offset from the prayer text

When in doubt, check the Chabad.org Haggadah page — instructions appear in a distinct style there too.
