#!/bin/bash
set -euo pipefail

# Create fixtures directory
FIXTURES_DIR="./fixtures"
mkdir -p "$FIXTURES_DIR"

# Generate tone-a.wav (440 Hz, 3 s)
ffmpeg -y -f lavfi -i "sine=frequency=440:duration=3" -c:a pcm_s16le "$FIXTURES_DIR/tone-a.wav" 2>/dev/null
echo "Created $FIXTURES_DIR/tone-a.wav"

# Generate tone-b.wav (660 Hz, 3 s)
ffmpeg -y -f lavfi -i "sine=frequency=660:duration=3" -c:a pcm_s16le "$FIXTURES_DIR/tone-b.wav" 2>/dev/null
echo "Created $FIXTURES_DIR/tone-b.wav"

# Generate tone-c.mp3 (880 Hz, 3 s, libmp3lame)
ffmpeg -y -f lavfi -i "sine=frequency=880:duration=3" -c:a libmp3lame -b:a 320k "$FIXTURES_DIR/tone-c.mp3" 2>/dev/null
echo "Created $FIXTURES_DIR/tone-c.mp3"

# Generate tone-d.flac (330 Hz, 3 s)
ffmpeg -y -f lavfi -i "sine=frequency=330:duration=3" -c:a flac "$FIXTURES_DIR/tone-d.flac" 2>/dev/null
echo "Created $FIXTURES_DIR/tone-d.flac"

# Generate cover.png (600x600 solid color - bright green)
ffmpeg -y -f lavfi -i "color=c=00FF00:s=600x600" -frames:v 1 "$FIXTURES_DIR/cover.png" 2>/dev/null
echo "Created $FIXTURES_DIR/cover.png"

# Generate cover2.jpg (600x600 different color - bright blue)
ffmpeg -y -f lavfi -i "color=c=0000FF:s=600x600" -frames:v 1 "$FIXTURES_DIR/cover2.jpg" 2>/dev/null
echo "Created $FIXTURES_DIR/cover2.jpg"
