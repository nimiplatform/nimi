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
func NewSQLiteBackend(rootDir string) (*SQLiteBackend, error) {
	if rootDir == "" {
		return nil, errors.New("storage: root directory is required")
	}
	if err := os.MkdirAll(rootDir, dirPerm); err != nil {
		return nil, fmt.Errorf("storage: create root: %w", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(rootDir, sqliteFileName))
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
	stmts := []string{
		`PRAGMA foreign_keys = ON;`,
		`PRAGMA journal_mode = WAL;`,
		`CREATE TABLE IF NOT EXISTS scope (
			scope_id TEXT PRIMARY KEY,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
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
			commit_id TEXT PRIMARY KEY,
			kernel_type TEXT,
			created_at TEXT NOT NULL,
			commit_json BLOB NOT NULL
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
			run_id TEXT PRIMARY KEY,
			report_json BLOB NOT NULL,
			created_at TEXT NOT NULL
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
			PRIMARY KEY (run_id, family, artifact_kind, artifact_id, action)
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
	}
	for _, stmt := range stmts {
		if _, err := b.db.Exec(stmt); err != nil {
			return fmt.Errorf("storage: init schema: %w", err)
		}
	}
	if err := b.migrateMemoryRecordSchema(); err != nil {
		return err
	}
	if err := b.migrateKnowledgeAuxState(); err != nil {
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
