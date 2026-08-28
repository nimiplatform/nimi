package storage

import (
	"database/sql"
)

const dirPerm = 0o700

// SQLiteBackend is the private durable store used by the bounded Agent Source
// owner. No generic repository or legacy artifact methods are exposed.
type SQLiteBackend struct {
	db *sql.DB
}

func (b *SQLiteBackend) Close() error {
	if b == nil || b.db == nil {
		return nil
	}
	return b.db.Close()
}

func rollback(tx *sql.Tx) {
	if tx != nil {
		_ = tx.Rollback()
	}
}
