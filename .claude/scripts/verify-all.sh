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
  "verify-palette"
  "verify-nav-state"
  "verify-readouts"
  "verify-icons"
  "verify-surfaces"
  "verify-states"
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
  "verify-library-density"
  "verify-photo-knockout"
  "verify-chain-direction"
  "knockout-regression"
  # Added after a hydration mismatch was reported that could not be reproduced
  # here. It gates the property both ways: if the APP causes one, this fails;
  # if it keeps passing while a browser still reports one, that is evidence the
  # cause is in that browser.
  "verify-hydration"
)

# These WRITE. Each restores what it touched, but they are opt-in so a routine
# check cannot damage a board.
#
# optimize-and-save.js is deliberately absent from BOTH lists: it overwrites a
# hand-arranged layout, which is the owner's decision and not a gate's.
# Found OUTSIDE both lists by the 2026-08-20 audit, and added:
#
#   verify-photo-knockout    passes, 1s, self-contained (synthetic JPEG)
#   verify-chain-direction   passes, 10s - was `extract-positions.js`, a gate
#                            wearing a dump's name, which is how it was missed
#   knockout-regression      passes, 33s, writes nothing. Keeps its name: it is
#                            referenced by name from verify-knockout-on-board
#                            and the docs, and the name is older than the rule
#   verify-modulation-switch WAS BROKEN - its selector was
#                            `span:text-is("Modulation")` and the Routing panel
#                            had been rebuilt around it. Nothing reported that,
#                            because nothing ran it.
WRITERS=(
  "verify-round-trip"
  "verify-loop-persist"
  "verify-save-reorder"
  "verify-crud"
  "verify-routes"
  "verify-sharing"
  # Works on a CLONE of a configuration and deletes it in a finally, so it
  # never touches a real board.
  "verify-modulation-switch"
  # Creates a Classic Pro of its own, places the six knockout subjects on it
  # and deletes it in a finally. It USED to run against whatever board came
  # first - a real one - which is both why it wrote without being in this list
  # and why it failed: by 2026-08 that board was full and the placements were
  # refused. It was outside the suite for long enough to rot unnoticed, which
  # is the exact failure this runner was written to stop.
  "verify-knockout-on-board"
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
    # Show the lines that FAILED, then the tail.
    #
    # `tail -4` on its own was actively misleading: a gate that prints forty
    # checks ends with its own summary, so the four lines shown WERE the
    # summary, and the line naming which check failed had already scrolled
    # past. Both failing gates on 2026-08-19 had to be re-run standalone to
    # find out why - which is the entire job this runner exists to do.
    # -A1, because in this project's gate format the EVIDENCE is on the line
    # under the FAIL, indented. Without it the runner printed "FAIL  /pedals/[id]
    # shows its own skeleton mid-load" and swallowed the part saying what was on
    # screen instead - which is the whole difference between "it is missing" and
    # "the page had already finished".
    #
    # The tail is kept for gates that die WITHOUT printing a FAIL line - a
    # stack trace has no such line - and de-duplicated against the grep, since
    # a gate's summary is usually in both.
    { echo "$out" | grep -A1 -E 'FAIL|Error|error:' | head -12
      echo "$out" | tail -3
    } | awk 'NF && !seen[$0]++' | sed 's/^/      /'
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
