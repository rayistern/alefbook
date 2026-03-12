#!/usr/bin/env python3
"""Extract elements from an IDML spread for a specific page."""

import sys
import xml.etree.ElementTree as ET
import math
import os
import urllib.parse

IDML_DIR = "/tmp/idml"
PT_TO_PX = 96.0 / 72.0  # 1.3333...
PAGE_SIZE_PT = 405.0
BLEED_PT = 13.5

NS = {"idPkg": "http://ns.adobe.com/AdobeInDesign/idml/1.0/packaging"}


def parse_transform(s):
    """Parse '1 0 0 1 tx ty' into (a, b, c, d, tx, ty)."""
    parts = list(map(float, s.strip().split()))
    return tuple(parts)


def compose(outer, inner):
    oa, ob, oc, od, otx, oty = outer
    ia, ib, ic, id_, itx, ity = inner
    return (
        oa * ia + oc * ib,
        ob * ia + od * ib,
        oa * ic + oc * id_,
        ob * ic + od * id_,
        oa * itx + oc * ity + otx,
        ob * itx + od * ity + oty,
    )


def apply_transform(t, x, y):
    a, b, c, d, tx, ty = t
    return (a * x + c * y + tx, b * x + d * y + ty)


def get_anchors(elem):
    """Get PathPointType Anchor values from element."""
    anchors = []
    for ppt in elem.iter("PathPointType"):
        anchor = ppt.get("Anchor")
        if anchor:
            parts = list(map(float, anchor.split()))
            anchors.append((parts[0], parts[1]))
    return anchors


def get_bounds(anchors):
    """Get (min_x, min_y, max_x, max_y) from anchor points."""
    if not anchors:
        return None
    xs = [a[0] for a in anchors]
    ys = [a[1] for a in anchors]
    return (min(xs), min(ys), max(xs), max(ys))


def get_geometric_bounds(elem):
    """Try GeometricBounds attribute first, then PathPointType anchors."""
    gb = elem.get("GeometricBounds")
    if gb:
        parts = list(map(float, gb.split()))
        return (parts[1], parts[0], parts[3], parts[2])  # top,left,bottom,right -> left,top,right,bottom
    anchors = get_anchors(elem)
    if anchors:
        return get_bounds(anchors)
    return None


IDENTITY = (1, 0, 0, 1, 0, 0)


def walk_elements(node, parent_transform, page_origin_x, page_origin_y, results, depth=0):
    """Recursively walk the XML tree extracting elements."""
    for child in node:
        tag = child.tag

        if tag in ("TextFrame", "Rectangle", "Polygon", "Oval", "GraphicLine"):
            local_t = parse_transform(child.get("ItemTransform", "1 0 0 1 0 0"))
            world_t = compose(parent_transform, local_t)

            anchors = get_anchors(child)
            bounds = get_bounds(anchors)
            if not bounds:
                continue

            local_min_x, local_min_y, local_max_x, local_max_y = bounds
            local_w = local_max_x - local_min_x
            local_h = local_max_y - local_min_y
            local_cx = (local_min_x + local_max_x) / 2
            local_cy = (local_min_y + local_max_y) / 2

            # Apply world transform to center
            spread_cx, spread_cy = apply_transform(world_t, local_cx, local_cy)

            # Check if on target page
            page_cx = spread_cx - page_origin_x
            page_cy = spread_cy - page_origin_y

            if not (-BLEED_PT <= page_cx <= PAGE_SIZE_PT + BLEED_PT and
                    -BLEED_PT <= page_cy <= PAGE_SIZE_PT + BLEED_PT):
                continue

            # Compute scale and rotation
            a, b, c, d, tx, ty = world_t
            scale_x = math.sqrt(a * a + b * b)
            scale_y = math.sqrt(c * c + d * d)
            rotation = math.degrees(math.atan2(b, a))

            # Final pixel dimensions
            w_px = local_w * scale_x * PT_TO_PX
            h_px = local_h * scale_y * PT_TO_PX
            left_px = (page_cx - local_w * scale_x / 2) * PT_TO_PX
            top_px = (page_cy - local_h * scale_y / 2) * PT_TO_PX

            info = {
                "tag": tag,
                "left_px": round(left_px, 1),
                "top_px": round(top_px, 1),
                "width_px": round(w_px, 1),
                "height_px": round(h_px, 1),
                "rotation": round(rotation, 1) if abs(rotation) > 0.5 else 0,
                "z_index": len(results) + 1,
            }

            # For TextFrame, get ParentStory
            if tag == "TextFrame":
                info["parent_story"] = child.get("ParentStory")

            # For Rectangle with Image, get linked file
            if tag == "Rectangle":
                for img in child.iter("Image"):
                    for link in img.iter("Link"):
                        uri = link.get("LinkResourceURI", "")
                        filename = urllib.parse.unquote(uri.split("/")[-1]) if uri else ""
                        info["image"] = filename
                fill = child.get("FillColor", "")
                if fill and fill != "Color/Paper" and fill != "Swatch/None":
                    info["fill_color"] = fill

            if tag == "Polygon":
                fill = child.get("FillColor", "")
                if fill and fill != "Swatch/None":
                    info["fill_color"] = fill

            results.append(info)

        elif tag == "Group":
            local_t = parse_transform(child.get("ItemTransform", "1 0 0 1 0 0"))
            world_t = compose(parent_transform, local_t)
            walk_elements(child, world_t, page_origin_x, page_origin_y, results, depth + 1)


