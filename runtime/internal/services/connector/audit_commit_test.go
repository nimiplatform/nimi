package connector

import (
	"context"
	"database/sql"
	"errors"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	"path/filepath"
	"testing"
)

type failingConnectorAuditBackend struct {
	*runtimepersistence.Backend
	before, after bool
}

func (b *failingConnectorAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
	if b.before {
		return errors.New("audit unavailable")
	}
	return b.Backend.WriteTx(ctx, func(tx *sql.Tx) error {
		if err := fn(tx); err != nil {
			return err
		}
		if b.after {
			return errors.New("audit commit failed")
		}
		return nil
	})
}

func TestConnectorAuditFailureDoesNotInventOrHideCommittedEffects(t *testing.T) {
	svc := newTestService(t)
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	failing := &failingConnectorAuditBackend{Backend: backend}
	svc.audit, err = auditlog.Open(failing, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	ctx := userContext("owner")
	request := &runtimev1.CreateConnectorRequest{Provider: "openai", ApiKey: "test-secret", Label: "original"}
	failing.before = true
	if _, err := svc.CreateConnector(ctx, request); err == nil {
		t.Fatal("unrecordable create accepted")
	}
	rows, err := svc.store.Load()
	if err != nil || len(rows) != 0 {
		t.Fatalf("create committed: %v %v", rows, err)
	}
	failing.before = false
	failing.after = true
	created, err := svc.CreateConnector(ctx, request)
	if err != nil || created.GetConnector() == nil || created.GetAuditDiagnostic().GetReasonCode() != runtimev1.ReasonCode_AUDIT_RESULT_UNRECORDED {
		t.Fatalf("create outcome lost: %v %v", created, err)
	}
	id := created.GetConnector().GetConnectorId()
	label := "changed"
	updated, err := svc.UpdateConnector(ctx, &runtimev1.UpdateConnectorRequest{ConnectorId: id, Label: &label})
	if err != nil || updated.GetConnector().GetLabel() != label || updated.GetAuditDiagnostic() == nil {
		t.Fatalf("update outcome lost: %v %v", updated, err)
	}
	failing.after = false
	failing.before = true
	if _, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: id}); err == nil {
		t.Fatal("unrecordable delete accepted")
	}
	if _, found, err := svc.store.Get(id); err != nil || !found {
		t.Fatal("rejected delete removed connector")
	}
	failing.before = false
	failing.after = true
	deleted, err := svc.DeleteConnector(ctx, &runtimev1.DeleteConnectorRequest{ConnectorId: id})
	if err != nil || !deleted.GetAck().GetOk() || deleted.GetAuditDiagnostic() == nil {
		t.Fatalf("delete outcome lost: %v %v", deleted, err)
	}
	if _, found, err := svc.store.Get(id); err != nil || found {
		t.Fatal("committed delete was undone")
	}
}
