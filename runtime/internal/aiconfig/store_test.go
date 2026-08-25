package aiconfig

import (
	"context"
	"database/sql"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/proto"
)

func TestMemoryStoreIsolatesAccountsAppsAndClones(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	input := &runtimev1.AIConfig{
		Owner:        appOwner("app.a"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localIntent(t, "text.generate", []string{"input.image"}, nil)},
	}
	if _, revision, committed, err := store.Overwrite(ctx, "account-a", InitialRevision, input); err != nil || !committed || revision != "1" {
		t.Fatalf("Overwrite: %v", err)
	}
	input.Capabilities[0].CapabilityContract = "mutated.input"

	if _, revision, found, err := store.Get(ctx, "account-b", appOwner("app.a")); err != nil || found || revision != InitialRevision {
		t.Fatalf("cross-account Get = found %v, err %v", found, err)
	}
	if _, _, found, err := store.Get(ctx, "account-a", appOwner("app.b")); err != nil || found {
		t.Fatalf("cross-App Get = found %v, err %v", found, err)
	}
	got, revision, found, err := store.Get(ctx, "account-a", appOwner("app.a"))
	if err != nil || !found {
		t.Fatalf("Get = found %v, err %v", found, err)
	}
	if revision != "1" {
		t.Fatalf("revision = %q, want 1", revision)
	}
	if got.GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("stored config followed caller mutation: %v", got)
	}
	got.Capabilities[0].CapabilityContract = "mutated.output"
	again, _, found, err := store.Get(ctx, "account-a", appOwner("app.a"))
	if err != nil || !found {
		t.Fatalf("Get again = found %v, err %v", found, err)
	}
	if again.GetCapabilities()[0].GetCapabilityContract() != "text.generate" {
		t.Fatalf("stored config followed result mutation: %v", again)
	}
}

func TestMemoryStoreRuntimeLocalAgentSubsystemIsOneAccountScopedOwner(t *testing.T) {
	ctx := context.Background()
	store := NewMemoryStore()
	owner := &runtimev1.AIConfigOwner{
		Owner: &runtimev1.AIConfigOwner_RuntimeLocalAgentSubsystem{RuntimeLocalAgentSubsystem: &runtimev1.AIConfigRuntimeLocalAgentSubsystemOwner{}},
	}
	if _, _, committed, err := store.Overwrite(ctx, "account-a", InitialRevision, &runtimev1.AIConfig{Owner: owner}); err != nil || !committed {
		t.Fatalf("Overwrite shared LocalAgent: %v", err)
	}
	if _, _, found, err := store.Get(ctx, "account-a", owner); err != nil || !found {
		t.Fatalf("Get shared LocalAgent = found %v, err %v", found, err)
	}
	if _, _, found, err := store.Get(ctx, "account-b", owner); err != nil || found {
		t.Fatalf("shared LocalAgent crossed account namespace: found %v, err %v", found, err)
	}
}