def read_story(story_id):
    """Read a story XML and extract text with formatting."""
    story_path = os.path.join(IDML_DIR, "Stories", f"Story_{story_id}.xml")
    if not os.path.exists(story_path):
        return None

    tree = ET.parse(story_path)
    root = tree.getroot()

    paragraphs = []
    for psr in root.iter("ParagraphStyleRange"):
        justification = psr.get("Justification", "")
        para_runs = []
        for csr in psr.iter("CharacterStyleRange"):
            font_style = csr.get("FontStyle", "Regular")
            point_size = csr.get("PointSize", "12")
            fill_color = csr.get("FillColor", "")
            tracking = csr.get("Tracking", "0")

            # Get font from Properties/AppliedFont
            font_name = ""
            for props in csr.iter("Properties"):
                for af in props.iter("AppliedFont"):
                    font_name = af.text or ""

            # Get text content
            texts = []
            for content in csr.iter("Content"):
                if content.text:
                    texts.append(content.text)
            for br in csr.iter("Br"):
                texts.append("\n")

            if texts:
                para_runs.append({
                    "text": "".join(texts),
                    "font": font_name,
                    "style": font_style,
                    "size_pt": point_size,
                    "size_px": round(float(point_size) * PT_TO_PX, 1),
                    "color": fill_color,
                    "tracking": tracking,
                })

        if para_runs:
            paragraphs.append({
                "justification": justification,
                "runs": para_runs,
            })

    return paragraphs


def extract_page(spread_file, page_name):
    """Extract all elements for a given page from a spread."""
    spread_path = os.path.join(IDML_DIR, "Spreads", spread_file)
    tree = ET.parse(spread_path)
    root = tree.getroot()

    # Find the target page
    target_page = None
    for page in root.iter("Page"):
        if page.get("Name") == page_name:
            target_page = page
            break

    if target_page is None:
        print(f"Page '{page_name}' not found in {spread_file}")
        # List available pages
        for page in root.iter("Page"):
            print(f"  Available: {page.get('Name')}")
        return

    page_transform = parse_transform(target_page.get("ItemTransform", "1 0 0 1 0 0"))
    page_origin_x = page_transform[4]  # tx
    page_origin_y = page_transform[5]  # ty

    print(f"Page '{page_name}' origin: ({page_origin_x}, {page_origin_y}) pt")
    print(f"Page pixel range: (0,0) to ({PAGE_SIZE_PT * PT_TO_PX:.0f}, {PAGE_SIZE_PT * PT_TO_PX:.0f})")
    print()

    # Walk all spreads
    results = []
    for spread in root.iter("Spread"):
        walk_elements(spread, IDENTITY, page_origin_x, page_origin_y, results)

    # Print results
    for i, elem in enumerate(results):
        print(f"--- Element {i+1}: {elem['tag']} ---")
        print(f"  Position: left={elem['left_px']}px, top={elem['top_px']}px")
        print(f"  Size: {elem['width_px']}x{elem['height_px']}px")
        if elem['rotation']:
            print(f"  Rotation: {elem['rotation']}°")

        if "image" in elem:
            print(f"  Image: {elem['image']}")
        if "fill_color" in elem:
            print(f"  FillColor: {elem['fill_color']}")
        if "parent_story" in elem:
            print(f"  ParentStory: {elem['parent_story']}")
            story = read_story(elem["parent_story"])
            if story:
                for pi, para in enumerate(story):
                    just = para["justification"]
                    for run in para["runs"]:
                        text_preview = run["text"][:80].replace("\n", "\\n")
                        print(f"    [{just}] {run['font']} {run['style']} {run['size_pt']}pt ({run['size_px']}px) color={run['color']}")
                        print(f"      \"{text_preview}\"")
        print()


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python extract_idml_page.py <spread_file> <page_name>")
        print("Example: python extract_idml_page.py Spread_ud3.xml 4")
        sys.exit(1)

    extract_page(sys.argv[1], sys.argv[2])
