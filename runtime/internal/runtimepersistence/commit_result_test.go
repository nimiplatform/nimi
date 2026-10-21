package runtimepersistence

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"path/filepath"
	"testing"

	"modernc.org/sqlite"
)

type commitResultDriver struct {
	base        driver.Driver
	afterCommit func()
}

func (d *commitResultDriver) Open(name string) (driver.Conn, error) {
	conn, err := d.base.Open(name)
	return &commitResultConn{Conn: conn, afterCommit: d.afterCommit}, err
}

type commitResultConn struct {
	driver.Conn
	afterCommit func()
}

func (c *commitResultConn) Begin() (driver.Tx, error) {
	tx, err := c.Conn.Begin()
	return &commitResultTx{Tx: tx, afterCommit: c.afterCommit}, err
}

type commitResultTx struct {
	driver.Tx
	afterCommit func()
}

func (t *commitResultTx) Commit() error {
	err := t.Tx.Commit()
	if err == nil && t.afterCommit != nil {
		t.afterCommit()
	}
	return err
}

func TestWriteTxReturnsActualCommitOutcomeAfterCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sql.Register("commit_result_driver", &commitResultDriver{base: &sqlite.Driver{}, afterCommit: cancel})
	db, err := sql.Open("commit_result_driver", filepath.Join(t.TempDir(), "memory.db"))
	if err != nil {
		t.Fatal(err)
	}
	backend := &Backend{writeDB: db, writeCh: make(chan writeRequest), writeDone: make(chan struct{})}
	go backend.runWriteLoop()
	defer func() { _ = backend.Close() }()
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.Exec(`CREATE TABLE commit_result_proof(id INTEGER PRIMARY KEY)`)
		return err
	}); err != nil {
		t.Fatalf("committed transaction reported an error: %v", err)
	}
	var count int
	if err := backend.writeDB.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='commit_result_proof'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("successful commit was not visible after caller cancellation: count=%d err=%v", count, err)
	}
	t.Log("commit remains successful when cancellation arrives before the caller receives its result")
}
