package runtimepersistence

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

// InspectStoredDatabase classifies a stopped Runtime root without changing
// its files. Even a read-only SQLite connection may rebuild the shm index.
// For an uncheckpointed WAL, use private coordination files and the same
// committed main/WAL pair. Clean databases require no copy.
func InspectStoredDatabase(localStatePath string, inspect func(*sql.DB) error) error {
	source, err := databasePath(localStatePath)
	if err != nil {
		return err
	}
	info, err := os.Stat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("Runtime database is not a regular file")
	}
	path := source
	mode := "mode=ro&immutable=1"
	wal, err := os.Stat(source + "-wal")
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	if wal != nil && wal.Size() > 0 {
		dir, err := os.MkdirTemp("", "nimi-db-inspect-")
		if err != nil {
			return err
		}
		defer os.RemoveAll(dir)
		path = filepath.Join(dir, dbFileName)
		// Links keep large files off the copy path on the same filesystem.
		// Only the private shm is writable.
		for _, suffix := range []string{"", "-wal"} {
			if err := os.Link(source+suffix, path+suffix); err != nil {
				if err := copyFile(source+suffix, path+suffix); err != nil {
					return err
				}
			}
		}
		mode = "mode=ro"
	}
	dsn, err := sqliteFileDSN(path, mode+"&_pragma=query_only(true)")
	if err != nil {
		return err
	}
	db, err := sql.Open(dbDriverName, dsn)
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	return inspect(db)
}
