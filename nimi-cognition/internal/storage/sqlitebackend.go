package storage

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

const sqliteFileName = "cognition.sqlite"
const dirPerm = 0o700

// SupportSummary aggregates incoming support for a referenced artifact.
type SupportSummary struct {
	Strong int
	Weak   int
	Score  float64
}

// DigestCandidate stores a persisted digest decision or block.
type DigestCandidate struct {
	RunID        string
	Family       string
	ArtifactKind string
	ArtifactID   string
	Action       string
	Status       string
	Reason       string
	Detail       json.RawMessage
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// SQLiteBackend is the single admitted durable repository backend for
// standalone cognition. It persists normalized rows plus raw JSON payloads used
// for faithful artifact round-tripping.
type SQLiteBackend struct {
	rootDir string
	db      *sql.DB
}

// NewSQLiteBackend opens or creates the default SQLite-backed repository.
//
// The DSN sets per-connection pragmas (foreign_keys, journal_mode WAL,
// busy_timeout) via the modernc.org/sqlite `_pragma` query parameter so
// every pooled connection gets the same posture. Per-connection pragmas
// set inside init() would only land on the first checked-out connection
// and miss subsequent ones used by concurrent writers — which surfaces
// as SQLITE_BUSY under contention.
func NewSQLiteBackend(rootDir string) (*SQLiteBackend, error) {
	if rootDir == "" {
		return nil, errors.New("storage: root directory is required")
	}
	if err := os.MkdirAll(rootDir, dirPerm); err != nil {
		return nil, fmt.Errorf("storage: create root: %w", err)
	}
	dsn := "file:" + filepath.Join(rootDir, sqliteFileName) +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("storage: open sqlite: %w", err)
	}
	backend := &SQLiteBackend{rootDir: rootDir, db: db}
	if err := backend.init(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return backend, nil
}

func (b *SQLiteBackend) init() error {
	var runtimeSourceTableCount int
	if err := b.db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('runtime_source_scope','runtime_source_unit','runtime_source_omission')`).Scan(&runtimeSourceTableCount); err != nil {
		return fmt.Errorf("storage: inspect runtime source schema: %w", err)
	}
	if runtimeSourceTableCount != 0 {
		if err := b.validateRuntimeSourceSchema(); err != nil {
			return err
		}
	}
	stmts := []string{
		`PRAGMA foreign_keys = ON;`,
		`PRAGMA journal_mode = WAL;`,
		`PRAGMA busy_timeout = 5000;`,
		`CREATE TABLE IF NOT EXISTS scope (
			scope_id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS runtime_source_scope (
			scope_id TEXT PRIMARY KEY,
			snapshot_identity TEXT NOT NULL,
			partition_identity TEXT NOT NULL,
			status TEXT NOT NULL,
			generation INTEGER NOT NULL,
			embedding_identity TEXT NOT NULL,
			embedding_dimension INTEGER NOT NULL,
			updated_at TEXT NOT NULL,
			CHECK(status IN ('unconfigured','building','ready','unavailable','failure'))
		);`,
		`CREATE TABLE IF NOT EXISTS runtime_source_unit (
			scope_id TEXT NOT NULL,
			unit_id TEXT NOT NULL,
			category TEXT NOT NULL,
			source_path TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_world_id TEXT NOT NULL,
			source_ref_id TEXT NOT NULL,
			source_schema_version TEXT NOT NULL,
			source_content_hash TEXT NOT NULL,
			text TEXT NOT NULL,
			provenance_refs_json BLOB NOT NULL,
			priority INTEGER NOT NULL,
			embedding_json BLOB,
			PRIMARY KEY(scope_id, unit_id),
			FOREIGN KEY(scope_id) REFERENCES runtime_source_scope(scope_id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS runtime_source_omission (
			scope_id TEXT NOT NULL,
			unit_id TEXT NOT NULL,
			category TEXT NOT NULL,
			source_path TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_world_id TEXT NOT NULL,
			source_ref_id TEXT NOT NULL,
			source_schema_version TEXT NOT NULL,
			source_content_hash TEXT NOT NULL,
			omission_reason TEXT NOT NULL,
			provenance_refs_json BLOB NOT NULL,
			PRIMARY KEY(scope_id, unit_id),
			FOREIGN KEY(scope_id) REFERENCES runtime_source_scope(scope_id) ON DELETE CASCADE
		);`,
		`CREATE TABLE IF NOT EXISTS kernel (
			scope_id TEXT NOT NULL,
			kernel_type TEXT NOT NULL,
			kernel_id TEXT NOT NULL,
			version INTEGER NOT NULL,
			status TEXT NOT NULL,
			kernel_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, kernel_type)
		);`,
		`CREATE TABLE IF NOT EXISTS kernel_rule (
			scope_id TEXT NOT NULL,
			kernel_type TEXT NOT NULL,
			rule_id TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			statement TEXT NOT NULL,
			search_text TEXT NOT NULL,
			rule_json BLOB NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, kernel_type, rule_id)
		);`,
		`CREATE TABLE IF NOT EXISTS kernel_commit (
			scope_id TEXT NOT NULL,
			commit_id TEXT NOT NULL,
			kernel_type TEXT,
			created_at TEXT NOT NULL,
			commit_json BLOB NOT NULL,
			PRIMARY KEY (scope_id, commit_id)
		);`,
		`CREATE TABLE IF NOT EXISTS memory_record (
			scope_id TEXT NOT NULL,
			record_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			search_text TEXT NOT NULL,
			record_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, record_id)
		);`,
		`CREATE TABLE IF NOT EXISTS memory_history (
			scope_id TEXT NOT NULL,
			record_id TEXT NOT NULL,
			action TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			version INTEGER NOT NULL,
			at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS knowledge_page (
			scope_id TEXT NOT NULL,
			page_id TEXT NOT NULL,
			kind TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			search_text TEXT NOT NULL,
			page_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, page_id)
		);`,
		`CREATE TABLE IF NOT EXISTS knowledge_relation (
			scope_id TEXT NOT NULL,
			from_page_id TEXT NOT NULL,
			to_page_id TEXT NOT NULL,
			relation_type TEXT NOT NULL,
			strength TEXT NOT NULL,
			relation_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, from_page_id, to_page_id, relation_type)
		);`,
		`CREATE TABLE IF NOT EXISTS knowledge_page_embedding (
			scope_id TEXT NOT NULL,
			page_id TEXT NOT NULL,
			embedding_json BLOB NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, page_id)
		);`,
		`CREATE TABLE IF NOT EXISTS knowledge_history (
			scope_id TEXT NOT NULL,
			page_id TEXT NOT NULL,
			action TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			version INTEGER NOT NULL,
			at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS knowledge_ingest_task (
			scope_id TEXT NOT NULL,
			task_id TEXT NOT NULL,
			task_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, task_id)
		);`,
		`CREATE TABLE IF NOT EXISTS skill_bundle (
			scope_id TEXT NOT NULL,
			bundle_id TEXT NOT NULL,
			status TEXT NOT NULL,
			search_text TEXT NOT NULL,
			bundle_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, bundle_id)
		);`,
		`CREATE TABLE IF NOT EXISTS skill_history (
			scope_id TEXT NOT NULL,
			bundle_id TEXT NOT NULL,
			action TEXT NOT NULL,
			status TEXT NOT NULL,
			version INTEGER NOT NULL,
			at TEXT NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS artifact_ref (
			scope_id TEXT NOT NULL,
			from_kind TEXT NOT NULL,
			from_id TEXT NOT NULL,
			to_kind TEXT NOT NULL,
			to_id TEXT NOT NULL,
			strength TEXT NOT NULL,
			role TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, from_kind, from_id, to_kind, to_id, role)
		);`,
		`CREATE TABLE IF NOT EXISTS digest_run (
			scope_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			report_json BLOB NOT NULL,
			created_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, run_id)
		);`,
		`CREATE TABLE IF NOT EXISTS digest_candidate (
			scope_id TEXT NOT NULL,
			run_id TEXT NOT NULL,
			family TEXT NOT NULL,
			artifact_kind TEXT NOT NULL,
			artifact_id TEXT NOT NULL,
			action TEXT NOT NULL,
			status TEXT NOT NULL,
			reason TEXT NOT NULL,
			detail_json BLOB,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (scope_id, run_id, family, artifact_kind, artifact_id, action, status)
		);`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS memory_record_fts USING fts5(
			scope_id UNINDEXED,
			record_id UNINDEXED,
			search_text
		);`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_page_fts USING fts5(
			scope_id UNINDEXED,
			page_id UNINDEXED,
			search_text
		);`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS skill_bundle_fts USING fts5(
			scope_id UNINDEXED,
			bundle_id UNINDEXED,
			search_text
		);`,
		`CREATE TABLE IF NOT EXISTS cognition_scope_registry (
			scope_id TEXT PRIMARY KEY,
			scope_kind TEXT NOT NULL CHECK (scope_kind = 'runtime_knowledge_bank'),
			owner_kind TEXT NOT NULL CHECK (owner_kind IN ('app_private', 'workspace_private')),
			owner_key TEXT NOT NULL,
			owner_json TEXT NOT NULL,
			display_name TEXT NOT NULL,
			metadata_json TEXT NOT NULL DEFAULT '{}',
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS cognition_scope_registry_owner_idx
			ON cognition_scope_registry(scope_kind, owner_kind, owner_key);`,
		`CREATE UNIQUE INDEX IF NOT EXISTS cognition_scope_registry_owner_unique
			ON cognition_scope_registry(scope_kind, owner_kind, owner_key, display_name);`,
	}
	for _, stmt := range stmts {
		if _, err := b.db.Exec(stmt); err != nil {
			return fmt.Errorf("storage: init schema: %w", err)
		}
	}
	if err := b.migrateMemoryRecordSchema(); err != nil {
		return err
	}
	if err := b.validateRuntimeSourceSchema(); err != nil {
		return err
	}
	if err := b.migrateKnowledgeAuxState(); err != nil {
		return err
	}
	if err := b.migrateKernelCommitScopeSchema(); err != nil {
		return err
	}
	if err := b.migrateDigestRunScopeSchema(); err != nil {
		return err
	}
	if err := b.migrateDigestCandidateSchema(); err != nil {
		return err
	}
	if err := b.rebuildSkillBundleFTS(); err != nil {
		return err
	}
	return nil
}
