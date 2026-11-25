package memoryv1

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"modernc.org/sqlite"
)

const (
	storeFilename = "cognition-memory-v1.sqlite3"
	schemaVersion = 5
)

type Core struct {
	embeddingMu     sync.Mutex
	embeddingActive map[string]bool
	db              *sql.DB
	now             func() time.Time
	newRef          func(string) (string, error)
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
	storePath := filepath.Join(rootDir, storeFilename)
	absolute, err := filepath.Abs(storePath)
	if err != nil {
		return nil, err
	}
	uriPath := filepath.ToSlash(absolute)
	if !strings.HasPrefix(uriPath, "/") {
		uriPath = "/" + uriPath
	}
	dsn := (&url.URL{Scheme: "file", Path: uriPath, RawQuery: "_pragma=busy_timeout(5000)&_pragma=foreign_keys(ON)"}).String()
	db, err := sql.Open("sqlite", dsn)
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

func validateExistingStore(ctx context.Context, conn *sql.Conn, version int) error {
	checks := []string{
		`SELECT bank_ref,lifecycle_ref,canonical_version,state,created_at,updated_at FROM memory_banks LIMIT 0`,
		`SELECT binding_ref,bank_ref,state,created_at,retired_at FROM memory_bank_bindings LIMIT 0`,
		`SELECT operation_id,operation_kind,binding_ref,bank_ref,event_ref,delivery_sequence,request_key,outcome,result_json,created_at,updated_at FROM memory_operations LIMIT 0`,
		`SELECT binding_ref,received_frontier,ready_frontier FROM memory_frontiers LIMIT 0`,
		`SELECT operation_id,binding_ref,bank_ref,event_ref,delivery_sequence,request_key,lifecycle_ref,outcome,payload,committed_at,terminal_at FROM memory_receipts LIMIT 0`,
		`SELECT memory_ref,bank_ref,content,epistemic_status,lifecycle,occurred_at,updated_at,source_explanation,event_ref,supersedes_ref FROM memories LIMIT 0`,
		`SELECT memory_ref,ref_type,ref_kind,ref_value FROM memory_lineage LIMIT 0`,
	}
	if version == schemaVersion {
		checks = append(checks, `SELECT scope_tag,slot_key FROM memories LIMIT 0`)
	}
	for _, query := range checks {
		rows, err := conn.QueryContext(ctx, query)
		if err != nil {
			return fmt.Errorf("memory core: existing store schema is incomplete: %w", err)
		}
		_ = rows.Close()
	}
	return nil
}

func (c *Core) Close() error {
	if c == nil || c.db == nil {
		return nil
	}
	// Callers stop owner work before closing. database/sql may still be rolling
	// back a cancelled transaction after its caller has returned. Acquire the
	// single connection to wait for that rollback before releasing this store.
	conn, err := c.db.Conn(context.Background())
	if err == nil {
		closeErr := c.db.Close()
		return errors.Join(closeErr, conn.Close())
	}
	return c.db.Close()
}

func (c *Core) initialize() error {
	if _, err := c.db.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("memory core: enable foreign keys: %w", err)
	}
	ctx := context.Background()
	conn, err := c.db.Conn(ctx)
	if err != nil {
		return fmt.Errorf("memory core: acquire schema conn: %w", err)
	}
	defer func() { _ = conn.Close() }()
	// Concurrent transitions to WAL can return SQLITE_BUSY before SQLite invokes its busy handler.
	deadline := time.Now().Add(5 * time.Second)
	for {
		var mode string
		err := conn.QueryRowContext(ctx, `PRAGMA journal_mode = WAL`).Scan(&mode)
		if err == nil && strings.EqualFold(mode, "wal") {
			break
		}
		var busy *sqlite.Error
		if !errors.As(err, &busy) || busy.Code()&255 != 5 || !time.Now().Before(deadline) {
			return fmt.Errorf("memory core: enable WAL (mode %q): %v", mode, err)
		}
		time.Sleep(20 * time.Millisecond)
	}
	// Acquire an IMMEDIATE SQLite write transaction upfront so concurrent opens
	// serialize cleanly under busy_timeout without DEFERRED read->write upgrade deadlocks.
	if _, err := conn.ExecContext(ctx, `BEGIN IMMEDIATE`); err != nil {
		return fmt.Errorf("memory core: begin immediate schema: %w", err)
	}
	committed := false
	defer func() {
		if !committed {
			_, _ = conn.ExecContext(ctx, `ROLLBACK`)
		}
	}()
	var version int
	if err := conn.QueryRowContext(ctx, `PRAGMA user_version`).Scan(&version); err != nil {
		return fmt.Errorf("memory core: inspect schema version: %w", err)
	}
	if version != 0 && version != 4 && version != schemaVersion {
		return contractError(OutcomeUnsupported, "schema_version")
	}
	if version == 0 {
		var objects int
		if err := conn.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' `).Scan(&objects); err != nil {
			return err
		}
		if objects != 0 {
			return contractError(OutcomeUnsupported, "schema_version")
		}
	} else if err := validateExistingStore(ctx, conn, version); err != nil {
		return err
	}
	// Controlled incremental migration v4 -> v5: add scope_tag & slot_key columns
	// and active single-slot unique index before running idempotent DDL.
	if version == 4 {
		hasScopeTag, err := connTableHasColumn(ctx, conn, "memories", "scope_tag")
		if err != nil {
			return fmt.Errorf("memory core: inspect memories.scope_tag: %w", err)
		}
		if !hasScopeTag {
			if _, err := conn.ExecContext(ctx, `ALTER TABLE memories ADD COLUMN scope_tag TEXT NOT NULL DEFAULT 'global_fact'`); err != nil {
				return fmt.Errorf("memory core: migrate schema v4->v5 scope_tag: %w", err)
			}
		}
		hasSlotKey, err := connTableHasColumn(ctx, conn, "memories", "slot_key")
		if err != nil {
			return fmt.Errorf("memory core: inspect memories.slot_key: %w", err)
		}
		if !hasSlotKey {
			if _, err := conn.ExecContext(ctx, `ALTER TABLE memories ADD COLUMN slot_key TEXT NOT NULL DEFAULT ''`); err != nil {
				return fmt.Errorf("memory core: migrate schema v4->v5 slot_key: %w", err)
			}
		}
		if _, err := conn.ExecContext(ctx, `CREATE UNIQUE INDEX IF NOT EXISTS memories_active_slot_idx ON memories(bank_ref, slot_key) WHERE lifecycle = 'current' AND slot_key != ''`); err != nil {
			return fmt.Errorf("memory core: migrate schema v4->v5 slot_idx: %w", err)
		}
	}
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
			supersedes_ref TEXT,
			scope_tag TEXT NOT NULL DEFAULT 'global_fact',
			slot_key TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS memories_bank_lifecycle_idx ON memories(bank_ref, lifecycle, updated_at)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS memories_active_slot_idx ON memories(bank_ref, slot_key) WHERE lifecycle = 'current' AND slot_key != ''`,
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
			lifecycle_ref TEXT NOT NULL,
			config_revision INTEGER NOT NULL DEFAULT 0,
			embedding_space_ref TEXT NOT NULL DEFAULT '',
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
            ai_lifecycle_ref TEXT NOT NULL DEFAULT '',
            ai_disposition TEXT NOT NULL DEFAULT 'none' CHECK(ai_disposition IN ('none', 'retained', 'pending', 'done')),
            outcome TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS deleted_session_cutoffs (
			binding_ref TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			deleted_at TEXT NOT NULL,
			PRIMARY KEY(binding_ref, work_session_ref)
		)`,
		`CREATE TABLE IF NOT EXISTS deleted_session_bank_cutoffs (
			bank_ref TEXT NOT NULL,
			work_session_ref TEXT NOT NULL,
			deleted_at TEXT NOT NULL,
			PRIMARY KEY(bank_ref, work_session_ref)
		)`,
	}
	for _, statement := range statements {
		if _, err := conn.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("memory core: initialize schema: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `INSERT OR IGNORE INTO deleted_session_bank_cutoffs(bank_ref,work_session_ref,deleted_at)
		SELECT b.bank_ref,c.work_session_ref,c.deleted_at FROM deleted_session_cutoffs c
		JOIN memory_bank_bindings b ON b.binding_ref=c.binding_ref`); err != nil {
		return err
	}
	// All content-bearing reads share the same cutoff fence, including corrected
	// descendants while exact forgetting is still pending in a different store.
	if _, err := conn.ExecContext(ctx, `CREATE VIEW IF NOT EXISTS visible_session_memories AS
		WITH RECURSIVE hidden(ref,bank) AS (
			SELECT m.memory_ref,m.bank_ref FROM deleted_session_bank_cutoffs c
			JOIN memory_lineage l ON l.ref_type='source' AND l.ref_kind='session' AND l.ref_value=c.work_session_ref
			JOIN memories m ON m.memory_ref=l.memory_ref AND m.bank_ref=c.bank_ref
			UNION SELECT m.memory_ref,m.bank_ref FROM memories m JOIN hidden h ON m.supersedes_ref=h.ref AND m.bank_ref=h.bank
		) SELECT m.* FROM memories m WHERE NOT EXISTS (SELECT 1 FROM hidden h WHERE h.ref=m.memory_ref AND h.bank=m.bank_ref)`); err != nil {
		return err
	}
	// An interrupted consumer cannot still be using its execution copy. This
	// changes only disposition; it never replays an AI request after restart.
	if _, err := conn.ExecContext(ctx, `UPDATE memory_operation_routes SET ai_disposition = 'pending', outcome = 'conflict' WHERE ai_disposition = 'retained' AND operation_kind = 'recall'`); err != nil {
		return err
	}
	if version == 0 || version == 4 {
		if _, err := conn.ExecContext(ctx, fmt.Sprintf(`PRAGMA user_version = %d`, schemaVersion)); err != nil {
			return fmt.Errorf("memory core: set schema version: %w", err)
		}
	}
	if _, err := conn.ExecContext(ctx, `COMMIT`); err != nil {
		return fmt.Errorf("memory core: commit schema: %w", err)
	}
	committed = true
	return nil
}

// FindMemoryRefsBySource returns all non-forgotten memory_ref values in bankRef
// whose memory_lineage links to (ref_type='source', ref_kind=sourceKind, ref_value=sourceValue).
func (c *Core) FindMemoryRefsBySource(ctx context.Context, bankRef, sourceKind, sourceValue string) ([]string, error) {
	if !validOpaqueRef(bankRef) || strings.TrimSpace(sourceKind) == "" || strings.TrimSpace(sourceValue) == "" {
		return nil, contractError(OutcomeInvalid, "lineage_source_query")
	}
	rows, err := c.db.QueryContext(ctx, `
		WITH RECURSIVE descendants(ref) AS (
			SELECT l.memory_ref FROM memory_lineage l JOIN memories m USING(memory_ref)
			WHERE m.bank_ref = ? AND l.ref_type = 'source' AND l.ref_kind = ? AND l.ref_value = ?
			UNION SELECT m.memory_ref FROM memories m JOIN descendants d ON d.ref = m.supersedes_ref WHERE m.bank_ref = ?
		) SELECT m.memory_ref FROM descendants d JOIN memories m ON m.memory_ref = d.ref
		WHERE m.lifecycle <> ? ORDER BY m.memory_ref`,
		bankRef, strings.TrimSpace(sourceKind), strings.TrimSpace(sourceValue), bankRef, LifecycleForgotten,
	)
	if err != nil {
		return nil, fmt.Errorf("find memory refs by source: %w", err)
	}
	defer func() { _ = rows.Close() }()
	var refs []string
	for rows.Next() {
		var ref string
		if err := rows.Scan(&ref); err != nil {
			return nil, fmt.Errorf("scan memory ref by source: %w", err)
		}
		refs = append(refs, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return refs, nil
}

// RecordSessionCutoff persists an irreversible deletion fence for
// (bindingRef, workSessionRef) and its parent (bankRef, workSessionRef) inside
// memory.db so late session-pointer writes, binding rotations, or in-flight
// receipts can never resurrect a deleted session.
func (c *Core) RecordSessionCutoff(ctx context.Context, bindingRef, workSessionRef string) error {
	if !validOpaqueRef(bindingRef) || !validOpaqueRef(workSessionRef) {
		return contractError(OutcomeInvalid, "session_cutoff_input")
	}
	now := formatTime(c.now())
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("record session cutoff: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO deleted_session_cutoffs(binding_ref, work_session_ref, deleted_at)
		VALUES(?, ?, ?)
		ON CONFLICT(binding_ref, work_session_ref) DO NOTHING`,
		bindingRef, workSessionRef, now,
	); err != nil {
		return fmt.Errorf("record session cutoff: %w", err)
	}
	var bankRef string
	err = tx.QueryRowContext(ctx, `SELECT bank_ref FROM memory_bank_bindings WHERE binding_ref = ?`, bindingRef).Scan(&bankRef)
	if err == nil && strings.TrimSpace(bankRef) != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO deleted_session_bank_cutoffs(bank_ref, work_session_ref, deleted_at)
			VALUES(?, ?, ?)
			ON CONFLICT(bank_ref, work_session_ref) DO NOTHING`,
			bankRef, workSessionRef, now,
		); err != nil {
			return fmt.Errorf("record bank session cutoff: %w", err)
		}
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return fmt.Errorf("record session cutoff: resolve bank: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("record session cutoff: commit: %w", err)
	}
	return nil
}

// IsSessionCutoff reports whether workSessionRef has been irreversibly cut off
// for bindingRef or its underlying bank (surviving binding rotations).
func (c *Core) IsSessionCutoff(ctx context.Context, bindingRef, workSessionRef string) (bool, error) {
	if !validOpaqueRef(bindingRef) || !validOpaqueRef(workSessionRef) {
		return false, contractError(OutcomeInvalid, "session_cutoff_input")
	}
	var exists int
	err := c.db.QueryRowContext(ctx, `
		SELECT 1 FROM deleted_session_cutoffs WHERE binding_ref = ? AND work_session_ref = ?
		UNION
		SELECT 1 FROM deleted_session_bank_cutoffs bc
		JOIN memory_bank_bindings mb ON mb.bank_ref = bc.bank_ref
		WHERE mb.binding_ref = ? AND bc.work_session_ref = ?
		LIMIT 1`, bindingRef, workSessionRef, bindingRef, workSessionRef).Scan(&exists)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("inspect session cutoff: %w", err)
	}
	return true, nil
}

func requestHasSessionCutoffTx(ctx context.Context, tx *sql.Tx, request CommitRequest, mutations []MemoryMutation) (bool, error) {
	sessionRefs := make([]string, 0, 4)
	addRef := func(ref string) {
		trimmed := strings.TrimSpace(ref)
		if trimmed == "" {
			return
		}
		for _, existing := range sessionRefs {
			if existing == trimmed {
				return
			}
		}
		sessionRefs = append(sessionRefs, trimmed)
	}
	for _, src := range request.Sources {
		if src.Kind == "session" {
			addRef(src.Value)
		}
	}
	if request.Fact.SessionPointer != nil {
		addRef(request.Fact.SessionPointer.WorkSessionRef)
	}
	// For Correction / Conflict events, inspect target memory_ref session lineage so
	// late corrections cannot resurrect or mutate memories belonging to a deleted session.
	targetMemoryRefs := make([]string, 0, 2)
	if request.Fact.Kind == EventKindCorrection && request.Fact.Correction != nil && strings.TrimSpace(request.Fact.Correction.TargetMemoryRef) != "" {
		targetMemoryRefs = append(targetMemoryRefs, strings.TrimSpace(request.Fact.Correction.TargetMemoryRef))
	}
	for _, mut := range mutations {
		if strings.TrimSpace(mut.TargetMemoryRef) != "" {
			targetMemoryRefs = append(targetMemoryRefs, strings.TrimSpace(mut.TargetMemoryRef))
		}
	}
	for _, memRef := range targetMemoryRefs {
		rows, err := tx.QueryContext(ctx, `
			WITH RECURSIVE ancestors(ref) AS (
				SELECT ? UNION SELECT m.supersedes_ref FROM ancestors a JOIN memories m ON m.memory_ref = a.ref
				WHERE m.bank_ref = ? AND m.supersedes_ref IS NOT NULL
			) SELECT ref_value FROM memory_lineage JOIN ancestors ON ref = memory_ref
			WHERE ref_type = 'source' AND ref_kind = 'session'`, memRef, request.BankRef)
		if err != nil {
			return false, err
		}
		for rows.Next() {
			var sRef string
			if scanErr := rows.Scan(&sRef); scanErr != nil {
				_ = rows.Close()
				return false, scanErr
			}
			addRef(sRef)
		}
		if err := rows.Close(); err != nil {
			return false, err
		}
	}
	for _, ref := range sessionRefs {
		var exists int
		err := tx.QueryRowContext(ctx, `
			SELECT 1 FROM deleted_session_cutoffs WHERE binding_ref = ? AND work_session_ref = ?
			UNION
			SELECT 1 FROM deleted_session_bank_cutoffs WHERE bank_ref = ? AND work_session_ref = ?
			LIMIT 1`, request.BindingRef, ref, request.BankRef, ref).Scan(&exists)
		if err == nil {
			return true, nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return false, err
		}
	}
	return false, nil
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

func connTableHasColumn(ctx context.Context, conn *sql.Conn, table, column string) (bool, error) {
	rows, err := conn.QueryContext(ctx, `PRAGMA table_info(`+table+`)`)
	if err != nil {
		return false, err
	}
	defer func() { _ = rows.Close() }()
	for rows.Next() {
		var (
			cid        int
			name       string
			colType    string
			notNull    int
			defaultVal sql.NullString
			pk         int
		)
		if err := rows.Scan(&cid, &name, &colType, &notNull, &defaultVal, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
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