func TestSQLiteStorePersistsAndCompletelyOverwrites(t *testing.T) {
	ctx := context.Background()
	localStatePath := t.TempDir() + "/local-state.json"
	backend, err := runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("runtimepersistence.Open: %v", err)
	}
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	first := &runtimev1.AIConfig{
		Owner: appOwner("app.persisted"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{
			localIntent(t, "text.generate", nil, nil),
			cloudIntent(t, "image.generate"),
		},
	}
	if _, revision, committed, err := store.Overwrite(ctx, "account-a", InitialRevision, first); err != nil || !committed || revision != "1" {
		t.Fatalf("Overwrite first: %v", err)
	}
	second := &runtimev1.AIConfig{
		Owner:        appOwner("app.persisted"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{localIntent(t, "audio.transcribe", nil, nil)},
	}
	if _, revision, committed, err := store.Overwrite(ctx, "account-a", "1", second); err != nil || !committed || revision != "2" {
		t.Fatalf("Overwrite second: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	backend, err = runtimepersistence.Open(nil, localStatePath)
	if err != nil {
		t.Fatalf("runtimepersistence.Open(restart): %v", err)
	}
	defer func() { _ = backend.Close() }()
	store, err = NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore(restart): %v", err)
	}
	got, revision, found, err := store.Get(ctx, "account-a", appOwner("app.persisted"))
	if err != nil || !found {
		t.Fatalf("Get after restart = found %v, err %v", found, err)
	}
	if len(got.GetCapabilities()) != 1 || got.GetCapabilities()[0].GetCapabilityContract() != "audio.transcribe" {
		t.Fatalf("overwrite retained old capability intent: %v", got)
	}
	if revision != "2" {
		t.Fatalf("revision after restart = %q, want 2", revision)
	}
}

func TestSQLiteStoreKeepsAccountAndOwnerInCompositePrimaryKey(t *testing.T) {
	ctx := context.Background()
	backend, err := runtimepersistence.Open(nil, t.TempDir()+"/local-state.json")
	if err != nil {
		t.Fatalf("runtimepersistence.Open: %v", err)
	}
	defer func() { _ = backend.Close() }()
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	for _, row := range []struct {
		account string
		owner   *runtimev1.AIConfigOwner
	}{
		{account: "account-a", owner: appOwner("app.a")},
		{account: "account-a", owner: appOwner("app.b")},
		{account: "account-b", owner: appOwner("app.a")},
	} {
		if _, _, committed, err := store.Overwrite(ctx, row.account, InitialRevision, &runtimev1.AIConfig{Owner: row.owner}); err != nil || !committed {
			t.Fatalf("Overwrite(%s,%v): %v", row.account, row.owner.GetOwner(), err)
		}
	}
	var count int
	if err := backend.DB().QueryRow(`SELECT COUNT(*) FROM runtime_ai_config`).Scan(&count); err != nil {
		t.Fatalf("count runtime_ai_config: %v", err)
	}
	if count != 3 {
		t.Fatalf("runtime_ai_config count = %d, want 3", count)
	}
}

func TestSQLiteStoreRejectsPersistedOwnerKeyMismatch(t *testing.T) {
	ctx := context.Background()
	backend, err := runtimepersistence.Open(nil, t.TempDir()+"/local-state.json")
	if err != nil {
		t.Fatalf("runtimepersistence.Open: %v", err)
	}
	defer func() { _ = backend.Close() }()
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(&runtimev1.AIConfig{Owner: appOwner("app.actual")})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_ai_config(account_namespace, owner_kind, owner_id, config_blob, revision)
			VALUES (?, ?, ?, ?, ?)
		`, "account-a", storeOwnerKindApp, "app.requested", raw, 1)
		return err
	}); err != nil {
		t.Fatalf("seed mismatched row: %v", err)
	}
	_, _, found, err := store.Get(ctx, "account-a", appOwner("app.requested"))
	if found || err == nil || !errors.Is(err, ErrInvalidPersistedConfig) || !strings.Contains(err.Error(), "does not match storage key") {
		t.Fatalf("Get mismatched row = found %v, err %v", found, err)
	}
}

func TestSQLiteStoreClassifiesRetiredLocalIntentFieldsAsInvalidPersistedConfig(t *testing.T) {
	ctx := context.Background()
	backend, err := runtimepersistence.Open(nil, t.TempDir()+"/local-state.json")
	if err != nil {
		t.Fatalf("runtimepersistence.Open: %v", err)
	}
	defer func() { _ = backend.Close() }()
	store, err := NewSQLiteStore(backend)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	config := &runtimev1.AIConfig{
		Owner: appOwner("app.retired"),
		Capabilities: []*runtimev1.AIConfigCapabilityIntent{{
			CapabilityContract: "text.generate",
			Route:              &runtimev1.AIConfigCapabilityIntent_Local{Local: &runtimev1.AIConfigLocalIntent{}},
		}},
	}
	config.GetCapabilities()[0].GetLocal().ProtoReflect().SetUnknown([]byte{0x0a, 0x01, 'x'})
	raw, err := proto.MarshalOptions{Deterministic: true}.Marshal(config)
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	if err := backend.WriteTx(ctx, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			INSERT INTO runtime_ai_config(account_namespace, owner_kind, owner_id, config_blob, revision)
			VALUES (?, ?, ?, ?, ?)
		`, "account-a", storeOwnerKindApp, "app.retired", raw, 1)
		return err
	}); err != nil {
		t.Fatalf("seed retired row: %v", err)
	}
	_, _, found, err := store.Get(ctx, "account-a", appOwner("app.retired"))
	if found || !errors.Is(err, ErrInvalidPersistedConfig) {
		t.Fatalf("Get retired row = found %v, err %v", found, err)
	}
}
