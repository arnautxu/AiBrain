#!/bin/sh
set -eu

case "${SCREEN_SIZE:-1440x900}" in
  *[!0-9x]*) echo "SCREEN_SIZE no vàlid" >&2; exit 64 ;;
esac

export DISPLAY="${DISPLAY:-:99}"

for singleton_lock in SingletonCookie SingletonLock SingletonSocket; do
  singleton_path="/home/browser/profile/$singleton_lock"
  if [ -e "$singleton_path" ] || [ -L "$singleton_path" ]; then
    unlink "$singleton_path"
  fi
done

Xvfb "$DISPLAY" -screen 0 "${SCREEN_SIZE}x24" -nolisten tcp &
xvfb_pid=$!

attempt=0
until xdpyinfo -display "$DISPLAY" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 50 ]; then
    echo "La pantalla virtual no ha arrencat" >&2
    exit 1
  fi
  sleep 0.1
done

openbox >/tmp/openbox.log 2>&1 &
openbox_pid=$!

x11vnc \
  -display "$DISPLAY" \
  -forever \
  -shared \
  -nopw \
  -localhost \
  -rfbport 5900 \
  -o /tmp/x11vnc.log &
vnc_pid=$!

websockify \
  --web=/usr/share/novnc \
  0.0.0.0:6080 \
  127.0.0.1:5900 &
websockify_pid=$!

socat \
  TCP-LISTEN:9223,bind=0.0.0.0,fork,reuseaddr \
  TCP:127.0.0.1:9222 &
cdp_bridge_pid=$!

chromium \
  --user-data-dir=/home/browser/profile \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222 \
  --disable-extensions \
  --disable-background-networking \
  --disable-component-update \
  --disable-default-apps \
  --disable-sync \
  --metrics-recording-only \
  --no-default-browser-check \
  --no-first-run \
  --password-store=basic \
  --start-maximized \
  about:blank &
browser_pid=$!

cleanup() {
  kill "$browser_pid" "$cdp_bridge_pid" "$websockify_pid" "$vnc_pid" "$openbox_pid" "$xvfb_pid" 2>/dev/null || true
  wait || true
}

trap cleanup INT TERM EXIT
wait "$browser_pid"
