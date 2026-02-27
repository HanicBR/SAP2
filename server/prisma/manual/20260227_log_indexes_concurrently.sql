-- PR-I1: Log query indexes (PostgreSQL)
-- IMPORTANT:
-- 1) Execute this file with psql in autocommit mode.
-- 2) Do NOT wrap in BEGIN/COMMIT.
-- 3) Do NOT use psql --single-transaction (-1).
--
-- Example deploy command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f server/prisma/manual/20260227_log_indexes_concurrently.sql
--
-- Verification command:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -c "
--   SELECT indexname, indexdef
--   FROM pg_indexes
--   WHERE schemaname = 'public'
--     AND tablename = 'Log'
--     AND indexname IN (
--       'idx_log_server_ts_id',
--       'idx_log_gamemode_type_ts_id',
--       'idx_log_steam_ts_id'
--     )
--   ORDER BY indexname;"

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_log_server_ts_id
  ON "Log" ("serverId", "timestamp" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_log_gamemode_type_ts_id
  ON "Log" ("gameMode", "type", "timestamp" DESC, "id" DESC);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_log_steam_ts_id
  ON "Log" ("steamId", "timestamp" DESC, "id" DESC);
