package storage

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestRuntimeSourceReadDeadlineInterruptsConnectionWait(t *testing.T) {
	for _, operation := range []string{"inspect", "search", "exact"} {
		t.Run(operation, func(t *testing.T) {
			backend, err := NewRuntimeSourceBackend(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = backend.Close() }()
			backend.db.SetMaxOpenConns(1)
			conn, err := backend.db.Conn(context.Background())
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = conn.Close() }()
			ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
			defer cancel()
			done := make(chan error, 1)
			go func() {
				var err error
				switch operation {
				case "inspect":
					_, err = backend.InspectRuntimeSourceState(ctx, "scope")
				case "search":
					_, _, err = backend.SearchRuntimeSource(ctx, "scope", "snapshot", "embedding", "query", []float64{1}, 1)
				case "exact":
					_, _, err = backend.ReadRuntimeSourceReferences(ctx, "scope", "snapshot", "partition", nil)
				}
				done <- err
			}()
			select {
			case err := <-done:
				if !errors.Is(err, context.DeadlineExceeded) {
					t.Fatalf("read did not preserve the index deadline: %v", err)
				}
			case <-time.After(2 * time.Second):
				_ = conn.Close()
				<-done
				t.Fatal("read ignored deadline while waiting for SQLite")
			}
		})
	}
}
