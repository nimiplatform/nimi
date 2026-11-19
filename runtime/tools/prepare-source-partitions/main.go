// Offline pre-release preparation. The source database is never opened for writing.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/services/runtimeagent"
	_ "modernc.org/sqlite"
)

func openFile(path, mode string) (*sql.DB, error) {
	if !filepath.IsAbs(path) {
		return nil, errors.New("absolute database path required")
	}
	i, err := os.Lstat(path)
	if err != nil {
		return nil, err
	}
	if !i.Mode().IsRegular() {
		return nil, errors.New("regular SQLite file required")
	}
	u := url.URL{Scheme: "file", Path: filepath.ToSlash(path)}
	q := u.Query()
	q.Set("mode", mode)
	u.RawQuery = q.Encode()
	db, err := sql.Open("sqlite", u.String())
	if err == nil {
		db.SetMaxOpenConns(1)
	}
	return db, err
}

func plan(ctx context.Context, db *sql.DB) (runtimeagent.OfflinePartitionPlan, error) {
	tx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return runtimeagent.OfflinePartitionPlan{}, err
	}
	defer tx.Rollback()
	return runtimeagent.ReviewSourcePartitions(ctx, tx, nil)
}

func prepare(ctx context.Context, src *sql.DB, path, expected string) error {
	if !filepath.IsAbs(path) || expected == "" {
		return errors.New("new absolute output path and expected input hash required")
	}
	if _, err := os.Lstat(path); !os.IsNotExist(err) {
		return errors.New("output must be new")
	}
	dir, err := os.MkdirTemp(filepath.Dir(path), ".prepare-partition-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(dir)
	stage := filepath.Join(dir, "memory.db")
	if _, err = src.ExecContext(ctx, "VACUUM INTO ?", stage); err != nil {
		return err
	}
	if err = os.Chmod(stage, 0600); err != nil {
		return err
	}
	db, err := openFile(stage, "rw")
	if err != nil {
		return err
	}
	defer db.Close()
	if _, err = db.ExecContext(ctx, "PRAGMA journal_mode=DELETE"); err != nil {
		return err
	}
	if _, err = db.ExecContext(ctx, "PRAGMA foreign_keys=ON"); err != nil {
		return err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	type edit struct {
		agent             string
		original, updated []byte
	}
	var edits []edit
	result, err := runtimeagent.ReviewSourcePartitions(ctx, tx, func(agent string, original, updated []byte) {
		edits = append(edits, edit{agent, original, updated})
	})
	if err != nil {
		return err
	}
	if result.InputHash != expected {
		return errors.New("staged copy drifted from reviewed input")
	}
	if len(edits) > 0 {
		const trigger = "runtime_local_agent_source_snapshot_v2_no_update"
		const expectedGuard = "CREATE TRIGGER runtime_local_agent_source_snapshot_v2_no_update BEFORE UPDATE ON runtime_local_agent_source_snapshot_v2 BEGIN SELECT RAISE(ABORT, 'source snapshot v2 is immutable'); END"
		var guard string
		if err := tx.QueryRowContext(ctx, `SELECT sql FROM sqlite_schema WHERE type='trigger' AND name=? AND tbl_name='runtime_local_agent_source_snapshot_v2'`, trigger).Scan(&guard); err != nil {
			return err
		}
		if strings.Join(strings.Fields(guard), " ") != expectedGuard {
			return errors.New("unrecognized immutable source trigger")
		}
		if _, err = tx.ExecContext(ctx, "DROP TRIGGER "+trigger); err != nil {
			return err
		}
		for _, v := range edits {
			q, err := tx.ExecContext(ctx, "UPDATE runtime_local_agent_source_snapshot_v2 SET typed_snapshot_json=? WHERE local_agent_ref=? AND typed_snapshot_json=?", v.updated, v.agent, v.original)
			if err != nil {
				return err
			}
			n, err := q.RowsAffected()
			if err != nil || n != 1 {
				return errors.New("reviewed staged row changed")
			}
		}
		if _, err = tx.ExecContext(ctx, guard); err != nil {
			return err
		}
	}
	verified, err := runtimeagent.ReviewSourcePartitions(ctx, tx, nil)
	if err != nil {
		return err
	}
	if len(verified.Changes) != 0 || verified.Checked != result.Checked {
		return errors.New("staged partition verification failed")
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	var integrity string
	if err = db.QueryRowContext(ctx, "PRAGMA integrity_check").Scan(&integrity); err != nil {
		return err
	}
	if integrity != "ok" {
		return errors.New("staged integrity check failed")
	}
	if err = db.Close(); err != nil {
		return err
	}
	return os.Link(stage, path)
}

func run(args []string, out io.Writer) error {
	fs := flag.NewFlagSet("prepare-source-partitions", flag.ContinueOnError)
	from := fs.String("db", "", "absolute source memory.db (read-only)")
	to := fs.String("output", "", "optional new full database file, never replaces the input")
	expected := fs.String("expected-input-hash", "", "reviewed read-only plan hash")
	stopped := fs.Bool("confirm-runtime-stopped", false, "require stopped Runtime when preparing the new copy")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	ctx := context.Background()
	db, err := openFile(*from, "ro")
	if err != nil {
		return err
	}
	defer db.Close()
	r, err := plan(ctx, db)
	if err != nil {
		return err
	}
	if *to != "" {
		if !*stopped || *expected != r.InputHash {
			return errors.New("stopped Runtime and matching plan hash required")
		}
		if err = prepare(ctx, db, *to, *expected); err != nil {
			return err
		}
	}
	return json.NewEncoder(out).Encode(struct {
		Plan         runtimeagent.OfflinePartitionPlan `json:"plan"`
		PreparedCopy string                            `json:"preparedCopy,omitempty"`
	}{r, *to})
}

func main() {
	if err := run(os.Args[1:], os.Stdout); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			return
		}
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
