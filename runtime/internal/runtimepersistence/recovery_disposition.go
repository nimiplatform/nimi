package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
)

type snapshotDisposition struct {
	info   os.FileInfo
	owners map[string]bool
}

// RewriteRecoverySnapshots lets a content owner apply its exact disposition to
// every backend-owned backup. Serialization excludes concurrent BackupNow; a
// failed or unreadable snapshot must not be reported as successfully disposed.
func (b *Backend) RewriteRecoverySnapshots(ctx context.Context, apply func(*sql.Tx) error) error {
	if apply == nil {
		return fmt.Errorf("recovery disposition is missing")
	}
	return b.rewriteSnapshots(ctx, "", func(tx *sql.Tx) (bool, bool, error) {
		return false, true, apply(tx)
	})
}

// DisposeRecoveryPayloads remembers a copy only when it holds no remaining
// payload for this owner. A later handoff can still settle pending payloads
// in the same backup. Restart always rechecks backup contents.
func (b *Backend) DisposeRecoveryPayloads(ctx context.Context, owner string, apply func(*sql.Tx) (clean, changed bool, err error)) error {
	if owner == "" || apply == nil {
		return fmt.Errorf("recovery disposition owner is missing")
	}
	liveDSN, err := sqliteFileDSN(b.Path(), "mode=ro")
	if err != nil {
		return err
	}
	return b.rewriteSnapshots(ctx, owner, func(tx *sql.Tx) (bool, bool, error) {
		// This connection belongs to one backup and closes after its disposition.
		if _, err := tx.ExecContext(ctx, `ATTACH DATABASE ? AS live`, liveDSN); err != nil {
			return false, false, err
		}
		return apply(tx)
	})
}

func (b *Backend) rewriteSnapshots(ctx context.Context, owner string, apply func(*sql.Tx) (bool, bool, error)) error {
	return b.runSerialized(ctx, func(ctx context.Context) error {
		candidates, err := listBackupCandidates(b.backupDir)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		if b.cleanSnapshots == nil {
			b.cleanSnapshots = make(map[string]snapshotDisposition)
		}
		for p := range b.cleanSnapshots {
			found := false
			for _, candidate := range candidates {
				if candidate.path == p {
					found = true
					break
				}
			}
			if !found {
				delete(b.cleanSnapshots, p)
			}
		}
		for _, candidate := range candidates {
			before, err := os.Stat(candidate.path)
			if err != nil {
				return err
			}
			previous := b.cleanSnapshots[candidate.path]
			_, walErr := os.Stat(candidate.path + "-wal")
			if previous.info == nil || !os.SameFile(before, previous.info) || before.ModTime() != previous.info.ModTime() || before.Size() != previous.info.Size() || !errors.Is(walErr, os.ErrNotExist) {
				previous = snapshotDisposition{}
				delete(b.cleanSnapshots, candidate.path)
			}
			if owner != "" && previous.owners[owner] {
				continue
			}
			var clean, changed bool
			db, err := openSQLite(candidate.path, true, true)
			if err != nil {
				return err
			}
			err = func() (resultErr error) {
				defer func() {
					if err := db.Close(); err != nil {
						resultErr = errors.Join(resultErr, fmt.Errorf("close recovery snapshot: %w", err))
					}
				}()
				tx, err := db.BeginTx(ctx, nil)
				if err != nil {
					return err
				}
				defer func() {
					if err := tx.Rollback(); err != nil && !errors.Is(err, sql.ErrTxDone) {
						resultErr = errors.Join(resultErr, fmt.Errorf("rollback recovery snapshot: %w", err))
					}
				}()
				clean, changed, err = apply(tx)
				if err != nil {
					return err
				}
				if err := tx.Commit(); err != nil {
					return err
				}
				if !changed {
					return nil
				}
				_, err = db.ExecContext(ctx, `PRAGMA main.wal_checkpoint(TRUNCATE)`)
				return err
			}()
			if err != nil {
				delete(b.cleanSnapshots, candidate.path)
				return fmt.Errorf("dispose backend recovery snapshot: %w", err)
			}
			if owner == "" || changed {
				delete(b.cleanSnapshots, candidate.path)
				previous = snapshotDisposition{}
			}
			if owner != "" && clean {
				after, err := os.Stat(candidate.path)
				if err != nil {
					return err
				}
				if !os.SameFile(before, after) {
					return fmt.Errorf("recovery snapshot replaced during disposition")
				}
				if previous.owners == nil {
					previous.owners = make(map[string]bool)
				}
				previous.info = after
				previous.owners[owner] = true
				b.cleanSnapshots[candidate.path] = previous
			}
		}
		return nil
	})
}
