package aiprofile

import (
	"context"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

func TestSQLiteStoreListIsolatesMalformedStoredSibling(t *testing.T) {
	backend, err := runtimepersistence.Open(slog.Default(), filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if _, err := store.Import(ctx, "account-a", &runtimev1.PortableAIProfileRecord{
		ProfileId: "healthy", Title: "Healthy", ProfileJson: []byte(`{"profileId":"healthy"}`),
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := backend.DB().ExecContext(ctx, `
		INSERT INTO runtime_ai_profile(account_namespace, profile_id, title, profile_json, imported_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?)
	`, "account-a", "malformed", "Malformed", []byte(`{"profileId":"malformed"}`), "not-a-timestamp", "not-a-timestamp"); err != nil {
		t.Fatal(err)
	}
	rows, err := store.List(ctx, "account-a")
	if err != nil {
		t.Fatal(err)
	}
	if len(rows) != 1 || rows[0].GetProfileId() != "healthy" {
		t.Fatalf("isolated rows = %+v", rows)
	}
}

func TestSQLiteStoreImportsAndReplacesOneAccountProfile(t *testing.T) {
	backend, err := runtimepersistence.Open(slog.Default(), filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatalf("open backend: %v", err)
	}
	t.Cleanup(func() { _ = backend.Close() })
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	ctx := context.Background()
	first, err := store.Import(ctx, "account-a", &runtimev1.PortableAIProfileRecord{
		ProfileId: "profile-a", Title: "First", ProfileJson: []byte(`{"profileId":"profile-a"}`),
	})
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	second, err := store.Import(ctx, "account-a", &runtimev1.PortableAIProfileRecord{
		ProfileId: "profile-a", Title: "Second", ProfileJson: []byte(`{"profileId":"profile-a","title":"Second"}`),
	})
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if first.GetImportedAt().AsTime() != second.GetImportedAt().AsTime() || second.GetUpdatedAt().AsTime().Before(first.GetUpdatedAt().AsTime()) {
		t.Fatalf("timestamps first=%v second=%v", first, second)
	}
	rows, err := store.List(ctx, "account-a")
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(rows) != 1 || rows[0].GetTitle() != "Second" {
		t.Fatalf("rows = %+v", rows)
	}
	other, err := store.List(ctx, "account-b")
	if err != nil || len(other) != 0 {
		t.Fatalf("other account rows=%+v err=%v", other, err)
	}
}
