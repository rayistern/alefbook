# Image Processing Workflow

Convert Haggadah illustrations from linen-textured backgrounds with Hebrew text into clean images with pure white backgrounds and no text.

## Prerequisites

- Python 3 with `requests` installed (`pip install requests`)
- ImageMagick 7 (`magick` command)
- OpenRouter API key (for Gemini access)

## Pipeline

### Step 1: Gemini — White Background + Text Removal

Send each original image to Gemini via OpenRouter. Gemini handles both text removal and background whitening in a single pass.

**Script:** `gemini_whitebg.py`
**Model:** `google/gemini-3.1-flash-image-preview` (via OpenRouter)

**Two prompts depending on image type:**

- **Box images** (images with a shadow-box frame): _"Make the background outside of the main square/box pure white (#FFFFFF). Every single pixel outside the box must be exactly pure white. Preserve any shadows or artifacts extending beyond the square, but remove all text and symbols. The background must be perfectly uniform pure white with zero variation."_

- **Flat images** (no box — e.g. plagues, four cups, seder plate, four sons): _"Make the entire background pure white (#FFFFFF). Keep all the icons/illustrations exactly as they are but place them on a perfectly uniform pure white background. Remove any text or symbols."_

**Usage:**
```bash
# Single image
python gemini_whitebg.py kadeish1a.png

# All images in newImages/
python gemini_whitebg.py
```

**Input:** `newImages/` directory
**Output:** `newImages_whitebg/` directory

**Notes:**
- Gemini outputs at 1376x768 resolution (may downscale larger originals)
- Results are close to pure white but often off by 1-10 RGB values — Step 2 fixes this
- Gemini is non-deterministic — re-running the same image may give different results
- The API can return 502 errors or empty responses (no image). Just retry — it usually works on the 2nd or 3rd attempt
- Expect to re-run some images 2-3 times to get a result that's both faithful to the original and has a clean white background

### Step 2: ImageMagick — Force Pure White

Gemini gets the background _close_ to white but not pixel-perfect. Use ImageMagick flood fill to force it to exactly `#FFFFFF`.

**Technique:** Add a 1px white border, flood fill from corner (the border connects all edges so one fill covers everything), then remove the border.

```bash
magick input.png \
  -bordercolor white -border 1 \
  -fuzz 4% -fill white -draw "color 0,0 floodfill" \
  -shave 1x1 \
  output.png
```

**Key parameters:**
- `-fuzz 4%` — tolerance for what counts as "close to white". 2% is safer but may leave patches; 4% catches more but risks eating into box shadows. Start with 4%, drop to 2% only if box edges get eaten.
- The white border trick is essential — without it you'd need to flood fill from every edge pixel separately.

**Batch all images:**
```bash
for f in newImages_whitebg/*.png; do
  name=$(basename "$f")
  magick "$f" \
    -bordercolor white -border 1 \
    -fuzz 4% -fill white -draw "color 0,0 floodfill" \
    -shave 1x1 \
    "newImages_processed/$name"
done
```

**Input:** `newImages_whitebg/` directory
**Output:** `newImages_processed/` directory

### Step 3: Verification

Every image must pass **two checks** before it's accepted:

#### Check A: Corner pixel test (automated)

All 4 corners must be pure white (255,255,255):

```bash
for f in newImages_processed/*.png; do
  name=$(basename "$f")
  w=$(magick identify -format "%w" "$f")
  h=$(magick identify -format "%h" "$f")
  tl=$(magick "$f" -crop 1x1+2+2 -format "%[fx:u.r*255],%[fx:u.g*255],%[fx:u.b*255]" info:)
  tr=$(magick "$f" -crop 1x1+$((w-3))+2 -format "%[fx:u.r*255],%[fx:u.g*255],%[fx:u.b*255]" info:)
  bl=$(magick "$f" -crop 1x1+2+$((h-3)) -format "%[fx:u.r*255],%[fx:u.g*255],%[fx:u.b*255]" info:)
  br=$(magick "$f" -crop 1x1+$((w-3))+$((h-3)) -format "%[fx:u.r*255],%[fx:u.g*255],%[fx:u.b*255]" info:)
  status="OK"
  for corner in "$tl" "$tr" "$bl" "$br"; do
    if [ "$corner" != "255,255,255" ]; then status="FAIL"; break; fi
  done
  echo "$status  $name  TL=$tl TR=$tr BL=$bl BR=$br"
done
```

Any image that FAILs needs to be re-run from Step 1 (Gemini). The issue is almost always that Gemini left a gradient too far from white for the flood fill to reach.

#### Check B: Visual consistency review (manual)

Compare each processed image side-by-side with its original. Check for:
- **Content accuracy** — is the illustration the same subject? (Gemini sometimes changes the content entirely, e.g. split matzah → stacked matzot)
- **Style fidelity** — does it match the original art style? (Gemini sometimes makes things more detailed/elaborate)
- **Text fully removed** — no Hebrew text or star symbols remaining
- **No artifacts** — no smudges, color bleeds, or phantom shapes

If an image fails visual review, re-run Step 1 for that image. Gemini is non-deterministic, so a second attempt often produces a more faithful result.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Corner check fails (off-white corners) | Re-run Step 1 (Gemini) for that image, then Step 2 |
| Flood fill eats into box shadow/edges | Decrease fuzz from 4% to 2% for that image |
| Gemini changes the illustration content | Re-run — results vary between attempts. May need 2-3 tries |
| Gemini embellishes/adds detail to illustration | Re-run — this is common, usually resolves in 1-2 retries |
| Gemini leaves a gradient instead of white | Re-run with the stronger prompt emphasizing "every single pixel" and "#FFFFFF" |
| Image has no box (icons on background) | Use the FLAT_IMAGES prompt instead of the box prompt |

## What Didn't Work

These approaches were tried and abandoned:

- **OpenCV inpainting** — Good for text removal on uniform textures, but couldn't handle the linen texture well. Left visible smudges and couldn't remove the decorative star icon (lighter than background).
- **ImageMagick solid color fill** — Painting a flat color over the text area was obvious against the linen texture.
- **ImageMagick texture tiling** — Copying a strip of background to tile over text created visible seams due to texture gradients.
- **ImageMagick white-threshold** — Created patchy results because the background isn't uniform.
- **ImageMagick opacity/alpha masking** — Couldn't distinguish box interior (also light) from outer background, washed out the entire image.
- **ImageMagick -trim** — Couldn't reliably detect content bounds due to shadows connecting to background gradients.

The Gemini approach won because it understands the image semantically (knows what's "background" vs "content") rather than just working with pixel values.

## Directory Structure

```
newImages/           ← Original source images (linen bg + Hebrew text)
newImages_whitebg/   ← After Gemini (white bg, no text, ~white)
newImages_processed/ ← After ImageMagick + verification (pure #FFFFFF white bg)
```
