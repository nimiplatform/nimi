package app

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

// This fixture supplies the native/source verifier at its constructor seam.
// It exercises real registration, supervision, account and session owners;
// it does not claim native launch or product acceptance.
func rebindSessionFixture(t *testing.T, extra ...Option) (localAppSessionFixture, context.Context, *runtimev1.GetLocalDevelopmentRunAccessRequest) {
	t.Helper()
	store, err := openLocalDevelopmentStore(filepath.Join(t.TempDir(), "local-development.db"), localAppSessionTestIdentifier(0x90))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	options := []Option{func(s *Service) {
		s.localDevelopment.db = store.db
		if _, err := s.localDevelopment.SetDeveloperMode(context.Background(), true); err != nil {
			t.Fatal(err)
		}
		s.localAppRebindVerifier = func(ctx context.Context, _ *protectedlocal.LocalAppConnection, previous localAppRuntimeSession) (localappkernel.Registration, error) {
			return s.localAppKernel.Registrations().GetByHandle(ctx, previous.registrationHandle)
		}
	}}
	return runAccessFixture(t, append(options, extra...)...)
}

func expireRebindSession(f localAppSessionFixture) {
	f.service.localAppSessionMu.Lock()
	session := f.service.localAppSessions[f.connection]
	session.expiresAt = f.now.Add(-time.Second)
	f.service.localAppSessions[f.connection] = session
	f.service.localAppSessionMu.Unlock()
}

func TestLocalAppExplicitRebindExpiresOldScopeAndRejectsOldCallbacks(t *testing.T) {
	f, ownerCtx, accessReq := rebindSessionFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	before, _ := f.connection.Session()
	beforeAccess, err := f.service.GetLocalDevelopmentRunAccess(ownerCtx, accessReq)
	if err != nil || !beforeAccess.Available {
		t.Fatalf("missing live baseline: %v %v", beforeAccess, err)
	}
	old, err := f.service.AuthorizeLocalAppIngress(f.context, localappop.IngressStorageJSONRead)
	if err != nil {
		t.Fatal(err)
	}
	var cleanups atomic.Int32
	if !f.connection.BindSessionResource(before, "old-work", func() { cleanups.Add(1) }) {
		t.Fatal("bind old resource")
	}
	expireRebindSession(f)
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err == nil {
		t.Fatal("renew revived expired scope")
	}
	if _, err := f.service.RebindLocalAppSessionProjection(f.context); err != nil {
		t.Fatalf("verified same-connection rebind: %v", err)
	}
	after, _ := f.connection.Session()
	if after == before || after.SessionID == before.SessionID || !f.connection.Live() || cleanups.Load() != 1 {
		t.Fatalf("fresh scope missing or old cleanup incorrect: changed=%v live=%v cleanup=%d", after != before, f.connection.Live(), cleanups.Load())
	}
	if !f.connection.BindSessionResource(after, "new-work", func() {}) {
		t.Fatal("bind new resource")
	}
	if f.connection.BindSessionResource(before, "late-old-work", func() {}) || f.connection.SessionOwnsResource(after, "old-work") {
		t.Fatal("old resource crossed into the new scope")
	}
	// A callback may remove cancellation to finish local cleanup, but that
	// cannot remove the authorization decision's exact old-session fence.
	oldUncanceled := context.WithoutCancel(old)
	assertLocalAppReason(t, f.service.AdmitLocalAppIngress(oldUncanceled, localappop.IngressStorageJSONRead), runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED)
	if _, err := f.service.AuthorizeLocalAppIngress(oldUncanceled, localappop.IngressStorageJSONRead); err == nil {
		t.Fatal("old callback acquired the replacement scope")
	}
	if _, err := f.service.RebindLocalAppSessionProjection(oldUncanceled); err == nil {
		t.Fatal("old callback entered explicit rebind")
	}
	if f.connection.InvalidateSession(before) {
		t.Fatal("late old invalidation touched the new scope")
	}
	f.connection.ReleaseSessionResource(before, "new-work")
	canceled, cancel := context.WithCancel(f.context)
	cancel()
	if err := f.service.AdmitLocalAppIngress(canceled, localappop.IngressStorageJSONRead); err == nil {
		t.Fatal("canceled response admitted")
	}
	if err := f.service.AdmitLocalAppIngress(f.context, localappop.IngressStorageJSONRead); err != nil || !f.connection.SessionOwnsResource(after, "new-work") {
		t.Fatalf("old response poisoned current scope: %v", err)
	}
	afterAccess, err := f.service.GetLocalDevelopmentRunAccess(ownerCtx, accessReq)
	if err != nil || !afterAccess.Available || afterAccess.ExecutionScopeRef == beforeAccess.ExecutionScopeRef {
		t.Fatalf("explicit replacement did not expose new scope ref: %v %v", afterAccess, err)
	}
}

