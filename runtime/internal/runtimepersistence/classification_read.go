package runtimepersistence

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
)

// OpenReadOnlyForClassification opens the Runtime database under
// localStatePath only for an owner's read-only startup classification
// (service-operations r092). It never creates the database, directories,
// schema, or backups and reports exists=false when no database file is
// present. SQLite may still use its own WAL coordination files.
func OpenReadOnlyForClassification(localStatePath string) (*sql.DB, bool, error) {
	path, err := databasePath(localStatePath)
	if err != nil {
		return nil, false, err
	}
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("inspect Runtime database: %w", err)
	}
	if !info.Mode().IsRegular() {
		return nil, true, fmt.Errorf("Runtime database is not a regular file")
	}
	dsn := fmt.Sprintf("file:%s?mode=ro&_pragma=busy_timeout(%d)&_pragma=query_only(true)", path, defaultBusyTimeoutMS)
	db, err := sql.Open(dbDriverName, dsn)
	if err != nil {
		return nil, true, fmt.Errorf("open Runtime database read-only: %w", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, true, fmt.Errorf("open Runtime database read-only: %w", err)
	}
	return db, true, nil
}
