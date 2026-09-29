#!/usr/bin/env bash
# Builds a static, LGPL-only ffmpeg (with libmp3lame) from pinned sources for the packaged Mac
# app. Output: electron/vendor/ffmpeg/<uname -m>/ffmpeg (git-ignored). See ADR 0006.
#
# Usage: bash scripts/build-ffmpeg.sh [--force]
# No user input reaches any command here; every URL, version and checksum is pinned below.
set -euo pipefail

FFMPEG_VERSION="9.0.2"
FFMPEG_URL="https://ffmpeg.org/releases/ffmpeg-${FFMPEG_VERSION}.tar.xz"
# ffmpeg.org publishes no .sha256 for this file; this value was computed over HTTPS on 29 Sep 2026.
FFMPEG_SHA256="8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e"

LAME_VERSION="3.100"
LAME_URL="https://downloads.sourceforge.net/project/lame/lame/${LAME_VERSION}/lame-${LAME_VERSION}.tar.gz"
LAME_SHA256="ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e"

FORCE=0
if [ "${1:-}" = "--force" ]; then FORCE=1; fi

WEB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ARCH="$(uname -m)"
WORK="$WEB_DIR/.ffmpeg-build"
PREFIX="$WORK/prefix-$ARCH"
OUT="$WEB_DIR/electron/vendor/ffmpeg/$ARCH/ffmpeg"
LICENSES="$WEB_DIR/electron/build/licenses"
JOBS="$(sysctl -n hw.ncpu)"

FFMPEG_CONFIGURE=(
  "--prefix=$PREFIX"
  --disable-gpl --disable-nonfree --disable-version3
  --disable-shared --enable-static --pkg-config-flags=--static
  --disable-programs --enable-ffmpeg
  --disable-doc --disable-network --disable-autodetect --disable-debug --disable-everything
  --enable-libmp3lame
  --enable-protocol=file
  --enable-demuxer=mp3,wav,flac,mov,aiff
  --enable-decoder=mp3float,mp3,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_s16be,pcm_s24be,pcm_s32be,pcm_u8,pcm_alaw,pcm_mulaw,flac,aac,alac
  --enable-parser=mpegaudio,flac,aac
  --enable-encoder=libmp3lame
  --enable-muxer=mp3
  --enable-filter=abuffer,abuffersink,aformat,aresample,anull,atrim
  --enable-swresample
  "--extra-cflags=-I$PREFIX/include"
  "--extra-ldflags=-L$PREFIX/lib"
)

if [ -x "$OUT" ] && [ "$FORCE" -eq 0 ]; then
  echo "build-ffmpeg: $OUT already exists (pass --force to rebuild)"
  ls -l "$OUT"
  exit 0
fi

mkdir -p "$WORK" "$LICENSES" "$(dirname "$OUT")"

fetch() { # url sha256 file
  if [ ! -f "$WORK/$3" ]; then
    echo "build-ffmpeg: downloading $1"
    curl -fsSL -o "$WORK/$3.part" "$1"
    mv "$WORK/$3.part" "$WORK/$3"
  fi
  local actual
  actual="$(shasum -a 256 "$WORK/$3" | awk '{print $1}')"
  if [ "$actual" != "$2" ]; then
    echo "build-ffmpeg: checksum mismatch for $3" >&2
    echo "  expected $2" >&2
    echo "  actual   $actual" >&2
    rm -f "$WORK/$3"
    exit 1
  fi
  echo "build-ffmpeg: $3 checksum ok"
}

fetch "$LAME_URL" "$LAME_SHA256" "lame-${LAME_VERSION}.tar.gz"
fetch "$FFMPEG_URL" "$FFMPEG_SHA256" "ffmpeg-${FFMPEG_VERSION}.tar.xz"

# Fresh extraction each build so a --force rebuild never reuses stale objects.
rm -rf "$WORK/lame-${LAME_VERSION}" "$WORK/ffmpeg-${FFMPEG_VERSION}" "$PREFIX"
tar -xzf "$WORK/lame-${LAME_VERSION}.tar.gz" -C "$WORK"
tar -xJf "$WORK/ffmpeg-${FFMPEG_VERSION}.tar.xz" -C "$WORK"

