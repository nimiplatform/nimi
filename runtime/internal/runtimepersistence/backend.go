package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
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
)

type Backend struct {
	logger    *slog.Logger
	path      string
	backupDir string

	readDB  *sql.DB
	writeDB *sql.DB

	writeCh   chan writeRequest
	closeOnce sync.Once
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
	}
	if err := backend.ensureHealthyOrRestore(); err != nil {
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
		close(b.writeCh)
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
	for req := range b.writeCh {
		req.res <- req.op(req.ctx)
		close(req.res)
	}
}

func (b *Backend) runSerialized(ctx context.Context, op func(context.Context) error) error {
	if op == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
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
		`CREATE TABLE IF NOT EXISTS agentcore_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
		`CREATE TABLE IF NOT EXISTS agentcore_agent (
			agent_id TEXT PRIMARY KEY,
			agent_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_state_projection (
			agent_id TEXT PRIMARY KEY,
			state_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_hook (
			agent_id TEXT NOT NULL,
			hook_id TEXT NOT NULL,
			status INTEGER NOT NULL,
			scheduled_for TEXT,
			hook_json TEXT NOT NULL,
			PRIMARY KEY (agent_id, hook_id)
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_event_log (
			sequence INTEGER PRIMARY KEY,
			agent_id TEXT NOT NULL,
			event_type INTEGER NOT NULL,
			timestamp TEXT,
			event_json TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_behavioral_posture (
			agent_id TEXT PRIMARY KEY,
			status_text TEXT NOT NULL,
			truth_basis_json TEXT NOT NULL,
			posture_json TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_review_run (
			review_run_id TEXT PRIMARY KEY,
			agent_id TEXT NOT NULL,
			bank_locator_key TEXT NOT NULL,
			checkpoint_basis TEXT,
			status TEXT NOT NULL,
			prepared_outcomes_json TEXT NOT NULL,
			failure_message TEXT,
			created_at TEXT NOT NULL,
			updated_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS agentcore_review_followup (
			bank_locator_key TEXT PRIMARY KEY,
			review_run_id TEXT NOT NULL,
			checkpoint_basis TEXT,
			completed_at TEXT NOT NULL
		)`,
	}
	for _, stmt := range stmts {
		if _, err := b.writeDB.Exec(stmt); err != nil {
			return fmt.Errorf("ensure sqlite schema: %w", err)
		}
	}
	if _, err := b.writeDB.Exec(`INSERT INTO memory_meta(key, value) VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING`); err != nil {
		return err
	}
	if _, err := b.writeDB.Exec(`INSERT INTO agentcore_meta(key, value) VALUES ('schema_version','1') ON CONFLICT(key) DO NOTHING`); err != nil {
		return err
	}
	return nil
}

func databasePath(localStatePath string) (string, error) {
	trimmed := strings.TrimSpace(localStatePath)
	if trimmed != "" {
		return filepath.Join(filepath.Dir(trimmed), dbFileName), nil
	}
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return "", fmt.Errorf("resolve sqlite db path: user home unavailable")
	}
	return filepath.Join(home, ".nimi", "runtime", dbFileName), nil
}

func openSQLite(path string, writeConn bool, verify bool) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(%d)&_pragma=synchronous(FULL)&_pragma=wal_autocheckpoint(%d)", path, defaultBusyTimeoutMS, defaultWALCheckpoint)
	if writeConn {
		dsn += "&_txlock=immediate"
	}
	db, err := sql.Open(dbDriverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	if writeConn {
		db.SetMaxOpenConns(1)
		db.SetMaxIdleConns(1)
	} else {
		db.SetMaxOpenConns(8)
		db.SetMaxIdleConns(8)
	}
	if verify {
		if err := db.Ping(); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("ping sqlite db: %w", err)
		}
	}
	return db, nil
}

func quickCheck(db *sql.DB) (bool, error) {
	if db == nil {
		return false, fmt.Errorf("sqlite db is nil")
	}
	var result string
	if err := db.QueryRow(integrityCheckPragma).Scan(&result); err != nil {
		return false, fmt.Errorf("quick_check query: %w", err)
	}
	return strings.EqualFold(strings.TrimSpace(result), "ok"), nil
}

func restoreLatestHealthyBackup(targetPath string, backupDir string) error {
	candidates, err := listBackupCandidates(backupDir)
	if err != nil {
		return err
	}
	if len(candidates) == 0 {
		return fmt.Errorf("no sqlite backups available")
	}
	var lastErr error
	for _, candidate := range candidates {
		if err := resetSQLiteTarget(targetPath); err != nil {
			return err
		}
		if err := copyFile(candidate.path, targetPath); err != nil {
			lastErr = err
			continue
		}
		db, err := openSQLite(targetPath, false, true)
		if err != nil {
			lastErr = err
			continue
		}
		ok, qcErr := quickCheck(db)
		_ = db.Close()
		if qcErr == nil && ok {
			return nil
		}
		lastErr = errors.Join(qcErr, fmt.Errorf("backup %s failed quick_check", candidate.path))
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("no healthy sqlite backups available")
	}
	return lastErr
}

func pruneBackups(backupDir string) error {
	items, err := listBackupCandidates(backupDir)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	for idx := maxBackupSnapshots; idx < len(items); idx++ {
		if err := os.Remove(items[idx].path); err != nil {
			return err
		}
	}
	return nil
}

type backupCandidate struct {
	path string
	mod  time.Time
}

func listBackupCandidates(backupDir string) ([]backupCandidate, error) {
	entries, err := os.ReadDir(backupDir)
	if err != nil {
		return nil, err
	}
	items := make([]backupCandidate, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".db") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		items = append(items, backupCandidate{
			path: filepath.Join(backupDir, entry.Name()),
			mod:  info.ModTime().UTC(),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		return items[i].mod.After(items[j].mod)
	})
	return items, nil
}

func resetSQLiteTarget(targetPath string) error {
	if err := os.RemoveAll(targetPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	_ = os.Remove(targetPath + "-wal")
	_ = os.Remove(targetPath + "-shm")
	return nil
}

func copyFile(src string, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer func() {
		_ = out.Close()
	}()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	if err := out.Sync(); err != nil {
		return err
	}
	return out.Close()
}
