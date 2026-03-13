# IDML → HTML Conversion Process

Proven methodology for converting InDesign IDML pages to pixel-accurate static HTML files. Developed and validated on the Haggadah front cover (page 1, Spread_ucc.xml).

---

## Source files

| File | Purpose |
|---|---|
| `20220301Haggadah10A.idml` | InDesign source (ZIP archive) |
| `images/` | All linked assets: JPGs, PNGs, PSDs |
| `Document fonts/` | All fonts used in the document |

## Page specs (constant across all pages)

| Property | Points | Pixels (96 dpi) |
|---|---|---|
| Page size | 405 × 405 pt | 540 × 540 px |
| Bleed | 13.5 pt each side | 18 px each side |
| Full canvas (with bleed) | 432 × 432 pt | 576 × 576 px |
| **Scale factor** | 1 pt = 96/72 px | **1.3333…** |

## Spread / page map

The IDML contains 21 spreads in order (from `designmap.xml`). The document uses `FacingPages="true"` with `PageBinding="RightToLeft"` (Hebrew/RTL).

| Spread file | Pages | Notes |
|---|---|---|
| `Spread_ucc.xml` | 1 (cover) | Single-page spread |
| `Spread_ud2.xml` | II, III | Roman-numeral interior pages |
| `Spread_ud3.xml` | 4, 5 | |
| `Spread_ud4.xml` | 6, 7 | |
| `Spread_ud5.xml` | 8, 9 | |
| `Spread_ud6.xml` | 10, 11 | |
| `Spread_ud7.xml` | 12, 13 | |
| `Spread_ud8.xml` | 14, 15 | |
| `Spread_ud9.xml` | 16, 17 | |
| `Spread_uda.xml` | 18, 19 | |
| `Spread_udb.xml` | 20, 21 | |
| `Spread_udc.xml` | 22, 23 | |
| `Spread_udd.xml` | 24, 25 | |
| `Spread_ude.xml` | 26, 27 | |
| `Spread_udf.xml` | 28, 29 | |
| `Spread_ue0.xml` | 30, 31 | |
| `Spread_ue1.xml` | 32, 33 | |
| `Spread_ue2.xml` | 34, 35 | |
| `Spread_ue3.xml` | 36, 37 | |
| `Spread_ue4.xml` | 38, 39 | |
| `Spread_u157.xml` | 40 (back cover) | Single-page spread |

---

## Step 1 — Unzip and read the IDML

```bash
mkdir -p /tmp/idml && unzip -o 20220301Haggadah10A.idml -d /tmp/idml
```

Key files to read for each page:

1. **`Spreads/Spread_XXX.xml`** — all elements on the spread with exact coordinates and transforms
2. **`Stories/Story_YYY.xml`** — text content for each TextFrame (matched by `ParentStory` attribute)
3. **`Resources/Graphic.xml`** — CMYK color swatch definitions (optional — colors also appear inline)

## Step 2 — Identify which page you're extracting

Each spread XML contains one `<Page>` element (single-page spread) or two `<Page>` elements (facing-pages spread). Each page has:

