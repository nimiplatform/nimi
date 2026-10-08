package app

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/auditlog"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/runtimepersistence"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type accountCommitBarrier struct {
	*accountservice.Service
	entered, release chan struct{}
}

// Account logout and this App final SQL commit use the same real persistence
// and audit store. The reservation must precede Account/session fences, and
// a concurrent logout must finish after the actual terminal transaction.
func TestLocalAppCommitSharedWriterOrdersActualLogout(t *testing.T) {
	f, _, _ := runAccessFixture(t)
	backend, err := runtimepersistence.Open(nil, filepath.Join(t.TempDir(), "state.json"))
	if err != nil {
		t.Fatal(err)
	}
	defer backend.Close()
	audit, err := auditlog.Open(backend, nil, 128, 128)
	if err != nil {
		t.Fatal(err)
	}
	account := accountservice.New(nil, accountservice.WithAuditStore(audit), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
	WithRuntimeAccountProjectionProvider(account)(f.service)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	committed, loggedOut := make(chan error, 1), make(chan error, 1)
	go func() {
		committed <- backend.WithSerializedWriter(f.context, func(writerCtx context.Context) error {
			return f.service.CommitLocalAppIngress(writerCtx, localappop.IngressStorageJSONRead, func(commitCtx context.Context) error {
				close(entered)
				<-release
				return backend.WriteTx(commitCtx, func(tx *sql.Tx) error {
					_, err := tx.Exec(`INSERT INTO runtime_local_agent_meta(key,value) VALUES ('app_publication','completed')`)
					return err
				})
			})
		})
	}()
	<-entered
	started := make(chan struct{})
	go func() {
		close(started)
		response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop-1", DeviceId: "device-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
		if err == nil && !response.GetAccepted() {
			err = sql.ErrNoRows
		}
		loggedOut <- err
	}()
	<-started
	select {
	case <-loggedOut:
		t.Fatal("logout overtook fenced publication")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	for _, done := range []<-chan error{committed, loggedOut} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(3 * time.Second):
			t.Fatal("shared writer/Account lock inversion")
		}
	}
	var state string
	if err := backend.DB().QueryRow(`SELECT value FROM runtime_local_agent_meta WHERE key='app_publication'`).Scan(&state); err != nil || state != "completed" {
		t.Fatal("actual commit missing", state, err)
	}
	if _, _, _, ok := account.BindAuthenticatedRuntimeGeneration(context.Background()); ok {
		t.Fatal("actual logout did not revoke Account identity")
	}
}

func (a *accountCommitBarrier) CommitAuthenticatedRuntimeGeneration(ctx context.Context, accountID, realmID string, generation uint64, commit func() error) (bool, error) {
	close(a.entered)
	<-a.release
	return a.Service.CommitAuthenticatedRuntimeGeneration(ctx, accountID, realmID, generation, commit)
}

// The real Account owner completes logout while a held technical-session
// reader prevents its asynchronous watcher from applying InvalidateSession.
// A result authorized earlier must still fail at the account's final fence.
func TestLocalAppCommitRejectsLogoutBeforeSessionWatcher(t *testing.T) {
	f, _, _ := runAccessFixture(t)
	account := accountservice.New(nil, accountservice.WithAuditStore(auditlog.New(128, 128)), accountservice.WithNonProductionHarnessMode(), accountservice.WithClock(func() time.Time { return f.now }), accountservice.WithCustody(&localAppRefreshCustody{material: accountservice.AccountMaterial{AccountID: "account-1", RealmEnvironmentID: "realm-1", CurrentUserHandle: "user", DisplayName: "User", AccessToken: "access", RefreshToken: "refresh", AccessTokenExpires: f.now.Add(time.Hour)}}))
	barrier := &accountCommitBarrier{Service: account, entered: make(chan struct{}), release: make(chan struct{})}
	defer func() {
		select {
		case <-barrier.release:
		default:
			close(barrier.release)
		}
	}()
	WithRuntimeAccountProjectionProvider(barrier)(f.service)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	handle, _ := f.connection.Session()
	held, releaseSession, sessionDone := make(chan struct{}), make(chan struct{}), make(chan struct{})
	go func() {
		defer close(sessionDone)
		_ = f.connection.CommitSession(handle.SessionID, func() error { close(held); <-releaseSession; return nil })
	}()
	<-held
	defer func() { close(releaseSession); <-sessionDone }()
	published := false
	committed := make(chan error, 1)
	go func() {
		committed <- f.service.CommitLocalAppIngress(f.context, localappop.IngressStorageJSONRead, func(context.Context) error { published = true; return nil })
	}()
	select {
	case <-barrier.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("final account fence not reached")
	}
	response, err := account.Logout(context.Background(), &runtimev1.LogoutRequest{Caller: &runtimev1.AccountCaller{AppId: "nimi.desktop", AppInstanceId: "desktop-1", DeviceId: "device-1", Mode: runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL}})
	if err != nil || !response.GetAccepted() {
		t.Fatalf("real Account logout: %v %v", response, err)
	}
	close(barrier.release)
	select {
	case err := <-committed:
		if err == nil || published {
			t.Fatal("late publication escaped account invalidation", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("account fence waited for the blocked session watcher")
	}
}
