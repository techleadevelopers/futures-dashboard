-- Zera dados de treino, métricas e modelos do Quant Brain.
-- Não altera código, schemas, usuários, permissões ou variáveis de ambiente.
--
-- Uso típico no Postgres:
--   psql "$DATABASE_URL" -f scripts/reset-quant-brain-learning.sql
--
-- Se o Quant Brain usa outro schema, ajuste a linha abaixo antes de rodar.
SET search_path TO quant_brain, public;

TRUNCATE TABLE
  patterns,
  trade_outcomes,
  observations,
  strategic_insights,
  feature_snapshots,
  signal_outcomes,
  training_serving_feature_audits,
  signal_lifecycle_events,
  news_events,
  hourly_metrics,
  daily_symbol_metrics,
  symbol_correlations,
  regime_performance,
  hour_toxicity,
  rolling_edge,
  sniper_performance_windows,
  execution_quality,
  model_artifacts,
  exit_outcomes,
  exit_evaluations
RESTART IDENTITY CASCADE;
