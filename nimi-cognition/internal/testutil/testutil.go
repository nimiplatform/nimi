// Package testutil provides shared test infrastructure for
// nimi-cognition packages. Fixtures and builders are added as
// artifact family types are implemented.
package testutil

import (
	"testing"

	"github.com/nimiplatform/nimi/nimi-cognition/internal/storage"
)

// NewTestBackend creates a temporary SQLite backend for testing.
func NewTestBackend(t *testing.T) *storage.SQLiteBackend {
	t.Helper()
	b, err := storage.NewSQLiteBackend(t.TempDir())
	if err != nil {
		t.Fatalf("new test backend: %v", err)
	}
	return b
}
