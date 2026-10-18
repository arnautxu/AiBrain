#!/usr/bin/env bash
# This disposable container-only job never uses these preinstalled SDKs.
set -euo pipefail

[[ ${GITHUB_ACTIONS:-} == true && ${RUNNER_ENVIRONMENT:-} == github-hosted && ${RUNNER_OS:-} == Linux ]] || {
  echo 'Refusing SDK cleanup outside a disposable GitHub-hosted Linux runner.' >&2
  exit 1
}

if ps -eo comm= | awk '$1 ~ /^(dotnet|adb|gradle|swift|swiftc|ghc|ghci)$/ { found=1 } END { exit !found }'; then
  echo 'A preinstalled SDK is active; refusing cleanup.' >&2
  exit 1
fi

df -B1 /
sdk_paths=(/usr/share/dotnet /usr/local/lib/android /opt/ghc /usr/share/swift /usr/local/.ghcup)
for sdk_path in "${sdk_paths[@]}"; do
  if [[ -e $sdk_path ]]; then
    [[ -d $sdk_path && ! -L $sdk_path ]] || exit 1
    sudo du -sb -- "$sdk_path"
    sudo rm -rf -- "$sdk_path"
  fi
done
df -B1 /

# BuildKit and the loaded runtime coexist while the exact image is exercised.
# The failed1353 run exhausted the runner during that import, before testing.
minimum_free_bytes=$((25 * 1024 * 1024 * 1024))
available_bytes=$(df -B1 --output=avail / | tail -n 1 | tr -d ' ')
(( available_bytes >= minimum_free_bytes )) || {
  echo "Insufficient container build headroom: ${available_bytes} bytes; need ${minimum_free_bytes}." >&2
  exit 1
}
