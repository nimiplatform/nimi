package runtimepersistence

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestWriterReservationKeepsActualCommitAndExpiresContext(t *testing.T) {
	b, err := Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	entered, release := make(chan struct{}), make(chan struct{})
	finished, later := make(chan error, 1), make(chan error, 1)
	var expired context.Context
	go func() {
		finished <- b.WithSerializedWriter(context.Background(), func(ctx context.Context) error {
			expired = ctx
			close(entered)
			<-release
			return b.WriteTx(ctx, func(tx *sql.Tx) error {
				_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES ('fenced','committed')`)
				return err
			})
		})
	}()
	<-entered
	go func() {
		later <- b.WriteTx(context.Background(), func(tx *sql.Tx) error {
			var value string
			return tx.QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key='fenced'`).Scan(&value)
		})
	}()
	// Observe the real writer queue, rather than infer writer admission from
	// a goroutine being started. A later transaction must wait for SQL commit.
	deadline := time.After(3 * time.Second)
	for len(b.writeCh) != 1 {
		select {
		case <-deadline:
			t.Fatal("later writer not admitted")
		default:
		}
		time.Sleep(time.Millisecond)
	}
	close(release)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	if err := <-later; err != nil {
		t.Fatal("SQL commit escaped reservation", err)
	}
	if err := b.WriteTx(expired, func(*sql.Tx) error { t.Fatal("expired writer context reused"); return nil }); !errors.Is(err, sql.ErrConnDone) {
		t.Fatal(err)
	}
}

func TestWriterReservationCancellationWaitsForOwnerCallback(t *testing.T) {
	b, err := Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	ctx, cancel := context.WithCancel(context.Background())
	entered, release, returned := make(chan struct{}), make(chan struct{}), make(chan error, 1)
	go func() {
		returned <- b.WithSerializedWriter(ctx, func(context.Context) error { close(entered); <-release; return ctx.Err() })
	}()
	<-entered
	cancel()
	select {
	case <-returned:
		t.Fatal("owner returned while fenced work still running")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-returned; !errors.Is(err, context.Canceled) {
		t.Fatal(err)
	}
}
