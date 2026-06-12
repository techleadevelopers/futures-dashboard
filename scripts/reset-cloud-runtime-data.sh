#!/usr/bin/env bash
set -euo pipefail

EXECUTE=0
if [[ "${1:-}" == "--execute" ]]; then
  EXECUTE=1
fi

RUNTIME_DIR="${RUNTIME_DATA_DIR:-/data}"
DEMO_DIR="${DEMO_TRADE_DATA_DIR:-${RUNTIME_DIR}/demo-trades}"
TELEMETRY_DIR_VALUE="${TELEMETRY_DIR:-${RUNTIME_DIR}/telemetry}"
QB_OUTBOX="${QUANT_BRAIN_OUTBOX_PATH:-${RUNTIME_DIR}/outbox/quant-brain-outbox.json}"
SHADOW_STATE="${SHADOW_SAMPLER_STATE_PATH:-${RUNTIME_DIR}/shadow_sampler_state.json}"
OFFLINE_CHECKPOINT="${OFFLINE_LEARNER_CHECKPOINT_PATH:-${RUNTIME_DIR}/offline_learner_checkpoint.json}"
TRIGGER_OUTCOMES="${TRIGGER_OUTCOMES_PATH:-${TELEMETRY_DIR_VALUE}/trigger_outcomes.jsonl}"

empty_files=(
  "${RUNTIME_DIR}/telemetry.jsonl"
  "${TELEMETRY_DIR_VALUE}/trigger_outcomes.jsonl"
  "${TRIGGER_OUTCOMES}"
  "${DEMO_DIR}/demo-open.jsonl"
  "${DEMO_DIR}/demo-closed.jsonl"
  "${RUNTIME_DIR}/market_event_claims.jsonl"
  "${RUNTIME_DIR}/live_watcher_journal.jsonl"
  "${RUNTIME_DIR}/live_watcher_deadletter.jsonl"
  "${QB_OUTBOX}"
  "${SHADOW_STATE}"
  "${OFFLINE_CHECKPOINT}"
)

remove_paths=(
  "${RUNTIME_DIR}/outcomes.db"
  "${RUNTIME_DIR}/trade-outcomes.sqlite"
  "${RUNTIME_DIR}/knowledge.db"
  "${RUNTIME_DIR}/knowledge.db-journal"
  "${RUNTIME_DIR}/quant_brain.db"
  "${RUNTIME_DIR}/models"
)

echo "Reset cloud runtime data"
echo "RUNTIME_DIR=${RUNTIME_DIR}"
echo "EXECUTE=${EXECUTE}"
echo

for path in "${empty_files[@]}"; do
  if [[ -e "$path" ]]; then
    echo "EMPTY  $path"
    if [[ "$EXECUTE" == "1" ]]; then
      mkdir -p "$(dirname "$path")"
      : > "$path"
    fi
  fi
done

for path in "${remove_paths[@]}"; do
  if [[ -e "$path" ]]; then
    echo "REMOVE $path"
    if [[ "$EXECUTE" == "1" ]]; then
      rm -rf -- "$path"
    fi
  fi
done

if [[ "$EXECUTE" != "1" ]]; then
  echo
  echo "Dry-run concluido. Para aplicar:"
  echo "  bash scripts/reset-cloud-runtime-data.sh --execute"
fi
