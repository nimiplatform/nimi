package auditlog

import (
	"context"
	"database/sql"
	"fmt"
	"sync"

	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	_ "modernc.org/sqlite"
)

// ephemeralBackend is a private in-process database with the canonical audit
// schema. It gives New the same write, retention, and query path as the
// durable Runtime backend without writing anything to disk.
type ephemeralBackend struct {
	db *sql.DB
	mu sync.Mutex
}

func openEphemeralBackend() (*ephemeralBackend, error) {
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		return nil, fmt.Errorf("open in-process audit store: %w", err)
	}
	// One connection holds the whole in-memory database for the store's life.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	db.SetConnMaxIdleTime(0)
	for _, statement := range runtimepersistence.AuditStorageSchema() {
		if _, err := db.Exec(statement); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("initialize in-process audit store: %w", err)
		}
	}
	return &ephemeralBackend{db: db}, nil
}

func (backend *ephemeralBackend) DB() *sql.DB {
	return backend.db
}

func (backend *ephemeralBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if ctx == nil {
		ctx = context.Background()
	}
	backend.mu.Lock()
	defer backend.mu.Unlock()
	tx, err := backend.db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin in-process audit tx: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit in-process audit tx: %w", err)
	}
	return nil
}
