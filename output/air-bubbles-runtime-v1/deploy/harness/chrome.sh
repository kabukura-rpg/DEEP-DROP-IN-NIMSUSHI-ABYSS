#!/bin/sh
# chrome.sh <renderer> <port> <profile-dir>: one headless Chrome per renderer.
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
COMMON="--headless=new --no-sandbox --hide-scrollbars --mute-audio --autoplay-policy=no-user-gesture-required --no-first-run --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows"
case "$1" in
  webgl) R="--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader" ;;
  canvas-accel) R="--disable-webgl" ;;
  canvas-soft) R="--disable-webgl --disable-gpu --disable-accelerated-2d-canvas --disable-gpu-rasterization" ;;
esac
exec "$C" $COMMON $R --remote-debugging-port=$2 --user-data-dir="$3" about:blank
