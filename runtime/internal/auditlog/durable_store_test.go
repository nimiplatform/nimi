package auditlog

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

func openDurableTestStore(t *testing.T, statePath string, maxEvents int) (*runtimepersistence.Backend, *Store) {
	t.Helper()
	backend, err := runtimepersistence.Open(nil, statePath)
	if err != nil {
		t.Fatalf("open Runtime persistence: %v", err)
	}
	store, err := Open(backend, nil, maxEvents, 16)
	if err != nil {
		_ = backend.Close()
		t.Fatalf("open audit store: %v", err)
	}
	return backend, store
}

func durableTestEvent(domain string, operation string, at time.Time) *runtimev1.AuditEventRecord {
	return &runtimev1.AuditEventRecord{
		AppId:      "nimi.desktop",
		Domain:     domain,
		Operation:  operation,
		ReasonCode: runtimev1.ReasonCode_ACTION_EXECUTED,
		Timestamp:  timestamppb.New(at),
		CallerKind: runtimev1.CallerKind_CALLER_KIND_DESKTOP_CORE,
	}
}

func listOperations(t *testing.T, store *Store, domain string) []string {
	t.Helper()
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: domain, PageSize: 200})
	if err != nil {
		t.Fatalf("ListEvents: %v", err)
	}
	operations := make([]string, 0, len(response.GetEvents()))
	for _, event := range response.GetEvents() {
		operations = append(operations, event.GetOperation())
	}
	return operations
}

func TestDurableAuditStoreKeepsRecordsAcrossRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 100)
	now := time.Now().UTC().Truncate(time.Millisecond)
	payload, err := structpb.NewStruct(map[string]any{"api_key": "sk-live-secret-value", "target_ref": "icon_1"})
	if err != nil {
		t.Fatal(err)
	}
	event := durableTestEvent("runtime.integration", "integration.connection.put", now)
	event.Payload = payload
	if err := store.AppendEventChecked(event); err != nil {
		t.Fatalf("AppendEventChecked: %v", err)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, restarted := openDurableTestStore(t, statePath, 100)
	t.Cleanup(func() { _ = reopened.Close() })
	response, err := restarted.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "runtime.integration", PageSize: 10})
	if err != nil {
		t.Fatalf("ListEvents after restart: %v", err)
	}
	if len(response.GetEvents()) != 1 {
		t.Fatalf("restart retained %d events, want 1", len(response.GetEvents()))
	}
	persisted := response.GetEvents()[0]
	if persisted.GetOperation() != "integration.connection.put" || !persisted.GetTimestamp().AsTime().Equal(now) || persisted.GetAuditId() == "" {
		t.Fatalf("persisted event = %+v", persisted)
	}
	if got := persisted.GetPayload().GetFields()["api_key"].GetStringValue(); got == "sk-live-secret-value" || strings.Contains(got, "secret") {
		t.Fatalf("persisted payload kept secret material: %q", got)
	}
	var raw []byte
	if err := reopened.DB().QueryRow(`SELECT record FROM runtime_audit_event`).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "sk-live-secret-value") {
		t.Fatal("durable audit row contains the unredacted secret")
	}
	desktop, err := restarted.ListDesktopEvents(&runtimev1.ListDesktopAuditEventsRequest{
		Domain:   "runtime.integration",
		FromTime: timestamppb.New(now.Add(-time.Minute)),
		ToTime:   timestamppb.New(now.Add(time.Minute)),
	})
	if err != nil || len(desktop.GetEvents()) != 1 || desktop.GetEvents()[0].GetAuditId() != persisted.GetAuditId() {
		t.Fatalf("desktop projection after restart = %+v err=%v", desktop, err)
	}
}

func TestDurableAuditStoreEvictsOldestBeyondCountBound(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 3)
	now := time.Now().UTC()
	for index := 0; index < 5; index++ {
		if err := store.AppendEventChecked(durableTestEvent("retention", "op-"+strconv.Itoa(index), now.Add(time.Duration(index)*time.Second))); err != nil {
			t.Fatal(err)
		}
	}
	if got := strings.Join(listOperations(t, store, "retention"), ","); got != "op-4,op-3,op-2" {
		t.Fatalf("retained operations = %s", got)
	}
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}

	// A lower bound after restart evicts the oldest retained records at Open.
	reopened, restarted := openDurableTestStore(t, statePath, 2)
	t.Cleanup(func() { _ = reopened.Close() })
	if got := strings.Join(listOperations(t, restarted, "retention"), ","); got != "op-4,op-3" {
		t.Fatalf("retained operations after tightened bound = %s", got)
	}
	var retained, actual int64
	if err := reopened.DB().QueryRow(`SELECT retained_bytes FROM runtime_audit_retention`).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if err := reopened.DB().QueryRow(`SELECT SUM(record_bytes) FROM runtime_audit_event`).Scan(&actual); err != nil {
		t.Fatal(err)
	}
	if retained != actual {
		t.Fatalf("retained byte accounting = %d, actual %d", retained, actual)
	}
}

