package storage

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

const runtimeSourceSQLiteFileName = "cognition-agent-source-v1.sqlite3"

// NewRuntimeSourceBackend opens the bounded Agent Source repository used by
// the V1 owner composition. It intentionally creates no kernel, Knowledge,
// graph, digest, skill, working-state, prompt, or legacy Memory schema.
func NewRuntimeSourceBackend(rootDir string) (*SQLiteBackend, error) {
	if rootDir == "" {
		return nil, errors.New("storage: root directory is required")
	}
	if err := os.MkdirAll(rootDir, dirPerm); err != nil {
		return nil, fmt.Errorf("storage: create root: %w", err)
	}
	storePath := filepath.Join(rootDir, runtimeSourceSQLiteFileName)
	_, statErr := os.Stat(storePath)
	existing := statErr == nil
	if statErr != nil && !errors.Is(statErr, os.ErrNotExist) {
		return nil, fmt.Errorf("storage: inspect runtime source store: %w", statErr)
	}
	dsn := "file:" + storePath +
		"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=foreign_keys(on)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("storage: open runtime source sqlite: %w", err)
	}
	backend := &SQLiteBackend{db: db}
	if existing {
		if err := backend.validateRuntimeSourceSchema(); err != nil {
			_ = db.Close()
			return nil, err
		}
	}
	if err := backend.initRuntimeSource(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return backend, nil
}

func (b *SQLiteBackend) initRuntimeSource() error {
	statements := []string{
		`PRAGMA foreign_keys = ON;`,
		`PRAGMA journal_mode = WAL;`,
		`PRAGMA busy_timeout = 5000;`,
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
	}
	for _, statement := range statements {
		if _, err := b.db.Exec(statement); err != nil {
			return fmt.Errorf("storage: init runtime source schema: %w", err)
		}
	}
	return b.validateRuntimeSourceSchema()
}
