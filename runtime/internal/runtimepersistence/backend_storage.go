package runtimepersistence

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

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

func sqliteFileDSN(path, query string) (string, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	return SQLiteFileURI(absolute, query), nil
}

// SQLiteFileURI encodes an absolute database path and a pre-encoded query.
func SQLiteFileURI(absolutePath, rawQuery string) string {
	uriPath := filepath.ToSlash(absolutePath)
	if !strings.HasPrefix(uriPath, "/") {
		// A Windows drive letter belongs in the URI path.
		uriPath = "/" + uriPath
	}
	return (&url.URL{Scheme: "file", Path: uriPath, RawQuery: rawQuery}).String()
}

func openSQLite(path string, writeConn bool, verify bool) (*sql.DB, error) {
	dsn, err := sqliteFileDSN(path, fmt.Sprintf("_pragma=journal_mode(WAL)&_pragma=foreign_keys(ON)&_pragma=busy_timeout(%d)&_pragma=synchronous(FULL)&_pragma=wal_autocheckpoint(%d)", defaultBusyTimeoutMS, defaultWALCheckpoint))
	if err != nil {
		return nil, err
	}
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

func restoreLatestHealthyBackup(targetPath string, backupDir string, validate []func(*sql.DB, bool) error) error {
	candidates, err := listBackupCandidates(backupDir)
	if err != nil {
		return err
	}
	stage, err := os.MkdirTemp(filepath.Dir(targetPath), ".sqlite-recovery-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	var lastErr error
	for i, candidate := range candidates {
		prepared := filepath.Join(stage, fmt.Sprintf("candidate-%d.db", i))
		if err := prepareRecoverySnapshot(candidate.path, prepared, validate); err != nil {
			lastErr = err
			continue
		}
		return installRecoverySnapshot(prepared, targetPath)
	}
	if lastErr != nil {
		return lastErr
	}
	return fmt.Errorf("no healthy sqlite backups available")
}

func prepareRecoverySnapshot(source, prepared string, validate []func(*sql.DB, bool) error) error {
	if err := copyFile(source, prepared); err != nil {
		return err
	}
	if _, err := os.Stat(source + "-wal"); err == nil {
		if err := copyFile(source+"-wal", prepared+"-wal"); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	// SQLite rebuilds its own shm on the isolated copy. Fold any committed WAL
	// into these exact bytes before physical and read-only format checks.
	db, err := openSQLite(prepared, true, true)
	if err != nil {
		return err
	}
	defer db.Close()
	var busy, pages, done int
	if err := db.QueryRow("PRAGMA wal_checkpoint(TRUNCATE)").Scan(&busy, &pages, &done); err != nil {
		return err
	}
	if busy != 0 || pages != done {
		return fmt.Errorf("checkpoint of recovery snapshot incomplete")
	}
	if _, err := db.Exec("PRAGMA query_only=ON"); err != nil {
		return err
	}
	if ok, err := quickCheck(db); err != nil || !ok {
		return errors.Join(err, fmt.Errorf("backup %s failed quick_check", filepath.Base(source)))
	}
	if err := (&Backend{writeDB: db}).requireRealmSourceMaterializationCompatibility(); err != nil {
		return err
	}
	if err := validateMemoryExecutionStorage(db); err != nil {
		return err
	}
	for _, check := range validate {
		if err := check(db, true); err != nil {
			return err
		}
	}
	return db.Close()
}

func installRecoverySnapshot(prepared, target string) error {
	// Keep the original main file in place until the one replacement rename.
	// If the handoff fails, put its side files back before reporting failure.
	var moved []string
	restore := func(cause error) error {
		for i := len(moved) - 1; i >= 0; i-- {
			suffix := moved[i]
			cause = errors.Join(cause, os.Rename(prepared+".old"+suffix, target+suffix))
		}
		return cause
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		err := os.Rename(target+suffix, prepared+".old"+suffix)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return restore(err)
		}
		moved = append(moved, suffix)
	}
	if err := os.Rename(prepared, target); err != nil {
		return restore(err)
	}
	return nil
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

func copyFile(src string, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer func() { _ = in.Close() }()
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
