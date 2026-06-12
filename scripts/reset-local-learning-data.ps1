param(
  [switch]$Execute
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

$pathsToEmpty = @(
  "backend/telemetry.jsonl",
  "backend/data/demo-open.jsonl",
  "backend/data/demo-closed.jsonl",
  "backend/data/quant-brain-outbox.json",
  "backend/data/market-event-claims.json",
  "backend/data/market_event_claims.jsonl",
  "backend/data/live-watcher-journal.json",
  "backend/data/live-watcher-journal.jsonl",
  "backend/data/live-watcher-deadletter.jsonl",
  "quant-brain/data/shadow-sampler-state.json",
  "quant-brain/data/offline_learner_checkpoint.json",
  "quant-brain/data/trigger_outcomes.jsonl"
)

$pathsToRemove = @(
  "backend/data/outcomes.db",
  "backend/data/trade-outcomes.sqlite",
  "quant-brain/data/knowledge.db",
  "quant-brain/data/knowledge.db-journal",
  "quant-brain/data/quant_brain.db",
  "quant-brain/data/models"
)

function Resolve-RepoPath($relativePath) {
  return Join-Path $root $relativePath
}

Write-Host "Reset local de dados de treino/métricas"
Write-Host "Execute=false: apenas mostra o que faria."
Write-Host ""

foreach ($relative in $pathsToEmpty) {
  $path = Resolve-RepoPath $relative
  if (Test-Path -LiteralPath $path) {
    Write-Host "EMPTY  $relative"
    if ($Execute) {
      $parent = Split-Path -Parent $path
      if (!(Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent | Out-Null
      }
      Set-Content -LiteralPath $path -Value "" -NoNewline
    }
  }
}

foreach ($relative in $pathsToRemove) {
  $path = Resolve-RepoPath $relative
  if (Test-Path -LiteralPath $path) {
    Write-Host "REMOVE $relative"
    if ($Execute) {
      Remove-Item -LiteralPath $path -Recurse -Force
    }
  }
}

if (!$Execute) {
  Write-Host ""
  Write-Host "Dry-run concluído. Para aplicar:"
  Write-Host "  powershell -ExecutionPolicy Bypass -File scripts/reset-local-learning-data.ps1 -Execute"
}
