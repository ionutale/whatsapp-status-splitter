#!/usr/bin/env bash
# Regenerates the tiny fixture videos used by tests. Requires ffmpeg (brew install ffmpeg).
set -euo pipefail
cd "$(dirname "$0")"

# 5s test pattern with audio: 320x240@30, H.264 + AAC
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=320x240:rate=30:duration=5" \
  -f lavfi -i "sine=frequency=440:duration=5" \
  -c:v libx264 -pix_fmt yuv420p -g 30 -c:a aac -b:a 96k -movflags +faststart \
  tiny-5s.mp4

# 3s test pattern without audio
ffmpeg -y -hide_banner -loglevel error \
  -f lavfi -i "testsrc2=size=320x240:rate=30:duration=3" \
  -c:v libx264 -pix_fmt yuv420p -g 30 -an -movflags +faststart \
  tiny-noaudio.mp4

# Same 5s clip with a 90-degree clockwise display rotation (simulates portrait
# phone video). ffmpeg's -display_rotation is counter-clockwise, while the fixture
# contract (Mediabunny getRotation(), the arbiter test) is clockwise, so pass -90.
# Note: the legacy `-metadata:s:v:0 rotate=90` fallback is a no-op in ffmpeg 8.x
# (it writes no display matrix), so it cannot be used here.
ffmpeg -y -hide_banner -loglevel error \
  -display_rotation -90 -i tiny-5s.mp4 -c copy tiny-portrait-rotated.mp4
