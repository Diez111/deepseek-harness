#!/usr/bin/env bash
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
out=/tmp/jspace-ab-report.txt
: > "$out"
for eff in high max; do
  node "$DIR/set-effort.mjs" "$eff" || exit 3
  echo "== ARM $eff ==" >> "$out"
  (cd "$DIR" && node run-arm.mjs "$eff") >> "$out" 2>&1 || echo "arm $eff errored (rc=$?)" >> "$out"
done
node "$DIR/set-effort.mjs" high || true
echo DONE
