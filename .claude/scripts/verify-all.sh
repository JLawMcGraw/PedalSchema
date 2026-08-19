#!/usr/bin/env bash
#
# Run the verification gates and report which ones fail.
#
# Written because nobody was running them. `verify-jack-render.js` had been
# broken since a83702a optimized the `test` board - packing 22 pedals put one
# under the fixed coordinate it clicked to place a pedal - and it was found by
# accident, weeks later, while auditing something else. A suite of gates that
# nobody runs is not a suite of gates.
#
# Exit codes are the contract: every script here exits non-zero on failure, so
# this can be trusted in a loop. (When checking one by hand, do NOT pipe it
# into `tail` and then read $? - that reports tail's status, not the script's.
# That mistake produced a clean-looking table of eleven passing gates while one
# of them was failing.)
#
# Usage:
#   .claude/scripts/verify-all.sh           read-only gates (safe, the default)
#   .claude/scripts/verify-all.sh --all     also the gates that write and restore
#
# Needs the dev server up on :3000 for the browser gates.

set -u
cd "$(dirname "$0")/../.." || exit 1

RUN_WRITERS=0
[ "${1:-}" = "--all" ] && RUN_WRITERS=1

# Gates that only read. Safe to run against anything.
READ_ONLY=(
  "verify-pedal-jacks"
  "verify-pedal-dimensions"
  "verify-pedal-images"
  "verify-gear-images"
  "verify-twin-parity"
  "verify-placement"
  "verify-panel-tabs"
  "verify-power-panel"
  "verify-power-supply"
  "verify-optimize"
  "verify-cable-legend"
  "verify-jack-render"
  "verify-delete-key"
  "verify-drag-undo"
  "verify-viewport"
)

# These WRITE. Each restores what it touched, but they are opt-in so a routine
# check cannot damage a board.
#
# optimize-and-save.js is deliberately absent from BOTH lists: it overwrites a
# hand-arranged layout, which is the owner's decision and not a gate's.
WRITERS=(
  "verify-round-trip"
  "verify-loop-persist"
  "verify-save-reorder"
  "verify-crud"
  "verify-routes"
)

pass=0; failed=0; failures=()

# A per-gate time limit, portably.
#
# `timeout` is GNU coreutils. It is NOT on a stock macOS, which is where this
# runs - and the consequence was not a missing time limit, it was that EVERY
# gate exited 127 and the runner printed "0 passed, 16 failed" while the gates
# themselves were fine. A runner that cannot tell you a gate passed is worse
# than no runner: this one reported a clean sweep of failures for weeks.
#
# perl ships with macOS and its alarm+exec does the same job in one process.
# Every branch takes the seconds as its FIRST argument, supplied at the call site.
if command -v timeout >/dev/null 2>&1; then
  LIMIT=(timeout)
elif command -v gtimeout >/dev/null 2>&1; then
  LIMIT=(gtimeout)
else
  LIMIT=(perl -e 'alarm shift @ARGV; exec @ARGV')
fi

run_one() {
  local name="$1"; shift
  printf '%-26s ' "$name"
  local out
  out=$("${LIMIT[@]}" 300 node ".claude/scripts/${name}.js" "$@" 2>&1)
  local code=$?
  if [ $code -eq 0 ]; then
    printf 'PASS\n'
    pass=$((pass + 1))
  else
    printf 'FAIL (exit %s)\n' "$code"
    echo "$out" | tail -4 | sed 's/^/      /'
    failed=$((failed + 1))
    failures+=("$name")
  fi
}

echo "=== read-only gates ==="
for s in "${READ_ONLY[@]}"; do run_one "$s"; done

# verify-round-trip has a read-only mode, so its READ half runs even without
# --all. The write half is the part that needs opting in.
echo
echo "=== round trip (read half) ==="
run_one "verify-round-trip" --read-only

if [ $RUN_WRITERS -eq 1 ]; then
  echo
  echo "=== gates that write (they restore afterwards) ==="
  for s in "${WRITERS[@]}"; do run_one "$s"; done
else
  echo
  echo "(skipping ${#WRITERS[@]} write gates - pass --all to include them)"
fi

echo
echo "-----------------------------------------"
printf '%s passed, %s failed\n' "$pass" "$failed"
if [ $failed -gt 0 ]; then
  printf 'failing: %s\n' "${failures[*]}"
  exit 1
fi
exit 0
