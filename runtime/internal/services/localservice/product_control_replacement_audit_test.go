package localservice

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"google.golang.org/protobuf/encoding/protojson"
)

// replacementAuditBackend fails the audit transaction either before it runs
// (so the owner effect never starts) or at its final commit (after the owner
// effect already committed).
type replacementAuditBackend struct {
	*runtimepersistence.Backend
	failBefore bool
	failCommit bool
}

func (backend *replacementAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if backend.failBefore {
		return errors.New("simulated audit write failure")
	}
	return backend.Backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if err := fn(tx); err != nil {
			return err
		}
		if backend.failCommit {
			return errors.New("simulated audit commit failure")
		}
		return nil
	})
}

func replacementAuditRecords(t *testing.T, store *auditlog.Store) []*runtimev1.AuditEventRecord {
	t.Helper()
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: productControlAuditDomain, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	return response.GetEvents()
}

func TestDataRootReplacementRecordsOneResultAroundActivation(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	persistence, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = persistence.Close() })
	backend := &replacementAuditBackend{Backend: persistence}
	store, err := auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	service.auditStore = store
	current := filepath.Join(home, "audit-current-root")
	ready := readyProductControlForReplacementTest(t, service, current)
	target := filepath.Join(home, "audit-target-root")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}

	// An unrecordable replacement is never activated.
	backend.failBefore = true
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	if _, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target}); err == nil || !errors.Is(err, auditlog.ErrUnrecorded) {
		t.Fatalf("unrecordable replacement = %v", err)
	}
	backend.failBefore = false
	queriedResponse, queriedErr := service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	queried := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, queriedResponse, queriedErr))
	if queried.Record.DataRoot.Path != current || queried.Record.DataRoot.RootActivationID != ready.Record.DataRoot.RootActivationID || handoff.aborted != 1 || handoff.committed != 0 {
		t.Fatalf("unrecordable replacement changed activation: %+v handoff=%+v", queried.Record.DataRoot, handoff)
	}
	if records := replacementAuditRecords(t, store); len(records) != 0 {
		t.Fatalf("unrecordable replacement left records: %v", records)
	}

	// The overlap refusal is recorded once, with its disposition.
	if _, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: filepath.Join(current, "nested")}); err != nil {
		t.Fatal(err)
	}
	records := replacementAuditRecords(t, store)
	if len(records) != 1 || records[0].GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED ||
		records[0].GetPayload().GetFields()["disposition"].GetStringValue() != productControlActivationOverlappingReason {
		t.Fatalf("overlap records = %v", records)
	}

	service.SetProductControlRootHandoff(&productControlRootHandoffForTest{})
	response, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target})
	replaced := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if replaced.Activation == nil || !replaced.Activation.Activated {
		t.Fatalf("replacement = %+v", replaced)
	}
	records = replacementAuditRecords(t, store)
	successes := 0
	for _, record := range records {
		if record.GetReasonCode() != runtimev1.ReasonCode_ACTION_EXECUTED {
			continue
		}
		successes++
		fields := record.GetPayload().GetFields()
		if fields["root_activation_id"].GetStringValue() != replaced.Record.DataRoot.RootActivationID ||
			fields["previous_root_activation_id"].GetStringValue() != ready.Record.DataRoot.RootActivationID {
			t.Fatalf("replacement record = %v", record)
		}
		encoded, _ := protojson.Marshal(record)
		if strings.Contains(string(encoded), target) || strings.Contains(string(encoded), current) {
			t.Fatalf("replacement record carries a filesystem path: %s", encoded)
		}
	}
	if successes != 1 || len(records) != 2 {
		t.Fatalf("replacement records = %v", records)
	}
}

func TestDataRootReplacementCommittedWithoutRecordIsReportedTruthfully(t *testing.T) {
	home := setProductControlHomeForTest(t)
	service := newTestService(t)
	persistence, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = persistence.Close() })
	backend := &replacementAuditBackend{Backend: persistence}
	store, err := auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	service.auditStore = store
	current := filepath.Join(home, "unrecorded-current-root")
	readyProductControlForReplacementTest(t, service, current)
	handoff := &productControlRootHandoffForTest{}
	service.SetProductControlRootHandoff(handoff)
	target := filepath.Join(home, "unrecorded-target-root")
	if err := os.MkdirAll(target, 0o755); err != nil {
		t.Fatal(err)
	}

	backend.failCommit = true
	response, err := service.ReplaceProductControlDataRoot(context.Background(), &runtimev1.ReplaceProductControlDataRootRequest{TargetRoot: target})
	backend.failCommit = false
	replaced := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, response, err))
	if replaced.Activation == nil || !replaced.Activation.Activated || replaced.Record.DataRoot.Path != target || handoff.committed != 1 {
		t.Fatalf("committed activation was not reported truthfully: %+v handoff=%+v", replaced, handoff)
	}
	if replaced.AuditDiagnostic == nil || replaced.AuditDiagnostic.ReasonCode != "AUDIT_RESULT_UNRECORDED" {
		t.Fatalf("committed activation lost audit diagnostic: %+v", replaced)
	}
	queriedResponse, queriedErr := service.GetProductControlRecord(context.Background(), &runtimev1.GetProductControlRecordRequest{})
	queried := decodeProductControlProjectionForTest(t, mustProductControlForTest(t, queriedResponse, queriedErr))
	if queried.Record.DataRoot.Path != target {
		t.Fatalf("durable activation = %+v", queried.Record.DataRoot)
	}
	for _, record := range replacementAuditRecords(t, store) {
		if record.GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED {
			t.Fatalf("unrecorded activation produced a success record: %v", record)
		}
	}
}

func TestMaintenanceReplacementReportsCommittedUnrecordedResult(t *testing.T) {
	fixture := newProductControlMaintenanceFixtureForTest(t)
	persistence, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer persistence.Close()
	backend := &replacementAuditBackend{Backend: persistence}
	store, err := auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	fixture.maintenance = fixture.newMaintenance(t, store)
	backend.failCommit = true
	projection := fixture.replace(t, filepath.Join(t.TempDir(), "new-root"))
	backend.failCommit = false
	if projection.Activation == nil || !projection.Activation.Activated || projection.AuditDiagnostic == nil || projection.AuditDiagnostic.ReasonCode != "AUDIT_RESULT_UNRECORDED" {
		t.Fatalf("committed result must retain activation and diagnostic: %+v", projection)
	}
	if records := replacementAuditRecords(t, store); len(records) != 0 {
		t.Fatalf("expected rolled-back audit; got %d", len(records))
	}
}
