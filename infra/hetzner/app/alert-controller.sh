#!/bin/sh
set -eu

umask 077

interval=${AIBRAIN_ALERT_INTERVAL_SECONDS:-60}
case "$interval" in
  ''|*[!0-9]*) echo "AIBRAIN_ALERT_INTERVAL_SECONDS must be an integer" >&2; exit 64 ;;
esac
[ "$interval" -ge 15 ] && [ "$interval" -le 3600 ] \
  || { echo "AIBRAIN_ALERT_INTERVAL_SECONDS must be between 15 and 3600" >&2; exit 64; }
[ "${AIBRAIN_ALERT_SINK:-}" = webhook ] \
  || { echo "AIBRAIN_ALERT_SINK=webhook is required" >&2; exit 78; }
[ -n "${AIBRAIN_ALERT_WEBHOOK_URL:-}" ] \
  || { echo "AIBRAIN_ALERT_WEBHOOK_URL is required" >&2; exit 78; }

while :; do
  status=$(/usr/local/bin/aibrain-alerts \
    --restart-count-15m "${AIBRAIN_ALERT_RESTART_COUNT_15M:-0}" \
    --preflight-failure-count-15m "${AIBRAIN_ALERT_PREFLIGHT_FAILURE_COUNT_15M:-0}")
  printf '%s\n' "$status"
  printf '%s\n' "$status" > /tmp/.aibrain-alert-controller-status.pending
  chmod 0600 /tmp/.aibrain-alert-controller-status.pending
  mv /tmp/.aibrain-alert-controller-status.pending /tmp/aibrain-alert-controller-status.json
  date +%s > /tmp/.aibrain-alert-controller-heartbeat.pending
  chmod 0600 /tmp/.aibrain-alert-controller-heartbeat.pending
  mv /tmp/.aibrain-alert-controller-heartbeat.pending /tmp/aibrain-alert-controller-heartbeat
  sleep "$interval"
done
