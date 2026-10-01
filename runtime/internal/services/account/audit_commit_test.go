package account

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

type failingAccountAuditBackend struct {
	*runtimepersistence.Backend
	before, after bool
}

func (b *failingAccountAuditBackend) WriteTx(ctx context.Context, fn func(*sql.Tx) error) error {
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

func TestAccountAuditFailurePreservesExactMutationOutcome(t *testing.T) {
	for _, op := range []string{"logout", "switch"} {
		t.Run(op, func(t *testing.T) {
			backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
			if err != nil {
				t.Fatal(err)
			}
			defer func() {
				if err := backend.Close(); err != nil {
					t.Errorf("close test storage: %v", err)
				}
			}()
			failing := &failingAccountAuditBackend{Backend: backend}
			store, err := auditlog.Open(failing, nil, 100, 10)
			if err != nil {
				t.Fatal(err)
			}
			custody := &memoryCustody{}
			svc := newHarnessService(t, custody, WithAuditStore(store))
			completeLogin(t, svc)
			call := func() (bool, *runtimev1.ErrorInfo, error) {
				if op == "logout" {
					r, e := svc.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: desktopAccountControlCaller()})
					return r.GetAccepted(), r.GetAuditDiagnostic(), e
				}
				r, e := svc.SwitchAccount(context.Background(), &runtimev1.SwitchAccountRequest{Caller: desktopAccountControlCaller()})
				return r.GetAccepted(), r.GetAuditDiagnostic(), e
			}
			failing.before = true
			if accepted, _, err := call(); err == nil || accepted || !custody.has {
				t.Fatalf("pre-commit failure changed account: %v %v", accepted, err)
			}
			failing.before = false
			failing.after = true
			accepted, diagnostic, err := call()
			if err != nil || !accepted || custody.has || diagnostic.GetReasonCode() != runtimev1.ReasonCode_AUDIT_RESULT_UNRECORDED {
				t.Fatalf("committed outcome lost: %v %v %v", accepted, diagnostic, err)
			}
			svc.mu.RLock()
			snapshot := svc.currentSnapshotLocked()
			svc.mu.RUnlock()
			if snapshot.GetState() != runtimev1.AccountSessionState_ACCOUNT_SESSION_STATE_ANONYMOUS || snapshot.GetAuditDiagnostic() == nil {
				t.Fatal(snapshot)
			}
		})
	}
}
