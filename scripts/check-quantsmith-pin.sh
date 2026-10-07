#!/usr/bin/env bash
# QuantSmith pin checks (spec005 record, spec009 content pin).
#
# 1. BLOCKING (exit 1): docs/specs/spec005/QUANTSMITH_PIN.md and
#    contracts/agent/quantsmith-pin.json must agree on the package version and both digests.
#    Needs no QuantSmith copy, so it runs in hosted CI.
# 2. ADVISORY (never fails): when a local QuantSmith copy is found, its fingerprints are computed
#    with services/agent_worker/src/agent_worker/pin.py and drift from the pin is reported. The
#    copy is looked up at $QUANTSMITH_ROOT (also read from .env), then the old default path, then
#    ../QuantSmith. No network call is ever made; with no copy present this part is skipped.
#
# QuantSmith's own hooks/stages/quantsmith-version-check.sh gate cannot run here: it looks for a
# `quantsmith==X.Y.Z` pin in requirements.txt/pyproject.toml and an importable package, neither of
# which exists in this Node/Vite repo (spec 0047, RISK-004).

set -uo pipefail

PIN_FILE="docs/specs/spec005/QUANTSMITH_PIN.md"
PIN_JSON="contracts/agent/quantsmith-pin.json"
PIN_TOOL="services/agent_worker/src/agent_worker/pin.py"
OLD_DEFAULT_DIR="../agentic_workflows/qf_workflow_sdk_public"

if [[ ! -f "$PIN_FILE" ]]; then
  echo "QuantSmith pin check: $PIN_FILE not found, skipped."
  exit 0
fi

# --- 1. record <-> JSON agreement (blocking) ---------------------------------------------------

record_field() { # value of a `| <label> | ... |` row, first backtick-quoted token
  grep -m1 -E "^\| $1 \|" "$PIN_FILE" | sed -E 's/^[^`]*`([^`]*)`.*/\1/'
}

if [[ ! -f "$PIN_JSON" ]]; then
  echo "QuantSmith pin check FAILED — $PIN_JSON is missing."
  exit 1
fi

json_field() {
  python3 -c '
import json, sys
pin = json.load(open(sys.argv[1]))
path = sys.argv[2].split(".")
for key in path:
    pin = pin[key]
print(pin)' "$PIN_JSON" "$1"
}

status=0
check_pair() { # label, record value, json value
  if [[ -z "$2" ]]; then
    echo "  MISMATCH $1: not found in $PIN_FILE"
    status=1
  elif [[ "$2" != "$3" ]]; then
    echo "  MISMATCH $1: record=$2 json=$3"
    status=1
  fi
}

check_pair "package version" "$(record_field 'Package version')" "$(json_field package.version)"
check_pair "code digest" "$(record_field 'Code digest')" "$(json_field package.code_digest)"
check_pair "assets digest" "$(record_field 'Assets digest')" "$(json_field assets.digest)"
check_pair "reviewed commit" "$(record_field 'Reviewed commit \(informational\)')" "$(json_field reviewed.source_commit)"

if [[ $status -ne 0 ]]; then
  echo "QuantSmith pin check FAILED — $PIN_FILE and $PIN_JSON disagree. Update them together."
  exit 1
fi
echo "QuantSmith pin record PASSED — $PIN_FILE and $PIN_JSON agree."

# --- 2. local copy drift (advisory) ------------------------------------------------------------

root="${QUANTSMITH_ROOT:-}"
if [[ -z "$root" && -f .env ]]; then
  root=$(grep -E '^QUANTSMITH_ROOT=' .env | tail -1 | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g')
fi

copy=""
for candidate in "$root" "$OLD_DEFAULT_DIR" "../QuantSmith"; do
  if [[ -n "$candidate" && -d "$candidate/src/quantsmith" ]]; then
    copy="$candidate"
    break
  fi
done

if [[ -z "$copy" ]]; then
  echo "QuantSmith copy drift: no local copy found (QUANTSMITH_ROOT, $OLD_DEFAULT_DIR, ../QuantSmith), skipped."
  exit 0
fi

echo "QuantSmith copy drift: checking $copy"
if ! command -v python3 >/dev/null 2>&1; then
  echo "  python3 not found, skipped."
  exit 0
fi

if report=$(python3 -I "$PIN_TOOL" --root "$copy" 2>&1); then
  mismatches=$(printf '%s' "$report" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["mismatches"]))')
  if [[ -z "$mismatches" ]]; then
    echo "  PASSED — code and assets digests match the pin."
  else
    echo "  DRIFT — fingerprints differ from the pin ($mismatches)."
    echo "  The worker will not claim jobs on this copy until it is reviewed and re-pinned"
    echo "  (see docs/specs/spec005/QUANTSMITH_PIN.md)."
  fi
else
  echo "  could not fingerprint the copy: $report"
fi

# Informational only: where the copy's git HEAD stands against the recorded commits.
if [[ -d "$copy/.git" ]]; then
  head=$(git -C "$copy" rev-parse HEAD 2>/dev/null || true)
  reviewed=$(json_field reviewed.source_commit)
  if [[ -n "$head" ]]; then
    if [[ "$head" == "$reviewed" ]]; then
      echo "  git HEAD is the spec009 reviewed commit ($head)."
    else
      echo "  git HEAD $head differs from the spec009 reviewed commit $reviewed (information only)."
    fi
  fi
fi

exit 0
