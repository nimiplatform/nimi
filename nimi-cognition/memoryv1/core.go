package memoryv1

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

const storeFilename = "cognition-memory-v1.sqlite3"

type Core struct {
	db     *sql.DB
	now    func() time.Time
	newRef func(string) (string, error)
}

type Option func(*Core)

func WithClock(now func() time.Time) Option {
	return func(core *Core) {
		if now != nil {
			core.now = now
		}
	}
}

// @nimi-authority: rule.nimi.cognition.memory.r001
// @nimi-authority: rule.nimi.cognition.memory.r014
func Open(rootDir string, opts ...Option) (*Core, error) {
	if strings.TrimSpace(rootDir) == "" {
		return nil, errors.New("memory core: root directory is required")
	}
	if err := os.MkdirAll(rootDir, 0o700); err != nil {
		return nil, fmt.Errorf("memory core: create root: %w", err)
	}
	db, err := sql.Open("sqlite", filepath.Join(rootDir, storeFilename))
	if err != nil {
		return nil, fmt.Errorf("memory core: open store: %w", err)
	}
	db.SetMaxOpenConns(1)
	core := &Core{db: db, now: time.Now, newRef: randomOpaqueRef}
	for _, opt := range opts {
		opt(core)
	}
	if err := core.initialize(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return core, nil
}

func (c *Core) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	return c.db.Close()
}

