package app

import (
	"context"
	"database/sql"
	"errors"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
)

// commitFailingBackend runs the audit transaction's statements and the owner
// effect, then fails the final commit, as a full disk or I/O error would.
type commitFailingBackend struct {
	*runtimepersistence.Backend
	failCommit bool
}

func (backend *commitFailingBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
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

func developerModeAuditRecords(t *testing.T, store *auditlog.Store) (successes int, refusals int) {
	t.Helper()
	response, err := store.ListEvents(&runtimev1.ListAuditEventsRequest{Domain: developmentAuditDomain, PageSize: 100})
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range response.GetEvents() {
		if event.GetOperation() != "developer_mode.set" || event.GetAppId() != "nimi.desktop" {
			t.Fatalf("developer mode record = %v", event)
		}
		if event.GetReasonCode() == runtimev1.ReasonCode_ACTION_EXECUTED {
			successes++
		} else {
			refusals++
		}
	}
	return successes, refusals
}

func TestSetDeveloperModeRecordsOneResultAroundTheModeWrite(t *testing.T) {
	development, err := openDirectLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = development.Close() })
	persistence, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "local-state.json"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = persistence.Close() })
	backend := &commitFailingBackend{Backend: persistence}
	audit, err := auditlog.Open(backend, nil, 100, 10)
	if err != nil {
		t.Fatal(err)
	}
	service := New(nil, WithDirectLocalDevelopmentAuthority(development, nil, nil), WithAuditStore(audit))
	desktop, _ := runAccessDesktop(t, 0x71)

	enabled, err := service.SetDeveloperMode(desktop, &runtimev1.SetDeveloperModeRequest{Enabled: true})
	if err != nil || enabled.GetState() != runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_ENABLED {
		t.Fatalf("enable developer mode = %v %v", enabled, err)
	}
	if successes, refusals := developerModeAuditRecords(t, audit); successes != 1 || refusals != 0 {
		t.Fatalf("enable records = %d/%d", successes, refusals)
	}
	// An unchanged request commits nothing and records nothing.
	if _, err := service.SetDeveloperMode(desktop, &runtimev1.SetDeveloperModeRequest{Enabled: true}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetDeveloperMode(context.Background(), &runtimev1.SetDeveloperModeRequest{Enabled: false}); err == nil {
		t.Fatal("developer mode changed without the protected Desktop connection")
	}
	if successes, refusals := developerModeAuditRecords(t, audit); successes != 1 || refusals != 1 {
		t.Fatalf("refusal records = %d/%d", successes, refusals)
	}

	// An unrecordable change never happens.
	if _, err := persistence.DB().Exec(`CREATE TRIGGER test_block_audit BEFORE INSERT ON runtime_audit_event BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	_, err = service.SetDeveloperMode(desktop, &runtimev1.SetDeveloperModeRequest{Enabled: false})
	if metadata, _ := grpcerr.ExtractReasonMetadata(err); metadata["audit_disposition"] != "unrecorded" {
		t.Fatalf("unrecordable change = %v", err)
	}
	if mode, err := development.DeveloperMode(context.Background()); err != nil || !mode.Enabled {
		t.Fatalf("unrecordable change took effect: %+v %v", mode, err)
	}
	if _, err := persistence.DB().Exec(`DROP TRIGGER test_block_audit`); err != nil {
		t.Fatal(err)
	}

	// A committed change whose record then fails is reported truthfully.
	backend.failCommit = true
	disabled, err := service.SetDeveloperMode(desktop, &runtimev1.SetDeveloperModeRequest{Enabled: false})
	backend.failCommit = false
	if err != nil || disabled.GetState() != runtimev1.DeveloperModeState_DEVELOPER_MODE_STATE_DISABLED {
		t.Fatalf("committed but unrecorded change = %v %v", disabled, err)
	}
	if mode, err := development.DeveloperMode(context.Background()); err != nil || mode.Enabled || mode.Revision != disabled.GetRevision() {
		t.Fatalf("committed mode = %+v %v", mode, err)
	}
	if successes, refusals := developerModeAuditRecords(t, audit); successes != 1 || refusals != 1 {
		t.Fatalf("records after unrecorded commit = %d/%d", successes, refusals)
	}
}
