package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
)

// RewriteRecoverySnapshots lets a content owner apply its exact disposition to
// every backend-owned backup. Serialization excludes concurrent BackupNow; a
// failed or unreadable snapshot must not be reported as successfully disposed.
func (b *Backend) RewriteRecoverySnapshots(ctx context.Context, apply func(*sql.Tx) error) error {
	if apply == nil {
		return fmt.Errorf("recovery disposition is missing")
	}
	return b.runSerialized(ctx, func(ctx context.Context) error {
		candidates, err := listBackupCandidates(b.backupDir)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		if err != nil {
			return err
		}
		for _, candidate := range candidates {
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
				if err := apply(tx); err != nil {
					return err
				}
				if err := tx.Commit(); err != nil {
					return err
				}
				_, err = db.ExecContext(ctx, `PRAGMA wal_checkpoint(TRUNCATE)`)
				return err
			}()
			if err != nil {
				return fmt.Errorf("dispose backend recovery snapshot: %w", err)
			}
		}
		return nil
	})
}
