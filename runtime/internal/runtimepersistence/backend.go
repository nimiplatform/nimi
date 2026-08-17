package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	_ "modernc.org/sqlite"
)

const (
	dbDriverName         = "sqlite"
	dbFileName           = "memory.db"
	backupDirName        = "backups"
	maxBackupSnapshots   = 3
	writeQueueBuffer     = 64
	defaultBusyTimeoutMS = 5000
	defaultWALCheckpoint = 1000
	integrityCheckPragma = "PRAGMA quick_check"

	realmSourceMaterializationEpochMetaKey = "realm_source_materialization_contract_epoch"
	realmSourceMaterializationEpochV3      = "v3"
	retiredSourceSnapshotNoUpdateTrigger   = "runtime_local_agent_source_snapshot_no_update"
	retiredSourceProvenanceNoUpdateTrigger = "runtime_local_agent_source_provenance_no_update"
	retiredSourceChunkTable                = "runtime_source_materialization_chunk"
	retiredSourceNonceReplayTable          = "runtime_source_materialization_nonce_replay"
	retiredSourceUploadTable               = "runtime_source_materialization_upload"
	retiredSourceChallengeTable            = "runtime_source_materialization_challenge"
	retiredSourceNonceTable                = "runtime_source_materialization_nonce"
	retiredSourceProvenanceTable           = "runtime_local_agent_source_provenance"
	retiredSourceSnapshotTable             = "runtime_local_agent_source_snapshot"
)

var ErrIncompatibleRealmSourceMaterializationData = errors.New("incompatible_source_materialization_data")

func retiredRealmSourceMaterializationTriggers() []string {
	return []string{
		retiredSourceSnapshotNoUpdateTrigger,
		retiredSourceProvenanceNoUpdateTrigger,
	}
}

// Dependencies are ordered before the tables they reference so the scoped
// hard cut remains valid with SQLite foreign-key enforcement enabled.
func retiredRealmSourceMaterializationTables() []string {
	return []string{
		retiredSourceChunkTable,
		retiredSourceNonceReplayTable,
		retiredSourceUploadTable,
		retiredSourceChallengeTable,
		retiredSourceNonceTable,
		retiredSourceProvenanceTable,
		retiredSourceSnapshotTable,
	}
}

type sqliteSchemaObject struct {
	name string
	kind string
}

func currentRealmSourceMaterializationObjects() []sqliteSchemaObject {
	return []sqliteSchemaObject{
		{name: "runtime_realm_source_materialization_attempt_v3", kind: "table"},
		{name: "runtime_realm_source_materialization_replay_v3", kind: "table"},
		{name: "runtime_local_agent_source_snapshot_v2", kind: "table"},
		{name: "runtime_local_agent_source_provenance_v3", kind: "table"},
		{name: "runtime_local_agent_source_snapshot_v2_no_update", kind: "trigger"},
		{name: "runtime_local_agent_source_provenance_v3_no_update", kind: "trigger"},
	}
}

type Backend struct {
	logger    *slog.Logger
	path      string
	backupDir string

	readDB  *sql.DB
	writeDB *sql.DB

	writeCh   chan writeRequest
	writeDone chan struct{}
	closeOnce sync.Once
	closed    atomic.Bool
}

type writeRequest struct {
	ctx context.Context
	op  func(context.Context) error
	res chan error
}

func Open(logger *slog.Logger, localStatePath string) (*Backend, error) {
	if logger == nil {
		logger = slog.Default()
	}
	path, err := databasePath(localStatePath)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create sqlite directory: %w", err)
	}

	writeDB, err := openSQLite(path, true, false)
	if err != nil {
		return nil, err
	}
	backend := &Backend{
		logger:    logger,
		path:      path,
		backupDir: filepath.Join(filepath.Dir(path), backupDirName),
		writeDB:   writeDB,
		writeCh:   make(chan writeRequest, writeQueueBuffer),
		writeDone: make(chan struct{}),
	}
	if err := backend.ensureHealthyOrRestore(); err != nil {
		_ = writeDB.Close()
		return nil, err
	}
	if err := backend.requireRealmSourceMaterializationCompatibility(); err != nil {
		_ = writeDB.Close()
		return nil, err
	}
	if err := backend.ensureSchema(); err != nil {
		_ = writeDB.Close()
		return nil, err
	}
	readDB, err := openSQLite(path, false, true)
	if err != nil {
		_ = writeDB.Close()
		return nil, err
	}
	backend.readDB = readDB
	go backend.runWriteLoop()
	return backend, nil
}