- **`Name`** — the page number (e.g. "4", "5", "II")
- **`GeometricBounds`** — always `"0 0 405 405"` (top, left, bottom, right in local coords)
- **`ItemTransform`** — places the page on the spread:
  - **Right page** (even #, or first in RTL): `"1 0 0 1 0 -202.5"` → spread origin at `(0, -202.5)`
  - **Left page** (odd #, or second in RTL): `"1 0 0 1 -405 -202.5"` → spread origin at `(-405, -202.5)`

For a two-page spread, you extract elements for **each page separately** by filtering which elements fall within that page's bounds.

## Step 3 — Extract elements from the spread XML

Walk the XML tree recursively. Track these element types:

| Tag | What it is |
|---|---|
| `Rectangle` | Image frame (if contains `<Image>` + `<Link>`) or colored box (if `FillColor` set) |
| `TextFrame` | Text container — get content from `Stories/Story_{ParentStory}.xml` |
| `Group` | Container — inherits transform to children, no visual output itself |
| `Polygon` | Arbitrary shape with fill |
| `Oval` | Ellipse with fill |

### Transform chain

Every element has an `ItemTransform="a b c d tx ty"` attribute — a 2D affine matrix. Elements nested inside Groups inherit the parent's transform via matrix composition:

```
world_transform = parent_transform × local_transform
```

Where matrix composition is:
```
compose(outer, inner):
  a = o.a*i.a + o.c*i.b
  b = o.b*i.a + o.d*i.b
  c = o.a*i.c + o.c*i.d
  d = o.b*i.c + o.d*i.d
  tx = o.a*i.tx + o.c*i.ty + o.tx
  ty = o.b*i.tx + o.d*i.ty + o.ty
```

**Important**: Some spreads have wrapper Rectangles/Groups with large Y-offsets that cancel each other out (e.g., `(1,0,0,1,0,-23868)` parent + `(1,0,0,1,0,23868)` child = identity). Always compose the full chain.

### Bounding box

Each element's shape is defined by `PathPointType Anchor` values inside `Properties > PathGeometry`. These give corners in the element's **local** coordinate system:

```xml
<PathPointType Anchor="-99.36 -36.09" />  <!-- top-left -->
<PathPointType Anchor="-99.36 3.91" />    <!-- bottom-left -->
<PathPointType Anchor="85.33 3.91" />     <!-- bottom-right -->
<PathPointType Anchor="85.33 -36.09" />   <!-- top-right -->
```

Local width = max_x − min_x, local height = max_y − min_y.

### Converting to page pixels

1. **Apply world transform** to the local center point → gives center in spread coordinates
2. **Convert spread → page**: `page_pt = spread_pt − page_origin`
   - For a left page: `page_x = spread_x − (−405) = spread_x + 405`
   - For a right page: `page_x = spread_x − 0 = spread_x`
   - Y is always: `page_y = spread_y − (−202.5) = spread_y + 202.5`
3. **Convert pt → px**: `px = pt × (96/72)` = `pt × 1.3333`
4. **Extract rotation**: `rotation_deg = atan2(b, a) × 180/π`
5. **Extract scale**: `scale_x = √(a² + b²)`, `scale_y = √(c² + d²)`
6. **Final CSS size**: `width_px = local_width × scale_x × (96/72)`

### Filtering on-page vs off-page

An element is **on-page** if its center (in page coordinates) falls within `0..405 pt` (or `0..540 px`). Elements on the pasteboard (outside these bounds) should be **excluded** — they're reference/promotional items, not part of the page layout.

## Step 4 — Extract text content and formatting

For each `TextFrame`, read `Stories/Story_{ParentStory}.xml`. The story XML contains:

```xml
<ParagraphStyleRange Justification="CenterAlign">
  <CharacterStyleRange FontStyle="Black" PointSize="50" FillColor="Color/mainHebrew">
    <Properties>
      <AppliedFont type="string">Yiddishkeit 2.0 AAA</AppliedFont>
    </Properties>
    <Content>הגדה של פסח</Content>
  </CharacterStyleRange>
</ParagraphStyleRange>
```

Extract per character run:
- **Font family** — from `<AppliedFont>` inside `<Properties>` (not from the attribute)
- **Font style** — `FontStyle` attribute: "Bold", "Black", "Italic", "Regular", etc.
- **Size** — `PointSize` in pt → convert to px (× 96/72)
- **Color** — `FillColor` reference (e.g., `Color/mainHebrew`)
- **Alignment** — `Justification` on `ParagraphStyleRange`: CenterAlign, LeftAlign, RightAlign
- **Tracking** — `Tracking` attribute → maps to CSS `letter-spacing`

## Step 5 — Convert CMYK colors to RGB

Colors in IDML are CMYK. Convert with:

```
R = 255 × (1 − C/100) × (1 − K/100)
G = 255 × (1 − M/100) × (1 − K/100)
B = 255 × (1 − Y/100) × (1 − K/100)
```

Note: IDML uses `J` for Yellow (Jaune in French), so `C=89 M=1 J=0 N=0` means `CMYK(89, 1, 0, 0)`. `N` = black (Noir).

Define all colors as CSS variables on `:root` for reuse.

## Step 6 — Match images to files

Each `Rectangle` containing an `<Image><Link LinkResourceURI="...">` references a linked file. The URI is URL-encoded; decode it and extract the filename. Map to files in `images/`:

| IDML filename | Available file |
|---|---|
| `LB1A.jpg` | `images/LB1A.jpg` |
| `Asset 5matzawhole.png` | `images/Asset 5matzawhole.png` |
| `Asset 4cup.png` | `images/Asset 4cup.png` |
| `LOGO11B-2X1.psd` | `images/LOGO11B-2X1.png` (convert PSD → PNG first) |

For PSD files, convert to PNG using Pillow:
```python
from PIL import Image
Image.open('images/LOGO11B-2X1.psd').save('images/LOGO11B-2X1.png')
```

## Step 7 — Map fonts to @font-face

Match IDML font names to files in `Document fonts/`:

| IDML `AppliedFont` | File | CSS `font-family` |
|---|---|---|
| `Yiddishkeit 2.0 AAA` (Black) | `Yiddishkeit 2.0 AAA Black.otf` | `'Yiddishkeit'` weight 900 |
| `Fredoka One` | `FredokaOne-Regular.otf` | `'Fredoka One'` weight 400 |
| `Berlin Sans FB Demi` | `BRLNSDB.TTF` | `'Berlin Sans FB Demi'` |
| `DIN Next LT Pro` (Bold) | `DINNextLTPro-Bold.otf` | `'DIN Next LT Pro'` weight 700 |

Only include `@font-face` rules for fonts **actually used on the page**.

## Step 8 — Build the HTML

Output file: `templates/haggadah/pages/page-NNN.html`

```html
<!DOCTYPE html>
<html lang="he" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=576">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }

  @font-face { /* only fonts used on this page */ }

  :root {
    /* CMYK→RGB color variables used on this page */
  }

  .bleed-wrapper {
    width: 576px; height: 576px;
    overflow: hidden; position: relative;
  }

  .page {
    width: 540px; height: 540px;
    position: relative; margin: 18px;
    overflow: hidden;
  }

  /* Background image extends into bleed area */
  .bg-bleed {
    position: absolute;
    left: 0; top: 0;
    width: 576px; height: 576px;
    z-index: 0;
  }
  .bg-bleed img {
    width: 100%; height: 100%;
    object-fit: cover; display: block;
  }

  .el { position: absolute; }
  .hebrew-text { direction: rtl; unicode-bidi: embed; }
  .english-text { direction: ltr; unicode-bidi: embed; }
</style>
</head>
<body>
<div class="bleed-wrapper">
  <div class="bg-bleed">
    <img src="../../../images/BACKGROUND.jpg" alt="" />
  </div>

  <div class="page" id="page-NNN"
       data-page-number="N"
       data-section="SECTION"
       data-is-fixed-liturgy="false">

    <!-- Each element as an absolutely positioned .el div -->
    <!-- Image frame → <img> with src="../../../images/FILENAME" -->
    <!-- Text frame → <div> with font-size, color, font-family, text-align -->
    <!-- Rotated elements → CSS transform: rotate(Xdeg) -->
    <!-- Colored rectangles → background-color from CSS variable -->

  </div>
</div>
</body>
</html>
```

### Positioning rules

- Every element uses `position: absolute` with `left` and `top` in px
- Positions computed as: center_px − (width_px / 2) for left, center_px − (height_px / 2) for top
- Rotations via `transform: rotate(Xdeg)` — angle from `atan2(b, a)` of the world transform
- Background/full-bleed images go in `.bg-bleed` (outside the `.page` div) so they fill the bleed area
- All other elements go inside `.page` with positions relative to the page origin
- Hebrew text gets class `hebrew-text`; English text gets class `english-text`
- Image frames use `<img>` tags; colored rectangles use `background-color`

## Step 9 — Verify with screenshot

```bash
# Using cutycapt (QtWebKit-based)
xvfb-run cutycapt \
  --url=file:///path/to/page-NNN.html \
  --out=screenshot.png \
  --min-width=576 --min-height=576
```

Check:
- Background fills the full bleed area (no gaps at edges)
- Images visible at correct positions and rotations
- Text renders with correct font, size, color, and alignment
- No elements unexpectedly clipped or overflowing
- Positions match the IDML layout

---

## Key lessons learned

1. **Pasteboard elements are off-page.** In IDML, elements can sit outside the page bounds on the "pasteboard." Filter these out by checking if the element center falls within the page's coordinate range. Don't include them in the HTML.

2. **Wrapper transforms often cancel out.** Top-level Rectangles/Groups sometimes have huge Y-offsets (e.g., 23868 pt) that are cancelled by their children. Always compose the full transform chain rather than assuming any single transform is meaningful.

3. **Font names live in `<Properties><AppliedFont>`**, not in the `AppliedFont` XML attribute on `CharacterStyleRange`. The attribute is often empty.

4. **CMYK uses French abbreviations**: C (Cyan), M (Magenta), J (Jaune=Yellow), N (Noir=Black). Don't confuse `J` and `N` values.

5. **Two-page spreads**: For facing-pages spreads, the right page has `ItemTransform` with `tx=0` and the left page has `tx=-405`. Elements must be filtered to the correct page by checking their final spread-coordinate position against the page bounds.

6. **PSD files need conversion.** Browser can't render `.psd` — convert to PNG with Pillow.

7. **Image sizing from IDML.** The `Image` element inside a `Rectangle` may have its own transform (scaling/cropping within the frame). For simple cases, `object-fit: contain` or `object-fit: cover` on the `<img>` is sufficient.