func TestDurableAuditStoreEvictsOldestBeyondByteBound(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 100)
	t.Cleanup(func() { _ = backend.Close() })
	store.maxBytes = 3 * 1024
	now := time.Now().UTC()
	for index := 0; index < 6; index++ {
		payload, err := structpb.NewStruct(map[string]any{"detail": strings.Repeat("x", 900)})
		if err != nil {
			t.Fatal(err)
		}
		event := durableTestEvent("bytes", "op-"+strconv.Itoa(index), now.Add(time.Duration(index)*time.Second))
		event.Payload = payload
		if err := store.AppendEventChecked(event); err != nil {
			t.Fatal(err)
		}
	}
	operations := listOperations(t, store, "bytes")
	if len(operations) == 0 || len(operations) >= 6 || operations[0] != "op-5" {
		t.Fatalf("byte bound retained %v", operations)
	}
	var retained int64
	if err := backend.DB().QueryRow(`SELECT SUM(record_bytes) FROM runtime_audit_event`).Scan(&retained); err != nil {
		t.Fatal(err)
	}
	if retained > store.maxBytes {
		t.Fatalf("retained %d bytes, bound %d", retained, store.maxBytes)
	}
}

func TestAuditRecordSizeBoundReplacesOversizedPayloadWithDigest(t *testing.T) {
	store := New(10, 10)
	payload, err := structpb.NewStruct(map[string]any{"detail": strings.Repeat("y", MaxRecordBytes)})
	if err != nil {
		t.Fatal(err)
	}
	event := durableTestEvent("size", "oversized", time.Now().UTC())
	event.Payload = payload
	if err := store.AppendEventChecked(event); err != nil {
		t.Fatalf("AppendEventChecked: %v", err)
	}
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: "size"})
	if err != nil || len(response.GetEvents()) != 1 {
		t.Fatalf("ListEvents = %+v err=%v", response, err)
	}
	fields := response.GetEvents()[0].GetPayload().GetFields()
	if fields["payload_omitted"].GetStringValue() != "record_size_limit" || !strings.HasPrefix(fields["payload_sha256"].GetStringValue(), "sha256:") || fields["detail"] != nil {
		t.Fatalf("oversized payload was not bounded: %v", fields)
	}
}

func TestAppendEventTxCommitsWithOwnerTransactionOnly(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 100)
	t.Cleanup(func() { _ = backend.Close() })
	if !store.PersistsIn(backend) || New(1, 1).PersistsIn(backend) {
		t.Fatal("PersistsIn must identify exactly the durable backend")
	}
	ownerFailure := errors.New("owner commit refused")
	err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		if err := store.AppendEventTx(context.Background(), tx, durableTestEvent("tx", "rolled-back", time.Now().UTC())); err != nil {
			return err
		}
		return ownerFailure
	})
	if !errors.Is(err, ownerFailure) {
		t.Fatalf("owner transaction error = %v", err)
	}
	if err := backend.WriteTx(context.Background(), func(tx *sql.Tx) error {
		return store.AppendEventTx(context.Background(), tx, durableTestEvent("tx", "committed", time.Now().UTC()))
	}); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(listOperations(t, store, "tx"), ","); got != "committed" {
		t.Fatalf("transactional records = %s", got)
	}
}

func TestCommitRecordedOrdersRecordAroundExternalEffect(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-state.json")
	backend, store := openDurableTestStore(t, statePath, 100)

	effects := 0
	committed, err := store.CommitRecorded(durableTestEvent("bracket", "effect.ok", time.Now().UTC()), func() error {
		effects++
		return nil
	})
	if !committed || err != nil || effects != 1 {
		t.Fatalf("successful effect = committed:%v err:%v effects:%d", committed, err, effects)
	}
	effectFailure := errors.New("effect failed")
	committed, err = store.CommitRecorded(durableTestEvent("bracket", "effect.failed", time.Now().UTC()), func() error {
		effects++
		return effectFailure
	})
	if committed || !errors.Is(err, effectFailure) || errors.Is(err, ErrUnrecorded) || effects != 2 {
		t.Fatalf("failed effect = committed:%v err:%v effects:%d", committed, err, effects)
	}
	if got := strings.Join(listOperations(t, store, "bracket"), ","); got != "effect.ok" {
		t.Fatalf("recorded operations = %s", got)
	}

	// A record that cannot be written prevents the effect entirely.
	if err := backend.Close(); err != nil {
		t.Fatal(err)
	}
	committed, err = store.CommitRecorded(durableTestEvent("bracket", "effect.unrecorded", time.Now().UTC()), func() error {
		effects++
		return nil
	})
	if committed || !errors.Is(err, ErrUnrecorded) || effects != 2 {
		t.Fatalf("unrecordable effect = committed:%v err:%v effects:%d", committed, err, effects)
	}
	if err := store.AppendEventChecked(durableTestEvent("bracket", "closed", time.Now().UTC())); !errors.Is(err, ErrUnrecorded) {
		t.Fatalf("checked append on closed backend = %v", err)
	}
}