func (b *Backend) DB() *sql.DB {
	if b.readDB != nil {
		return b.readDB
	}
	return b.writeDB
}

func (b *Backend) Path() string {
	return b.path
}

func (b *Backend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if fn == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	return b.runSerialized(ctx, func(ctx context.Context) error {
		return b.executeWrite(ctx, fn)
	})
}

func (b *Backend) Close() error {
	var closeErr error
	b.closeOnce.Do(func() {
		b.closed.Store(true)
		close(b.writeCh)
		if b.writeDone != nil {
			<-b.writeDone
		}
		var errs []error
		if b.readDB != nil {
			errs = append(errs, b.readDB.Close())
		}
		if b.writeDB != nil {
			errs = append(errs, b.writeDB.Close())
		}
		closeErr = errors.Join(errs...)
	})
	return closeErr
}

func (b *Backend) BackupNow(ctx context.Context) (string, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	var backupPath string
	err := b.runSerialized(ctx, func(ctx context.Context) error {
		now := time.Now().UTC()
		backupPath = filepath.Join(b.backupDir, fmt.Sprintf("memory-%s-%09d.db", now.Format("20060102-150405"), now.Nanosecond()))
		if err := os.MkdirAll(b.backupDir, 0o700); err != nil {
			return fmt.Errorf("create backup dir: %w", err)
		}
		escaped := strings.ReplaceAll(backupPath, "'", "''")
		if _, err := b.writeDB.ExecContext(ctx, "PRAGMA wal_checkpoint(TRUNCATE)"); err != nil {
			return err
		}
		if _, err := b.writeDB.ExecContext(ctx, fmt.Sprintf("VACUUM INTO '%s'", escaped)); err != nil {
			return err
		}
		if err := pruneBackups(b.backupDir); err != nil && b.logger != nil {
			b.logger.Warn("prune sqlite backups failed", "dir", b.backupDir, "error", err)
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	return backupPath, nil
}

func (b *Backend) runWriteLoop() {
	defer close(b.writeDone)
	for req := range b.writeCh {
		req.res <- req.op(req.ctx)
		close(req.res)
	}
}

func (b *Backend) runSerialized(ctx context.Context, op func(context.Context) error) (err error) {
	if op == nil {
		return nil
	}
	if b == nil || b.closed.Load() {
		return sql.ErrConnDone
	}
	if ctx == nil {
		ctx = context.Background()
	}
	defer func() {
		if recover() != nil {
			err = sql.ErrConnDone
		}
	}()
	req := writeRequest{
		ctx: ctx,
		op:  op,
		res: make(chan error, 1),
	}
	select {
	case b.writeCh <- req:
	case <-ctx.Done():
		return ctx.Err()
	}
	select {
	case err := <-req.res:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (b *Backend) executeWrite(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := b.writeDB.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin sqlite tx: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit sqlite tx: %w", err)
	}
	return nil
}

func (b *Backend) ensureHealthyOrRestore() error {
	ok, err := quickCheck(b.writeDB)
	if err == nil && ok {
		return nil
	}
	if b.logger != nil {
		b.logger.Warn("sqlite quick_check failed, attempting restore", "path", b.path, "error", err)
	}
	_ = b.writeDB.Close()
	if restoreErr := restoreLatestHealthyBackup(b.path, b.backupDir); restoreErr != nil {
		return fmt.Errorf("sqlite quick_check failed and restore failed: %w", errors.Join(err, restoreErr))
	}
	db, openErr := openSQLite(b.path, true, false)
	if openErr != nil {
		return fmt.Errorf("reopen restored sqlite db: %w", openErr)
	}
	b.writeDB = db
	ok, err = quickCheck(b.writeDB)
	if err != nil || !ok {
		return fmt.Errorf("restored sqlite db failed quick_check: %w", err)
	}
	return nil
}

func (b *Backend) ensureSchema() error {
	preflightStmts := []string{
		"DROP TABLE IF EXISTS " + "memory_embedding_" + "intent",
		"DROP TABLE IF EXISTS " + "runtime_agent_" + "execution_" + "config",
	}
	for _, stmt := range preflightStmts {
		if _, err := b.writeDB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure sqlite schema preflight: %w", err)
		}
	}
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS memory_bank (
			locator_key TEXT PRIMARY KEY,
			scope INTEGER NOT NULL,
			bank_id TEXT NOT NULL,
			updated_at TEXT,
			canonical_agent_scope INTEGER NOT NULL DEFAULT 0,
			public_api_writable INTEGER NOT NULL DEFAULT 0,
			embedding_bound INTEGER NOT NULL DEFAULT 0,
			bank_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_record (
			memory_id TEXT PRIMARY KEY,
			locator_key TEXT NOT NULL,
			kind INTEGER NOT NULL,
			canonical_class INTEGER NOT NULL,
			created_at TEXT,
			updated_at TEXT,
			replication_outcome INTEGER NOT NULL DEFAULT 0,
			search_text TEXT NOT NULL DEFAULT '',
			search_tokens TEXT NOT NULL DEFAULT '',
			record_json TEXT NOT NULL,
			FOREIGN KEY(locator_key) REFERENCES memory_bank(locator_key) ON DELETE CASCADE
		)`,
		`CREATE VIRTUAL TABLE IF NOT EXISTS memory_record_fts USING fts5(memory_id UNINDEXED, locator_key UNINDEXED, content, tokens)`,
		`CREATE TABLE IF NOT EXISTS memory_record_embedding (
			memory_id TEXT PRIMARY KEY,
			locator_key TEXT NOT NULL,
			dimension INTEGER NOT NULL,
			vector_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_replication_backlog (
			backlog_key TEXT PRIMARY KEY,
			locator_key TEXT NOT NULL,
			memory_id TEXT NOT NULL,
			enqueued_at TEXT NOT NULL,
			item_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_narrative (
			narrative_id TEXT PRIMARY KEY,
			bank_locator_key TEXT NOT NULL,
			topic TEXT NOT NULL,
			content TEXT NOT NULL,
			source_version TEXT NOT NULL,
			status TEXT NOT NULL,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_narrative_embedding (
			locator_key TEXT NOT NULL,
			narrative_id TEXT NOT NULL,
			embedding_profile_json TEXT NOT NULL,
			vector_json TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (locator_key, narrative_id)
		)`,
		`CREATE TABLE IF NOT EXISTS memory_narrative_alias (
			bank_locator_key TEXT NOT NULL,
			narrative_id TEXT NOT NULL,
			alias_norm TEXT NOT NULL,
			alias_display TEXT NOT NULL,
			helpful_count INTEGER NOT NULL DEFAULT 0,
			unhelpful_count INTEGER NOT NULL DEFAULT 0,
			status TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY (bank_locator_key, narrative_id, alias_norm)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_memory_narrative_alias_lookup ON memory_narrative_alias(bank_locator_key, alias_norm, status)`,
		`CREATE TABLE IF NOT EXISTS narrative_source (
			narrative_id TEXT NOT NULL,
			memory_id TEXT NOT NULL,
			bank_locator_key TEXT NOT NULL,
			absorbed_at TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			deactivated_at TEXT,
			PRIMARY KEY (narrative_id, memory_id)
		)`,
		`CREATE TABLE IF NOT EXISTS memory_relation (
			relation_id TEXT PRIMARY KEY,
			bank_locator_key TEXT NOT NULL,
			source_id TEXT NOT NULL,
			target_id TEXT NOT NULL,
			relation_type TEXT NOT NULL,
			confidence REAL NOT NULL,
			created_by TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_recall_feedback_event (
			feedback_id TEXT PRIMARY KEY,
			bank_locator_key TEXT NOT NULL,
			target_kind TEXT NOT NULL,
			target_id TEXT NOT NULL,
			polarity TEXT NOT NULL,
			query_text TEXT NOT NULL,
			source_system TEXT NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_recall_feedback_summary (
			bank_locator_key TEXT NOT NULL,
			target_kind TEXT NOT NULL,
			target_id TEXT NOT NULL,
			helpful_count INTEGER NOT NULL DEFAULT 0,
			unhelpful_count INTEGER NOT NULL DEFAULT 0,
			last_feedback_at TEXT NOT NULL,
			PRIMARY KEY (bank_locator_key, target_kind, target_id)
		)`,
		`CREATE TABLE IF NOT EXISTS agent_truth (
			truth_id TEXT PRIMARY KEY,
			bank_locator_key TEXT NOT NULL,
			dimension TEXT NOT NULL,
			normalized_key TEXT NOT NULL,
			statement TEXT NOT NULL,
			confidence REAL NOT NULL,
			review_count INTEGER NOT NULL DEFAULT 0,
			first_review_at TEXT,
			last_review_at TEXT,
			status TEXT NOT NULL,
			supersedes_truth_id TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			truth_json TEXT NOT NULL
		)`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_truth_identity ON agent_truth(bank_locator_key, dimension, normalized_key)`,
		`CREATE TABLE IF NOT EXISTS truth_source (
			truth_id TEXT NOT NULL,
			memory_id TEXT NOT NULL,
			bank_locator_key TEXT NOT NULL,
			observed_at TEXT NOT NULL,
			is_active INTEGER NOT NULL DEFAULT 1,
			deactivated_at TEXT,
			PRIMARY KEY (truth_id, memory_id)
		)`,
		`CREATE TABLE IF NOT EXISTS memory_review_commit (
			review_run_id TEXT PRIMARY KEY,
			bank_locator_key TEXT NOT NULL,
			checkpoint_basis TEXT,
			outcome_hash TEXT NOT NULL,
			committed_at TEXT NOT NULL,
			outcomes_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS memory_review_checkpoint (
			bank_locator_key TEXT PRIMARY KEY,
			checkpoint_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent (
			local_agent_ref TEXT PRIMARY KEY,
			agent_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_state_projection (
			local_agent_ref TEXT PRIMARY KEY,
			state_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_hook (
			local_agent_ref TEXT NOT NULL,
			hook_id TEXT NOT NULL,
			status INTEGER NOT NULL,
			scheduled_for TEXT,
			hook_json TEXT NOT NULL,
			PRIMARY KEY (local_agent_ref, hook_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_event_log (
			sequence INTEGER PRIMARY KEY,
			local_agent_ref TEXT NOT NULL,
			event_type INTEGER NOT NULL,
			timestamp TEXT,
			event_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_behavioral_posture (
			local_agent_ref TEXT PRIMARY KEY,
			status_text TEXT NOT NULL,
			truth_basis_json TEXT NOT NULL,
			posture_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_review_run (
			review_run_id TEXT PRIMARY KEY,
			local_agent_ref TEXT NOT NULL,
			bank_locator_key TEXT NOT NULL,
			checkpoint_basis TEXT,
			status TEXT NOT NULL,
			prepared_outcomes_json TEXT NOT NULL,
			failure_message TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_review_followup (
			bank_locator_key TEXT PRIMARY KEY,
			review_run_id TEXT NOT NULL,
			checkpoint_basis TEXT,
			completed_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_realm_source_materialization_attempt_v3 (
			materializer_account_id TEXT NOT NULL,
			request_id TEXT NOT NULL,
			intent_digest TEXT NOT NULL,
			source_ref_json TEXT NOT NULL,
			runtime_instance_id TEXT NOT NULL,
			challenge_id TEXT NOT NULL UNIQUE,
			challenge_digest TEXT NOT NULL UNIQUE,
			intended_runtime_audience TEXT NOT NULL,
			challenge_issued_at TEXT NOT NULL,
			challenge_expires_at TEXT NOT NULL,
			state TEXT NOT NULL,
			failure_code TEXT,
			packet_hash TEXT,
			local_agent_ref TEXT,
			source_context_status BLOB,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(materializer_account_id, request_id),
			CHECK(state IN ('requested','acquiring','verifying','committing','committed','failed','aborted','expired')),
			CHECK((state = 'committed' AND local_agent_ref IS NOT NULL AND source_context_status IS NOT NULL AND failure_code IS NULL)
			   OR (state <> 'committed' AND local_agent_ref IS NULL AND source_context_status IS NULL))
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_realm_source_materialization_replay_v3 (
			runtime_instance_id TEXT NOT NULL,
			issuer TEXT NOT NULL,
			replay_binding_hash TEXT NOT NULL,
			nonce_digest TEXT NOT NULL,
			packet_hash TEXT NOT NULL,
			materializer_account_id TEXT NOT NULL,
			request_id TEXT NOT NULL,
			first_seen_at TEXT NOT NULL,
			expires_at TEXT NOT NULL,
			PRIMARY KEY(runtime_instance_id, issuer, replay_binding_hash),
			UNIQUE(runtime_instance_id, issuer, nonce_digest),
			UNIQUE(runtime_instance_id, issuer, packet_hash),
			FOREIGN KEY(materializer_account_id, request_id)
			  REFERENCES runtime_realm_source_materialization_attempt_v3(materializer_account_id, request_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_source_snapshot_v2 (
			local_agent_ref TEXT PRIMARY KEY,
			snapshot_schema_version INTEGER NOT NULL,
			snapshot_hash TEXT NOT NULL,
			captured_at TEXT NOT NULL,
			packet_id TEXT NOT NULL,
			packet_hash TEXT NOT NULL,
			realm_issuer TEXT NOT NULL,
			signing_key_fingerprint TEXT NOT NULL,
			source_kind TEXT NOT NULL,
			source_id TEXT NOT NULL,
			world_id TEXT NOT NULL,
			source_hash TEXT NOT NULL,
			world_content_hash TEXT NOT NULL,
			coverage_hash TEXT NOT NULL,
			materialization_context_hash TEXT NOT NULL,
			payload_hash TEXT NOT NULL,
			ordered_component_set_hash TEXT NOT NULL,
			closure_set_manifest_hash TEXT NOT NULL,
			normalization_version TEXT NOT NULL,
			compiler_compatibility_version TEXT NOT NULL,
			typed_snapshot_json BLOB NOT NULL,
			CHECK(snapshot_schema_version = 2),
			FOREIGN KEY(local_agent_ref) REFERENCES runtime_local_agent(local_agent_ref) DEFERRABLE INITIALLY DEFERRED
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_local_agent_source_provenance_v3 (
			provenance_key TEXT NOT NULL,
			local_agent_ref TEXT NOT NULL UNIQUE,
			snapshot_hash TEXT NOT NULL,
			materialization_context_hash TEXT NOT NULL,
			PRIMARY KEY(provenance_key, local_agent_ref),
			FOREIGN KEY(local_agent_ref) REFERENCES runtime_local_agent_source_snapshot_v2(local_agent_ref) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_config (
			account_namespace TEXT NOT NULL,
			owner_kind INTEGER NOT NULL,
			owner_id TEXT NOT NULL,
			config_blob BLOB NOT NULL,
			PRIMARY KEY(account_namespace, owner_kind, owner_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_ai_profile (
			account_namespace TEXT NOT NULL,
			profile_id TEXT NOT NULL,
			title TEXT NOT NULL,
			profile_json BLOB NOT NULL,
			imported_at TEXT NOT NULL,
			updated_at TEXT NOT NULL,
			PRIMARY KEY(account_namespace, profile_id)
		)`,
		`CREATE TABLE IF NOT EXISTS runtime_agent_presentation_asset (
			asset_ref TEXT PRIMARY KEY,
			local_agent_ref TEXT NOT NULL,
			asset_role INTEGER NOT NULL,
			backend_kind INTEGER NOT NULL,
			file_name TEXT NOT NULL,
			media_type TEXT NOT NULL,
			sha256 TEXT NOT NULL,
			byte_length INTEGER NOT NULL,
			content BLOB NOT NULL,
			created_at TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_runtime_agent_presentation_asset_agent ON runtime_agent_presentation_asset(local_agent_ref)`,
	}
	for _, stmt := range stmts {
		if _, err := b.writeDB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure sqlite schema: %w", err)
		}
	}
	immutableStmts := []string{
		`CREATE TRIGGER IF NOT EXISTS runtime_local_agent_source_snapshot_v2_no_update
		BEFORE UPDATE ON runtime_local_agent_source_snapshot_v2
		BEGIN SELECT RAISE(ABORT, 'source snapshot v2 is immutable'); END`,
		`CREATE TRIGGER IF NOT EXISTS runtime_local_agent_source_provenance_v3_no_update
		BEFORE UPDATE ON runtime_local_agent_source_provenance_v3
		BEGIN SELECT RAISE(ABORT, 'source provenance v3 is immutable'); END`,
	}
	for _, stmt := range immutableStmts {
		if _, err := b.writeDB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure immutable source snapshot schema: %w", err)
		}
	}
	if _, err := b.writeDB.Exec(`INSERT INTO memory_meta(key, value) VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING`); err != nil {
		return err
	}
	if _, err := b.writeDB.Exec(`INSERT INTO runtime_local_agent_meta(key, value) VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING`); err != nil {
		return err
	}
	return b.initializeRealmSourceMaterializationEpochV3()
}

func (b *Backend) requireRealmSourceMaterializationCompatibility() error {
	var metaTableCount int
	if err := b.writeDB.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table' AND name = 'runtime_local_agent_meta'`).Scan(&metaTableCount); err != nil {
		return fmt.Errorf("inspect Realm source materialization metadata table: %w", err)
	}

	retiredObjects, err := countRetiredRealmSourceMaterializationObjects(b.writeDB)
	if err != nil {
		return err
	}
	runtimeSourceRefs, err := collectRealmSourceMaterializationRuntimeAgentRefs(b.writeDB)
	if err != nil {
		return err
	}
	staleSnapshotRefs, err := collectPreV3RealmSourceSnapshotRefs(b.writeDB)
	if err != nil {
		return err
	}
	legacyAgentCount := len(runtimeSourceRefs.legacy)
	staleSnapshotCount := len(staleSnapshotRefs)
	if metaTableCount == 0 {
		if retiredObjects > 0 || legacyAgentCount > 0 || staleSnapshotCount > 0 {
			return fmt.Errorf("%w: retired_objects=%d legacy_agents=%d stale_snapshots=%d epoch=missing", ErrIncompatibleRealmSourceMaterializationData, retiredObjects, legacyAgentCount, staleSnapshotCount)
		}
		if len(runtimeSourceRefs.currentV3) > 0 {
			return fmt.Errorf("Realm source materialization v3 agents exist without contract epoch")
		}
		return nil
	}

	var epoch string
	err = b.writeDB.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		if retiredObjects > 0 || legacyAgentCount > 0 || staleSnapshotCount > 0 {
			return fmt.Errorf("%w: retired_objects=%d legacy_agents=%d stale_snapshots=%d epoch=missing", ErrIncompatibleRealmSourceMaterializationData, retiredObjects, legacyAgentCount, staleSnapshotCount)
		}
		if len(runtimeSourceRefs.currentV3) > 0 {
			return fmt.Errorf("Realm source materialization v3 agents exist without contract epoch")
		}
		return nil
	case err != nil:
		return fmt.Errorf("read Realm source materialization epoch: %w", err)
	case epoch == "v1" || epoch == "v2":
		return fmt.Errorf("%w: retired_objects=%d legacy_agents=%d stale_snapshots=%d epoch=%s", ErrIncompatibleRealmSourceMaterializationData, retiredObjects, legacyAgentCount, staleSnapshotCount, epoch)
	case epoch != realmSourceMaterializationEpochV3:
		return fmt.Errorf("unsupported Realm source materialization epoch %q", epoch)
	case retiredObjects > 0 || legacyAgentCount > 0 || staleSnapshotCount > 0:
		return fmt.Errorf("%w: retired_objects=%d legacy_agents=%d stale_snapshots=%d epoch=%s", ErrIncompatibleRealmSourceMaterializationData, retiredObjects, legacyAgentCount, staleSnapshotCount, epoch)
	default:
		return nil
	}
}

func countRetiredRealmSourceMaterializationObjects(db *sql.DB) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("inspect retired Realm source materialization objects: database is required")
	}
	count := 0
	for _, name := range append(retiredRealmSourceMaterializationTriggers(), retiredRealmSourceMaterializationTables()...) {
		var objectCount int
		if err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_schema WHERE name = ?`, name).Scan(&objectCount); err != nil {
			return 0, fmt.Errorf("inspect retired Realm source materialization object %s: %w", name, err)
		}
		count += objectCount
	}
	return count, nil
}

func (b *Backend) initializeRealmSourceMaterializationEpochV3() error {
	err := b.executeWrite(context.Background(), func(tx *sql.Tx) error {
		var epoch string
		err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch)
		switch {
		case errors.Is(err, sql.ErrNoRows):
		case err != nil:
			return fmt.Errorf("read Realm source materialization epoch: %w", err)
		case epoch == "v1" || epoch == "v2":
			return fmt.Errorf("%w: epoch=%s", ErrIncompatibleRealmSourceMaterializationData, epoch)
		case epoch != realmSourceMaterializationEpochV3:
			return fmt.Errorf("unsupported Realm source materialization epoch %q", epoch)
		}

		if _, err := tx.Exec(`
			INSERT INTO runtime_local_agent_meta(key, value) VALUES (?, ?)
			ON CONFLICT(key) DO NOTHING
		`, realmSourceMaterializationEpochMetaKey, realmSourceMaterializationEpochV3); err != nil {
			return fmt.Errorf("persist Realm source materialization epoch: %w", err)
		}
		return verifyRealmSourceMaterializationEpochV3(tx)
	})
	if err != nil {
		return fmt.Errorf("initialize Realm source materialization v3 epoch: %w", err)
	}
	return nil
}

func verifyRealmSourceMaterializationEpochV3(tx *sql.Tx) error {
	var epoch string
	if err := tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key = ?`, realmSourceMaterializationEpochMetaKey).Scan(&epoch); err != nil {
		return fmt.Errorf("verify Realm source materialization epoch: %w", err)
	}
	if epoch != realmSourceMaterializationEpochV3 {
		return fmt.Errorf("verify Realm source materialization epoch: got %q, want %q", epoch, realmSourceMaterializationEpochV3)
	}

	for _, object := range currentRealmSourceMaterializationObjects() {
		var kind string
		err := tx.QueryRow(`SELECT type FROM sqlite_schema WHERE name = ?`, object.name).Scan(&kind)
		if errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("current Realm source materialization %s %s is absent", object.kind, object.name)
		}
		if err != nil {
			return fmt.Errorf("verify current Realm source materialization object %s: %w", object.name, err)
		}
		if kind != object.kind {
			return fmt.Errorf("current Realm source materialization object %s has type %q, want %q", object.name, kind, object.kind)
		}
	}

	retiredObjects := append(retiredRealmSourceMaterializationTriggers(), retiredRealmSourceMaterializationTables()...)
	for _, name := range retiredObjects {
		var kind string
		err := tx.QueryRow(`SELECT type FROM sqlite_schema WHERE name = ?`, name).Scan(&kind)
		if errors.Is(err, sql.ErrNoRows) {
			continue
		}
		if err != nil {
			return fmt.Errorf("verify retired Realm source materialization object %s: %w", name, err)
		}
		return fmt.Errorf("retired Realm source materialization %s %s is incompatible with the current schema", kind, name)
	}
	return nil
}