func (c *Core) initialize() error {
	if _, err := c.db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("memory core: enable foreign keys: %w", err)
	}
	if _, err := c.db.Exec(`PRAGMA journal_mode = WAL`); err != nil {
		return fmt.Errorf("memory core: enable wal: %w", err)
	}
	var version int
	if err := c.db.QueryRow(`PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("memory core: inspect schema version: %w", err)
	}
	if version != 0 && version != 1 {
		return contractError(OutcomeUnsupported, "schema_version")
	}
	tx, err := c.db.Begin()
	if err != nil {
		return fmt.Errorf("memory core: begin schema: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS memory_banks (
			bank_ref TEXT PRIMARY KEY,
			lifecycle_ref TEXT NOT NULL,
			canonical_version INTEGER NOT NULL DEFAULT 0,
			state TEXT NOT NULL CHECK (state IN ('active', 'deleted')),
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_bank_bindings (
			binding_ref TEXT PRIMARY KEY,
			bank_ref TEXT NOT NULL REFERENCES memory_banks(bank_ref) ON DELETE CASCADE,
			state TEXT NOT NULL CHECK (state IN ('active', 'retired')),
			created_at TEXT NOT NULL,
			retired_at TEXT
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS memory_bank_active_binding_idx ON memory_bank_bindings(bank_ref) WHERE state = 'active'`,
		`CREATE TABLE IF NOT EXISTS memory_operations (
			operation_id TEXT PRIMARY KEY,
			operation_kind TEXT NOT NULL,
			binding_ref TEXT NOT NULL,
			bank_ref TEXT,
			event_ref TEXT,
			delivery_sequence INTEGER,
			request_key TEXT NOT NULL,
			outcome TEXT NOT NULL,
			result_json BLOB,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS memory_operations_binding_idx ON memory_operations(binding_ref, operation_kind)`,
		`CREATE TABLE IF NOT EXISTS memory_frontiers (
			binding_ref TEXT PRIMARY KEY REFERENCES memory_bank_bindings(binding_ref) ON DELETE CASCADE,
			received_frontier INTEGER NOT NULL DEFAULT 0,
			ready_frontier INTEGER NOT NULL DEFAULT 0
		)`,
		`CREATE TABLE IF NOT EXISTS memory_receipts (
			operation_id TEXT PRIMARY KEY REFERENCES memory_operations(operation_id) ON DELETE CASCADE,
			binding_ref TEXT NOT NULL REFERENCES memory_bank_bindings(binding_ref) ON DELETE CASCADE,
			bank_ref TEXT NOT NULL,
			event_ref TEXT NOT NULL,
			delivery_sequence INTEGER NOT NULL CHECK (delivery_sequence > 0),
			request_key TEXT NOT NULL,
			lifecycle_ref TEXT NOT NULL,
			outcome TEXT NOT NULL,
			payload BLOB,
			committed_at TEXT NOT NULL,
			terminal_at TEXT,
			UNIQUE(binding_ref, delivery_sequence),
			UNIQUE(bank_ref, event_ref)
		)`,
		`CREATE TABLE IF NOT EXISTS memories (
			memory_ref TEXT PRIMARY KEY,
			bank_ref TEXT NOT NULL,
			content TEXT NOT NULL,
			epistemic_status TEXT NOT NULL,
			lifecycle TEXT NOT NULL,
			occurred_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			source_explanation TEXT NOT NULL,
			event_ref TEXT NOT NULL,
			supersedes_ref TEXT
		)`,
		`CREATE INDEX IF NOT EXISTS memories_bank_lifecycle_idx ON memories(bank_ref, lifecycle, updated_at)`,
		`CREATE TABLE IF NOT EXISTS memory_lineage (
			memory_ref TEXT NOT NULL REFERENCES memories(memory_ref) ON DELETE CASCADE,
			ref_type TEXT NOT NULL CHECK (ref_type IN ('subject', 'source')),
			ref_kind TEXT NOT NULL,
			ref_value TEXT NOT NULL,
			PRIMARY KEY(memory_ref, ref_type, ref_kind, ref_value)
		)`,
		`CREATE TABLE IF NOT EXISTS memory_derived_generations (
			bank_ref TEXT NOT NULL,
			kind TEXT NOT NULL CHECK (kind IN ('fts', 'embedding')),
			generation_ref TEXT NOT NULL,
			canonical_version INTEGER NOT NULL,
			status TEXT NOT NULL CHECK (status IN ('building', 'ready', 'failed')),
			updated_at TEXT NOT NULL,
			PRIMARY KEY(bank_ref, kind, generation_ref)
		)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(memory_ref UNINDEXED, bank_ref UNINDEXED, content)`,
		`CREATE TABLE IF NOT EXISTS memory_vector_items (
			generation_ref TEXT NOT NULL,
			memory_ref TEXT NOT NULL,
			dimension INTEGER NOT NULL,
			vector_json BLOB NOT NULL,
			PRIMARY KEY(generation_ref, memory_ref)
		)`,
		`CREATE TABLE IF NOT EXISTS memory_operation_routes (
			operation_id TEXT PRIMARY KEY,
			operation_kind TEXT NOT NULL,
			bank_ref TEXT NOT NULL,
			request_key TEXT NOT NULL,
			pipeline TEXT NOT NULL,
			algorithm_revision TEXT NOT NULL,
			config_revision INTEGER NOT NULL,
			capabilities_json BLOB NOT NULL,
			outcome TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(statement); err != nil {
			return fmt.Errorf("memory core: initialize schema: %w", err)
		}
	}
	if version == 0 {
		if _, err := tx.Exec(`PRAGMA user_version = 1`); err != nil {
			return fmt.Errorf("memory core: set schema version: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("memory core: commit schema: %w", err)
	}
	return nil
}

func randomOpaqueRef(prefix string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("memory core: create opaque ref: %w", err)
	}
	return prefix + "_" + hex.EncodeToString(raw), nil
}

func canonicalRequestKey(value any) (string, error) {
	raw, err := json.Marshal(value)
	if err != nil {
		return "", fmt.Errorf("memory core: encode request identity: %w", err)
	}
	digest := sha256.Sum256(raw)
	return hex.EncodeToString(digest[:]), nil
}

func validOpaqueRef(value string) bool {
	return strings.TrimSpace(value) == value && value != "" && len(value) <= 512 && utf8.ValidString(value)
}

func validTypedRef(ref TypedRef) bool {
	return validOpaqueRef(ref.Kind) && validOpaqueRef(ref.Value)
}

func validateTypedRefs(refs []TypedRef) bool {
	if refs == nil {
		return false
	}
	seen := make(map[string]struct{}, len(refs))
	for _, ref := range refs {
		if !validTypedRef(ref) {
			return false
		}
		key := ref.Kind + "\x00" + ref.Value
		if _, duplicate := seen[key]; duplicate {
			return false
		}
		seen[key] = struct{}{}
	}
	return true
}

func validContent(value string) bool {
	return strings.TrimSpace(value) == value && value != "" && len([]byte(value)) <= 16*1024 && utf8.ValidString(value)
}

func formatTime(value time.Time) string { return value.UTC().Format(time.RFC3339Nano) }

func parseTime(value string) (time.Time, error) {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return time.Time{}, fmt.Errorf("memory core: parse timestamp: %w", err)
	}
	return parsed, nil
}
