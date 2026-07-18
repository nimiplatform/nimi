package runtimepersistence

import (
	"database/sql"
	"errors"
	"fmt"
	"io"
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
