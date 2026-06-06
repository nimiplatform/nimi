package storage

import "testing"

type testCloseable interface {
	Close() error
}

func closeInTest(t *testing.T, closeable testCloseable) {
	t.Helper()
	if err := closeable.Close(); err != nil {
		t.Errorf("close: %v", err)
	}
}
