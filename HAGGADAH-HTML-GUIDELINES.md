# Haggadah HTML Conversion Guidelines

## Pipeline

### Pass 1: Baseline from IDML
- Parse the IDML spread for the target page
- Extract all text frames ON the page (ignore off-page elements from adjacent pages in the spread)
- Get text content, fonts, sizes, colors from Story files
- Position elements using IDML coordinates converted to pixels (1pt = 1.3333px)
- Take a screenshot and compare against the PDF

### Pass 2: Visual Polish
- Fix text overlapping images — shrink or reposition images so text is never obscured
- Align related header elements (Hebrew title, English title, step number) into a coherent row/group
- Ensure readable spacing between all elements
- Check that nothing bleeds off the visible page area unintentionally

## Page Structure

- Wrapper: 576px × 576px
- Page: 540px × 540px with 18px margin
- Background: `../../../images/GREEN1A.jpg` (or page-specific background)
- All content elements use `position: absolute` within the page div
- Page div has `overflow: hidden`

## Design Rules

1. **No text overlapping images.** If an image and text overlap, shrink the image.
2. **Headers should be visually grouped.** Hebrew title, English title, and step number should read as one coherent header row, not scattered randomly.
3. **Off-page IDML content is ignored.** Spreads contain two pages — only include elements that belong to the target page.
4. **It does NOT need to be pixel-perfect to the PDF.** It needs to look good and have all the right content. Exact positions and colors are flexible.
5. **Hebrew text** uses `direction: rtl; unicode-bidi: embed;`
6. **English text** uses `direction: ltr;`
7. **Use `white-space: nowrap`** for single-line text (titles, labels) to prevent unexpected wrapping.
8. **Scaled text frames**: If IDML transform has scale factors (a ≠ 1 or d ≠ 1), effective font size = IDML size × scale factor.

## Fonts

| Font | File | Typical Use |
|------|------|-------------|
| Yiddishkeit 2.0 AAA | `Document fonts/Yiddishkeit 2.0 AAA Bold.otf` | Hebrew section titles |
| Fredoka One | `Document fonts/FredokaOne-Regular.otf` | English titles, seder step names |
| Gill Sans MT | System font | English body text |
| ACME Secret Agent BB | `Document fonts/ACMESecretAgentBB.otf` | Italic instruction lines |
| EFT Texty | `Document fonts/` | Hebrew body text |
| KG Second Chances Sketch | `Document fonts/KGSecondChancesSketch.ttf` | Step numbers in circles |

Font paths from HTML: `../../../Document fonts/filename`

## Colors

| Name | Hex | Use |
|------|-----|-----|
| mainHebrew | #095354 | Hebrew titles, English subtitles |
| letre 2 | #0d32d1 | Blue Hebrew text (seder steps) |
| C=35 M=91 Y=100 K=76 | #270500 | Dark brown English text |
| Black | #000000 | Body text |
| Paper | #ffffff | White |

## Section Header Pattern

Many pages have a section header with three elements:
- **Hebrew title** (large, e.g. מַגִּיד) — Yiddishkeit font, blue or teal
- **English title** (e.g. "Maggid") — Fredoka One, teal or brown
- **Step number** in a hand-drawn circle — KG Second Chances Sketch font

These three should be **visually aligned as a coherent header group**, typically in a single horizontal band near the top of the page.

## Images

- Referenced via `../../../images/filename`
- Gray placeholder boxes are acceptable if the image file doesn't exist
- Images should NEVER obscure text — resize if needed
- Partially off-page images should be clipped by the page's `overflow: hidden`

## Spread → Page Mapping

| Spread | Pages |
|--------|-------|
| Spread_ucc.xml | 1 |
| Spread_ud2.xml | II, III |
| Spread_ud3.xml | 4, 5 |
| Spread_ud4.xml | 6, 7 |
| Spread_ud5.xml | 8, 9 |
| Spread_ud6.xml | 10, 11 |
| Spread_ud7.xml | 12, 13 |
| Spread_ud8.xml | 14, 15 |
| Spread_ud9.xml | 16, 17 |
| Spread_uda.xml | 18, 19 |
| Spread_udb.xml | 20, 21 |
| Spread_udc.xml | 22, 23 |
| Spread_udd.xml | 24, 25 |
| Spread_ude.xml | 26, 27 |
| Spread_udf.xml | 28, 29 |
| Spread_ue0.xml | 30, 31 |
| Spread_ue1.xml | 32, 33 |
| Spread_ue2.xml | 34, 35 |
| Spread_ue3.xml | 36, 37 |
| Spread_ue4.xml | 38, 39 |
| Spread_u157.xml | 40 |
