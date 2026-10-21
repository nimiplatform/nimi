package memoryv1

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"path/filepath"
	"testing"
	"time"

	"modernc.org/sqlite"
)

// Hold the real SQLite rollback after database/sql has marked the transaction
// done. A caller's deferred Rollback can then return before the lock is released.
type closeRollbackConnector struct {
	path    string
	started chan struct{}
	release chan struct{}
}

func (c *closeRollbackConnector) Connect(context.Context) (driver.Conn, error) {
	conn, err := c.Driver().Open(c.path)
	if err != nil {
		return nil, err
	}
	return &closeRollbackConn{Conn: conn, control: c}, nil
}

func (*closeRollbackConnector) Driver() driver.Driver { return &sqlite.Driver{} }

type closeRollbackConn struct {
	driver.Conn
	control *closeRollbackConnector
}

func (c *closeRollbackConn) BeginTx(ctx context.Context, options driver.TxOptions) (driver.Tx, error) {
	tx, err := c.Conn.(driver.ConnBeginTx).BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &closeRollbackTx{Tx: tx, control: c.control}, nil
}

type closeRollbackTx struct {
	driver.Tx
	control *closeRollbackConnector
}

func (tx *closeRollbackTx) Rollback() error {
	close(tx.control.started)
	<-tx.control.release
	return tx.Tx.Rollback()
}

func TestCoreCloseWaitsForCancelledTransactionRollback(t *testing.T) {
	control := &closeRollbackConnector{
		path:    filepath.Join(t.TempDir(), "close.sqlite3"),
		started: make(chan struct{}), release: make(chan struct{}),
	}
	db := sql.OpenDB(control)
	db.SetMaxOpenConns(1)
	core := &Core{db: db}
	defer func() { _ = db.Close() }()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("CREATE TABLE pending_write (value TEXT)"); err != nil {
		t.Fatal(err)
	}
	cancel()
	<-control.started
	if err := tx.Rollback(); err != sql.ErrTxDone {
		t.Fatalf("expected asynchronous rollback to own the transaction, got %v", err)
	}
	closed := make(chan error, 1)
	go func() { closed <- core.Close() }()
	select {
	case err := <-closed:
		close(control.release)
		t.Fatalf("Close returned before SQLite rollback finished: %v", err)
	case <-time.After(25 * time.Millisecond):
	}
	close(control.release)
	select {
	case err := <-closed:
		if err != nil {
			t.Fatal(err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("Close did not finish after rollback")
	}
	if got := db.Stats().OpenConnections; got != 0 {
		t.Fatalf("Close retained %d connections", got)
	}
	if err := core.Close(); err != nil {
		t.Fatalf("repeated Close: %v", err)
	}
}