func TestLocalAppExplicitRebindLiveAndConcurrentDuplicatesKeepScope(t *testing.T) {
	f, _, _ := rebindSessionFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	live, _ := f.connection.Session()
	var cleaned atomic.Int32
	f.connection.BindSessionResource(live, "live", func() { cleaned.Add(1) })
	if _, err := f.service.RebindLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	unchanged, _ := f.connection.Session()
	if unchanged != live || cleaned.Load() != 0 || !f.connection.SessionOwnsResource(live, "live") {
		t.Fatal("live duplicate rebind rotated a valid scope")
	}
	expireRebindSession(f)
	var wg sync.WaitGroup
	errs := make(chan error, 6)
	for range 6 {
		wg.Add(1)
		go func() { defer wg.Done(); _, err := f.service.RebindLocalAppSessionProjection(f.context); errs <- err }()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatal(err)
		}
	}
	next, _ := f.connection.Session()
	if next == live || cleaned.Load() != 1 {
		t.Fatal("concurrent explicit rebind lost the single old-scope cleanup")
	}
	if _, err := f.service.RebindLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	again, _ := f.connection.Session()
	if again != next {
		t.Fatal("repeated rebind rotated the replacement scope")
	}
}

func TestLocalAppExplicitRebindRevalidatesAccountAndDeclaration(t *testing.T) {
	for _, kind := range []string{"account", "declaration"} {
		t.Run(kind, func(t *testing.T) {
			f, _, _ := rebindSessionFixture(t)
			if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
				t.Fatal(err)
			}
			before, _ := f.connection.Session()
			if kind == "account" {
				f.account.replace("account-2", "realm-2")
			} else {
				f.registrationInput.RawDeclaration = []string{"realm.data"}
				if _, err := f.kernel.Registrations().RegisterDevelopment(f.context, f.registrationInput); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := f.service.RenewLocalAppSessionProjection(f.context); err == nil {
				t.Fatal("renew silently replaced invalid scope")
			}
			if _, err := f.service.RebindLocalAppSessionProjection(f.context); err != nil {
				t.Fatal(err)
			}
			after, _ := f.connection.Session()
			if before == after {
				t.Fatal("changed owner state reused old scope")
			}
			if err := f.service.AdmitLocalAppIngress(f.context, localappop.IngressStorageJSONRead); err != nil {
				t.Fatalf("fresh current state not admitted: %v", err)
			}
		})
	}
}

func TestLocalAppExplicitRebindRejectsLostLaunchAuthority(t *testing.T) {
	for _, kind := range []string{"source", "process", "supervision", "developer-mode", "owner", "foreign-owner", "connection", "account", "registration", "runtime", "bootstrap", "missing-native-evidence"} {
		t.Run(kind, func(t *testing.T) {
			var processChanged bool
			f, ownerCtx, req := rebindSessionFixture(t, func(s *Service) {
				original := s.localAppRebindVerifier
				s.localAppRebindVerifier = func(ctx context.Context, c *protectedlocal.LocalAppConnection, old localAppRuntimeSession) (localappkernel.Registration, error) {
					if processChanged {
						return localappkernel.Registration{}, errors.New("native process witness changed")
					}
					return original(ctx, c, old)
				}
				if kind == "missing-native-evidence" {
					s.localAppRebindVerifier = nil
				}
			})
			if kind != "bootstrap" {
				if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
					t.Fatal(err)
				}
			}
			before, _ := f.connection.Session()
			ctx := f.context
			owner, _ := protectedlocal.DesktopConnectionFromContext(ownerCtx)
			switch kind {
			case "source":
				f.registrationInput.HostExecutableDigest = "changed-host"
				if _, err := f.kernel.Registrations().RegisterDevelopment(f.context, f.registrationInput); err != nil {
					t.Fatal(err)
				}
			case "process":
				processChanged = true
			case "supervision":
				run, _ := localDevelopmentIdentifierFromBytes(req.SupervisorRunId)
				owner.UnbindRevocationHook(run)
			case "developer-mode":
				if _, err := f.store.SetDeveloperMode(f.context, false); err != nil {
					t.Fatal(err)
				}
			case "owner":
				owner.Revoke()
			case "foreign-owner":
				_, foreign := runAccessDesktop(t, 0x79)
				ctx = protectedlocal.ContextWithDesktopConnection(ctx, foreign)
			case "connection":
				f.connection.Revoke()
			case "account":
				f.account.signOut()
			case "registration":
				if err := f.kernel.Close(); err != nil {
					t.Fatal(err)
				}
			case "runtime":
				f.service.localAppSessionMu.Lock()
				delete(f.service.localAppSessions, f.connection)
				f.service.localAppSessionMu.Unlock()
			}
			if _, err := f.service.RebindLocalAppSessionProjection(ctx); err == nil {
				t.Fatal("lost launch authority re-established a scope")
			}
			if after, bound := f.connection.Session(); bound && after != before {
				t.Fatal("rejected rebind changed the exact previous handle")
			}
		})
	}
}
