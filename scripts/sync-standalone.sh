#!/usr/bin/env bash
# scripts/sync-standalone.sh
#
# Generates:
#   1. templates/haggadah-kids-latex/source.tex  (kids preamble + adult body)
#   2. standalone/haggadah/                       (from adult template)
#   3. standalone/haggadah-kids/                  (from kids template)
#
# The adult template (templates/haggadah-latex/source.tex) is the single
# source of truth for all Haggadah body content.  Each variant defines
# only a preamble; this script splices preamble + body together and then
# generates self-contained standalone directories with local font/image paths.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

ADULT_SOURCE="$REPO_ROOT/templates/haggadah-latex/source.tex"
KIDS_PREAMBLE="$REPO_ROOT/templates/haggadah-kids-latex/preamble.tex"
KIDS_SOURCE="$REPO_ROOT/templates/haggadah-kids-latex/source.tex"

# ── Step 1: Build kids source.tex from preamble + adult body ──────────

echo "==> Building kids template source.tex"

# Extract body: everything from \begin{document} onward
BODY_START=$(grep -n '\\begin{document}' "$ADULT_SOURCE" | head -1 | cut -d: -f1)
if [ -z "$BODY_START" ]; then
  echo "ERROR: Could not find \\begin{document} in $ADULT_SOURCE" >&2
  exit 1
fi

tail -n +"$BODY_START" "$ADULT_SOURCE" > /tmp/_haggadah_body.tex
cat "$KIDS_PREAMBLE" /tmp/_haggadah_body.tex > "$KIDS_SOURCE"
rm -f /tmp/_haggadah_body.tex

echo "    wrote $KIDS_SOURCE"

# ── Step 2: Generate standalone directories ───────────────────────────

# generate_standalone  TEMPLATE_ID  SOURCE_TEX  IMAGE_DIR  FONT_LIST_FILE
#
# FONT_LIST_FILE is a text file with one font filename per line.
generate_standalone() {
  local TEMPLATE_ID="$1"
  local SOURCE_TEX="$2"
  local IMAGE_DIR="$3"
  local -a FONTS=()

  # Read font list from remaining arguments
  shift 3
  while [ $# -gt 0 ]; do
    FONTS+=("$1")
    shift
  done

  local STANDALONE_DIR="$REPO_ROOT/standalone/$TEMPLATE_ID"

  echo "==> Generating standalone/$TEMPLATE_ID"

  # Preserve manually-maintained docs, then clean and rebuild
  local tmp_docs="/tmp/_standalone_docs_$$"
  mkdir -p "$tmp_docs"
  for doc in CLAUDE.md README.md; do
    [ -f "$STANDALONE_DIR/$doc" ] && cp "$STANDALONE_DIR/$doc" "$tmp_docs/$doc"
  done
  rm -rf "$STANDALONE_DIR"
  mkdir -p "$STANDALONE_DIR/fonts" "$STANDALONE_DIR/images"
  for doc in CLAUDE.md README.md; do
    [ -f "$tmp_docs/$doc" ] && cp "$tmp_docs/$doc" "$STANDALONE_DIR/$doc"
  done
  rm -rf "$tmp_docs"

  # Transform source.tex:
  #   - Rewrite Docker font paths to local
  #   - Add \graphicspath for standalone compilation
  sed \
    -e 's|Path=/usr/local/share/fonts/|Path=fonts/|g' \
    -e 's|% graphicspath removed.*|\\graphicspath{{images/}}|' \
    "$SOURCE_TEX" > "$STANDALONE_DIR/$TEMPLATE_ID.tex"

  # Copy images
  if [ -d "$IMAGE_DIR" ]; then
    local count
    count=$(find "$IMAGE_DIR" -maxdepth 1 -type f \( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' -o -name '*.pdf' \) -exec cp {} "$STANDALONE_DIR/images/" \; -print | wc -l)
    echo "    copied $count images"
  else
    echo "    WARNING: image dir $IMAGE_DIR not found"
  fi

  # Copy fonts
  local font_count=0
  for font in "${FONTS[@]}"; do
    local src="$REPO_ROOT/templates/fonts/$font"
    if [ -f "$src" ]; then
      cp "$src" "$STANDALONE_DIR/fonts/"
      font_count=$((font_count + 1))
    else
      echo "    WARNING: font not found: $font"
    fi
  done
  echo "    copied $font_count fonts"

  echo "    done → $STANDALONE_DIR/"
}

# ── Adult Haggadah ────────────────────────────────────────────────────

generate_standalone "haggadah" \
  "$ADULT_SOURCE" \
  "$REPO_ROOT/templates/haggadah-images" \
  "EFT_TEXTY OTP.ttf" \
  "SecularOne-Regular.ttf" \
  "SimpleCLM-Medium.ttf" \
  "Yiddishkeit 2.0 AAA Bold.otf" \
  "Yiddishkeit 2.0 AAA Regular.otf"

# ── Kids Haggadah ────────────────────────────────────────────────────

generate_standalone "haggadah-kids" \
  "$KIDS_SOURCE" \
  "$REPO_ROOT/templates/haggadah-kids-images" \
  "EFT_TEXTY OTP.ttf" \
  "SecularOne-Regular.ttf" \
  "SimpleCLM-Medium.ttf" \
  "Yiddishkeit 2.0 AAA Bold.otf" \
  "Yiddishkeit 2.0 AAA Regular.otf" \
  "COOPBL.TTF" \
  "ACMESecretAgentBB_Reg.otf" \
  "FredokaOne-Regular.otf" \
  "GIL_____.TTF" \
  "GILB____.TTF" \
  "GILI____.TTF" \
  "GILBI___.TTF"

# ── Step 3: Copy documentation ────────────────────────────────────────

# CLAUDE.md and README.md are maintained manually in standalone/
# but we need to ensure they exist. Copy from templates if present.
for tmpl in haggadah haggadah-kids; do
  local_claude="$REPO_ROOT/standalone/$tmpl/CLAUDE.md"
  local_readme="$REPO_ROOT/standalone/$tmpl/README.md"
  # Only create stubs if they don't already exist (don't overwrite manual edits)
  if [ ! -f "$local_claude" ]; then
    echo "    creating stub CLAUDE.md for $tmpl"
    echo "# $tmpl — see the main project for editing instructions" > "$local_claude"
  fi
  if [ ! -f "$local_readme" ]; then
    echo "    creating stub README.md for $tmpl"
    echo "# $tmpl — Standalone LaTeX project" > "$local_readme"
  fi
done

echo ""
echo "Sync complete!"
echo "  standalone/haggadah/"
echo "  standalone/haggadah-kids/"
echo "  templates/haggadah-kids-latex/source.tex"
