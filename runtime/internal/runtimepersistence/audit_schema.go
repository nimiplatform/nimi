package runtimepersistence

// AuditStorageSchema is the Runtime audit plane table set. Only the audit
// owner (internal/auditlog) writes these rows: it redacts and size-caps each
// record and applies the count and byte retention bounds in the same
// transaction as every insert, evicting the oldest records first.
func AuditStorageSchema() []string {
	return []string{
		`CREATE TABLE IF NOT EXISTS runtime_audit_event (
			sequence INTEGER PRIMARY KEY AUTOINCREMENT,
			audit_id TEXT NOT NULL,
			timestamp_seconds INTEGER NOT NULL,
			timestamp_nanos INTEGER NOT NULL CHECK (timestamp_nanos >= 0 AND timestamp_nanos < 1000000000),
			app_id TEXT NOT NULL,
			subject_user_id TEXT NOT NULL,
			domain TEXT NOT NULL,
			operation TEXT NOT NULL,
			reason_code INTEGER NOT NULL,
			caller_kind INTEGER NOT NULL,
			caller_id TEXT NOT NULL,
			trace_id TEXT NOT NULL,
			request_id TEXT NOT NULL,
			record_bytes INTEGER NOT NULL CHECK (record_bytes > 0),
			record BLOB NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_audit_event_time ON runtime_audit_event(timestamp_seconds, timestamp_nanos)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_audit_event_domain_time ON runtime_audit_event(domain, timestamp_seconds, timestamp_nanos)`,
		`CREATE TABLE IF NOT EXISTS runtime_audit_retention (
			singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
			retained_bytes INTEGER NOT NULL CHECK (retained_bytes >= 0)
		)`,
		`INSERT OR IGNORE INTO runtime_audit_retention(singleton, retained_bytes) VALUES (1, 0)`,
	}
}