echo "build-ffmpeg: building lame ${LAME_VERSION}"
(
  cd "$WORK/lame-${LAME_VERSION}"
  # lame 3.100 fails to link on macOS because the export list names a symbol that no longer exists.
  sed -i '' '/lame_init_old/d' include/libmp3lame.sym
  ./configure --prefix="$PREFIX" --disable-shared --enable-static \
    --disable-frontend --disable-decoder --disable-gtktest
  make -j"$JOBS"
  make install
)

echo "build-ffmpeg: building ffmpeg ${FFMPEG_VERSION}"
(
  cd "$WORK/ffmpeg-${FFMPEG_VERSION}"
  ./configure "${FFMPEG_CONFIGURE[@]}"
  make -j"$JOBS"
)

cp "$WORK/ffmpeg-${FFMPEG_VERSION}/ffmpeg" "$OUT"
chmod 755 "$OUT"

# Show the prefix as a placeholder so the committed notice carries no machine paths.
CONFIGURE_LINE="${FFMPEG_CONFIGURE[*]}"
CONFIGURE_LINE="${CONFIGURE_LINE//$PREFIX/<prefix>}"

# Licence texts and the source notice ship inside the app (Resources/licenses).
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/COPYING.LGPLv2.1" "$LICENSES/ffmpeg-COPYING.LGPLv2.1"
cp "$WORK/ffmpeg-${FFMPEG_VERSION}/LICENSE.md" "$LICENSES/ffmpeg-LICENSE.md"
cp "$WORK/lame-${LAME_VERSION}/COPYING" "$LICENSES/lame-COPYING"
cp "$WORK/lame-${LAME_VERSION}/LICENSE" "$LICENSES/lame-LICENSE"
cat > "$LICENSES/SOURCES.md" <<SOURCES
# Third-party components bundled in Locally

Locally ships an unmodified build of the components below, as a separate executable
(\`Contents/Resources/ffmpeg\`) that the app runs as its own process. The LGPL texts are in this
directory. The source archives are available at the URLs listed here.

| Component | Version | Licence | Source | SHA-256 |
|-----------|---------|---------|--------|---------|
| FFmpeg | ${FFMPEG_VERSION} | LGPL 2.1 or later (built with --disable-gpl --disable-nonfree --disable-version3) | ${FFMPEG_URL} | ${FFMPEG_SHA256} |
| LAME (libmp3lame) | ${LAME_VERSION} | LGPL 2 or later | ${LAME_URL} | ${LAME_SHA256} |

LAME is built as a static library and linked into the ffmpeg executable. The only change to its
sources is deleting the \`lame_init_old\` line from \`include/libmp3lame.sym\` so it links on macOS.

FFmpeg configure line (<prefix> is the local LAME install directory):

\`\`\`
./configure ${CONFIGURE_LINE}
\`\`\`

Rebuild with \`npm run desktop:ffmpeg\` in \`apps/web\` (\`scripts/build-ffmpeg.sh\`).
SOURCES

# Post-build checks; each is fatal.
echo "build-ffmpeg: checks"
VERSION_OUT="$("$OUT" -version)"
echo "$VERSION_OUT" | grep -q -e '--disable-gpl' || { echo "check failed: configuration lacks --disable-gpl" >&2; exit 1; }
# ffmpeg 9 no longer prints a licence line in -version; `-L` prints the licence text.
LICENSE_OUT="$("$OUT" -L 2>&1)"
echo "$LICENSE_OUT" | grep -q 'GNU Lesser General Public' || { echo "check failed: licence text does not say LGPL" >&2; exit 1; }
echo "licence: $(echo "$LICENSE_OUT" | grep -m1 'GNU Lesser General Public')"
BAD_LIBS="$(otool -L "$OUT" | tail -n +2 | awk '{print $1}' | grep -v -e '^/usr/lib/' -e '^/System/Library/' || true)"
if [ -n "$BAD_LIBS" ]; then
  echo "check failed: non-system dynamic libraries:" >&2
  echo "$BAD_LIBS" >&2
  exit 1
fi
echo "otool -L: only /usr/lib and /System/Library libraries"
"$OUT" -hide_banner -encoders 2>/dev/null | grep -q libmp3lame || { echo "check failed: libmp3lame encoder missing" >&2; exit 1; }
echo "encoders: libmp3lame present"

echo "build-ffmpeg: built $OUT ($(du -h "$OUT" | awk '{print $1}'))"
