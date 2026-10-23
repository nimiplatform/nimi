package runtimepersistence

// AIObservationStorageSchema belongs to the Runtime AI observation owner. Its
// bounded records contain accounting and safe display facts, never AI content.
func AIObservationStorageSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS runtime_ai_usage_attempt (
			attempt_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, source TEXT NOT NULL,
			operation_id TEXT NOT NULL, started_ns INTEGER NOT NULL, terminal_ns INTEGER NOT NULL,
			revision INTEGER NOT NULL, bucket_ns INTEGER NOT NULL, group_key TEXT NOT NULL,
			retain_until_ns INTEGER NOT NULL, record_bytes INTEGER NOT NULL, record BLOB NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_ai_usage_attempt_interval ON runtime_ai_usage_attempt(account_id, started_ns)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_ai_usage_attempt_operation ON runtime_ai_usage_attempt(operation_id, terminal_ns)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_ai_usage_attempt_bucket ON runtime_ai_usage_attempt(account_id, bucket_ns, group_key)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_usage_minute (
			account_id TEXT NOT NULL, bucket_ns INTEGER NOT NULL, group_key TEXT NOT NULL,
			retain_until_ns INTEGER NOT NULL, record_bytes INTEGER NOT NULL, record BLOB NOT NULL,
			PRIMARY KEY(account_id, bucket_ns, group_key)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_ai_usage_minute_retention ON runtime_ai_usage_minute(retain_until_ns,bucket_ns)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_accounting_generation (
			generation_id TEXT PRIMARY KEY, started_ns INTEGER NOT NULL,
			ended_ns INTEGER NOT NULL DEFAULT 0, clean INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_accounting_gap (
			id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT NOT NULL,
			from_ns INTEGER NOT NULL, to_ns INTEGER NOT NULL, reason TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_accounting_boundary (
			source TEXT PRIMARY KEY, accept_from_ns INTEGER NOT NULL,
			coverage_from_ns INTEGER NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_accounting_size (
			singleton INTEGER PRIMARY KEY CHECK(singleton = 1), attempt_rows INTEGER NOT NULL,
			aggregate_rows INTEGER NOT NULL, payload_bytes INTEGER NOT NULL
		)`,
		`INSERT OR IGNORE INTO runtime_ai_accounting_size VALUES (1, 0, 0, 0)`,
	}
}
