package protectedlocal

import (
	"context"
	"errors"
	"io"
	"net"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

// These are owner-component regressions. Prepare, Bind, Consume, connection,
// session and resource lifetimes are real; OS peer inspection is covered by
// the native listener tests rather than simulated by these process facts.
func TestConsumedDirectLocalAppOwnerRevocationClosesScopeAndTransport(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	owner := directLocalAppTestDesktop(t, 41, 501)
	connection, handle := newConsumedDirectOwnerTestConnection(t, launches, owner, Identifier{1}, Identifier{2}, 52, filepath.Join(t.TempDir(), "host.exe"), 0x71)
	invalidated, ok := connection.SessionInvalidated(handle)
	if !ok {
		t.Fatal("session fence unavailable before owner loss")
	}
	ctx, cancel := context.WithCancel(ContextWithLocalAppConnection(context.Background(), connection))
	t.Cleanup(cancel)
	server, client := net.Pipe()
	t.Cleanup(func() { _ = server.Close(); _ = client.Close() })
	var transportCloses, cleanups atomic.Int32
	connection.OnRevoke(func() {
		transportCloses.Add(1)
		cancel()
		_ = server.Close()
	})
	cleaned := make(chan struct{})
	if !connection.BindSessionResource(handle, "active-work", func() {
		cleanups.Add(1)
		close(cleaned)
	}) {
		t.Fatal("bind active work")
	}

	owner.Revoke()
	select {
	case <-cleaned:
	case <-time.After(time.Second):
		t.Error("owner revocation did not clean the already-consumed App resource")
	}
	if connection.Live() || connection.ProtectedOperationAllowed() {
		t.Error("consumed App connection retained authority after Desktop owner loss")
	}
	if _, ok := connection.Session(); ok {
		t.Error("consumed App retained its session after Desktop owner loss")
	}
	select {
	case <-invalidated:
	default:
		t.Error("owner loss did not close the App session fence")
	}
	if ctx.Err() == nil {
		t.Error("App revocation callback did not cancel its request context")
	}
	if _, ok := LocalAppConnectionFromContext(ctx); ok {
		t.Error("old request context still resolves an authorized App connection")
	}
	if transportCloses.Load() != 1 || cleanups.Load() != 1 {
		t.Errorf("revocation callbacks = transport:%d resources:%d, want one each", transportCloses.Load(), cleanups.Load())
	}
	if connection.SessionOwnsResource(handle, "active-work") {
		t.Error("old session still owns its resource")
	}
	if err := client.SetReadDeadline(time.Now().Add(100 * time.Millisecond)); err != nil && !errors.Is(err, io.ErrClosedPipe) {
		t.Fatal(err)
	}
	if _, err := client.Read(make([]byte, 1)); err == nil {
		t.Error("transport callback left the App pipe usable")
	} else if timeout, ok := err.(net.Error); ok && timeout.Timeout() {
		t.Error("transport callback did not close the App pipe")
	}
}

func TestConsumedDirectLocalAppRejectsWorkWhileOwnerRevocationIsPropagating(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	owner := directLocalAppTestDesktop(t, 41, 501)
	entered, release := make(chan struct{}), make(chan struct{})
	// A preceding owner cleanup may take time. Closing the owner fence must
	// reject new work without waiting for a later child cleanup callback.
	owner.onRevoke(func() { close(entered); <-release })
	connection, handle := newConsumedDirectOwnerTestConnection(t, launches, owner, Identifier{3}, Identifier{4}, 53, filepath.Join(t.TempDir(), "host.exe"), 0x73)
	ctx := ContextWithLocalAppConnection(context.Background(), connection)
	revoked := make(chan struct{})
	go func() { owner.Revoke(); close(revoked) }()
	defer func() { close(release); <-revoked }()
	<-entered

	if owner.VerifiedDesktopTransport() {
		t.Fatal("test did not enter the revoked-owner propagation window")
	}
	if connection.ProtectedOperationAllowed() {
		t.Error("new protected operation passed after its Desktop owner was revoked")
	}
	if _, ok := LocalAppConnectionFromContext(ctx); ok {
		t.Error("request context retained authority while owner revocation was propagating")
	}
	published := false
	if err := connection.CommitSession(handle.SessionID, func() error { published = true; return nil }); err == nil || published {
		t.Error("old scope published during owner-revocation propagation")
	}
	if connection.BindSessionResource(handle, "late-work", func() {}) {
		t.Error("old scope admitted a new resource during owner-revocation propagation")
	}
}

func TestConsumedDirectLocalAppOwnerRevocationWaitsForEnteredCommit(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	owner := directLocalAppTestDesktop(t, 41, 501)
	connection, handle := newConsumedDirectOwnerTestConnection(t, launches, owner, Identifier{15}, Identifier{16}, 58, filepath.Join(t.TempDir(), "host.exe"), 0x7d)
	entered, release := make(chan struct{}), make(chan struct{})
	committed := make(chan error, 1)
	go func() {
		committed <- connection.CommitSession(handle.SessionID, func() error {
			close(entered)
			<-release
			return nil
		})
	}()
	<-entered
	revoked := make(chan struct{})
	go func() { owner.Revoke(); close(revoked) }()
	<-owner.Done()
	// The listener may admit a replacement owner after Revoke returns. An
	// already-entered old commit must finish before that handover boundary.
	select {
	case <-revoked:
		t.Error("Desktop owner revocation completed while an old-scope commit was still executing")
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-committed; err != nil {
		t.Fatalf("commit admitted before owner loss failed: %v", err)
	}
	select {
	case <-revoked:
	case <-time.After(time.Second):
		t.Fatal("owner revocation did not complete after the admitted commit drained")
	}
	if err := connection.CommitSession(handle.SessionID, func() error { t.Error("old commit ran after owner handover"); return nil }); err == nil {
		t.Error("retired owner scope admitted another commit")
	}
}

func TestConsumedDirectLocalAppOldCallbacksCannotReachFreshOwnerScope(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	executable := filepath.Join(t.TempDir(), "host.exe")
	oldOwner := directLocalAppTestDesktop(t, 41, 501)
	old, oldHandle := newConsumedDirectOwnerTestConnection(t, launches, oldOwner, Identifier{5}, Identifier{6}, 54, executable, 0x75)
	oldOwner.Revoke()

	// The exact same OS process facts do not carry an old technical scope into
	// a separately verified Desktop owner. Consume a fresh launch for it.
	freshOwner := directLocalAppTestDesktop(t, 41, 501)
	fresh, freshHandle := newConsumedDirectOwnerTestConnection(t, launches, freshOwner, Identifier{5}, Identifier{6}, 54, executable, 0x77)
	var freshCleanups atomic.Int32
	if !fresh.BindSessionResource(freshHandle, "fresh-work", func() { freshCleanups.Add(1) }) {
		t.Fatal("bind fresh work")
	}
	oldPublished := false
	if err := old.CommitSession(oldHandle.SessionID, func() error { oldPublished = true; return nil }); err == nil || oldPublished {
		t.Error("late old-scope callback published after a fresh owner had been admitted")
	}
	if old.BindSessionResource(oldHandle, "late-old-work", func() {}) {
		t.Error("late callback attached work to the retired owner scope")
	}
	old.Revoke()
	oldOwner.Revoke()
	if !freshOwner.VerifiedDesktopTransport() || !fresh.Live() || !fresh.SessionOwnsResource(freshHandle, "fresh-work") || freshCleanups.Load() != 0 {
		t.Fatal("late old connection cleanup crossed into the fresh owner scope")
	}
	if err := fresh.CommitSession(freshHandle.SessionID, func() error { return nil }); err != nil {
		t.Fatalf("fresh scope cannot publish: %v", err)
	}
}

func TestConsumedDirectLocalAppCloseKeepsOwnerAndSibling(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	owner := directLocalAppTestDesktop(t, 41, 501)
	executable := filepath.Join(t.TempDir(), "host.exe")
	first, _ := newConsumedDirectOwnerTestConnection(t, launches, owner, Identifier{7}, Identifier{8}, 55, executable, 0x79)
	sibling, handle := newConsumedDirectOwnerTestConnection(t, launches, owner, Identifier{9}, Identifier{10}, 56, executable, 0x7b)
	var siblingCleanups atomic.Int32
	if !sibling.BindSessionResource(handle, "sibling-work", func() { siblingCleanups.Add(1) }) {
		t.Fatal("bind sibling work")
	}
	first.Revoke()
	if !owner.VerifiedDesktopTransport() || !sibling.ProtectedOperationAllowed() || !sibling.SessionOwnsResource(handle, "sibling-work") || siblingCleanups.Load() != 0 {
		t.Fatal("closing one App revoked its owner or another App")
	}
	if err := sibling.CommitSession(handle.SessionID, func() error { return nil }); err != nil {
		t.Fatalf("sibling scope cannot publish: %v", err)
	}
}

func TestConsumedDirectLocalAppCloseReleasesOwnerSubscription(t *testing.T) {
	launches := NewDirectLocalAppLaunches()
	owner := directLocalAppTestDesktop(t, 41, 501)
	executable := filepath.Join(t.TempDir(), "host.exe")
	registration, run := Identifier{17}, Identifier{18}
	owner.revokeMu.Lock()
	baseline := len(owner.revokeHooks)
	owner.revokeMu.Unlock()
	for attempt := 0; attempt < 4; attempt++ {
		connection, _ := newConsumedDirectOwnerTestConnection(t, launches, owner, registration, run, 59, executable, 0x81)
		owner.revokeMu.Lock()
		bound := len(owner.revokeHooks)
		owner.revokeMu.Unlock()
		if bound != baseline+1 {
			t.Fatalf("live child subscriptions = %d, want %d", bound, baseline+1)
		}
		connection.Revoke()
		owner.revokeMu.Lock()
		retained := len(owner.revokeHooks)
		owner.revokeMu.Unlock()
		if retained != baseline {
			t.Fatalf("closed child retained by long-lived owner on attempt %d: %d callbacks", attempt, retained)
		}
		if !owner.HasBoundRevocationHook(run) {
			t.Fatal("child unsubscribe removed the distinct supervisor run hook")
		}
	}
}

func TestDesktopRevocationSubscriptionRemovalPreservesOtherCallbacks(t *testing.T) {
	owner := directLocalAppTestDesktop(t, 41, 501)
	removed, retained := 0, 0
	unsubscribe := owner.onRevoke(func() { removed++ })
	owner.onRevoke(func() { retained++ })
	unsubscribe()
	unsubscribe()
	owner.Revoke()
	if removed != 0 || retained != 1 {
		t.Fatalf("callbacks after unsubscribe = removed:%d retained:%d", removed, retained)
	}
	late := 0
	unsubscribeLate := owner.onRevoke(func() { late++ })
	unsubscribeLate()
	if late != 1 {
		t.Fatal("a late owner subscription did not run immediately")
	}
}

func TestConsumedDirectLocalAppRejectsMissingOrRevokedOwner(t *testing.T) {
	for _, invalidOwner := range []string{"missing", "revoked"} {
		t.Run(invalidOwner, func(t *testing.T) {
			launches := NewDirectLocalAppLaunches()
			owner := directLocalAppTestDesktop(t, 41, 501)
			peer, consumed := consumeDirectOwnerTestLaunch(t, launches, owner, Identifier{11}, Identifier{12}, 57, filepath.Join(t.TempDir(), "host.exe"))
			if invalidOwner == "missing" {
				consumed.DesktopOwner = nil
			} else {
				owner.Revoke()
			}
			connection, err := newDirectLocalAppConnection(peer, consumed, Identifier{13})
			if connection != nil {
				t.Cleanup(connection.Revoke)
			}
			if err == nil || connection != nil {
				t.Fatalf("%s Desktop owner admitted a consumed App connection", invalidOwner)
			}
		})
	}
}

func newConsumedDirectOwnerTestConnection(t *testing.T, launches *DirectLocalAppLaunches, owner *Connection, registration, run Identifier, pid uint32, executable string, seed byte) (*LocalAppConnection, LocalAppSessionHandle) {
	t.Helper()
	peer, consumed := consumeDirectOwnerTestLaunch(t, launches, owner, registration, run, pid, executable)
	connection, err := newDirectLocalAppConnection(peer, consumed, Identifier{14})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	handle := LocalAppSessionHandle{SessionID: localAppTestIdentifier(seed), SessionProof: localAppTestIdentifier(seed + 1)}
	if err := connection.BindSession(handle); err != nil {
		t.Fatal(err)
	}
	return connection, handle
}

func consumeDirectOwnerTestLaunch(t *testing.T, launches *DirectLocalAppLaunches, owner *Connection, registration, run Identifier, pid uint32, executable string) (DirectLocalAppPeer, DirectLocalAppLaunch) {
	t.Helper()
	desktop, ok := owner.DirectDesktopPeer()
	if !ok {
		t.Fatal("test owner is not verified")
	}
	prepared, err := launches.Prepare(owner, registration, run, 3, 4, desktop.PID, desktop.UID, executable, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	// Match PrepareLocalAppLaunch's run hook: after Consume this can only
	// clear pending launches, so it must not stand in for the live App fence.
	if err := owner.BindRevocationHook(run, func() { launches.Revoke(prepared.LaunchID); launches.RevokeRun(registration, run) }); err != nil {
		t.Fatal(err)
	}
	witness := DirectLocalAppProcessWitness{PID: pid, ParentPID: desktop.PID, UID: desktop.UID, StartSeconds: 6, ExecutablePath: executable}
	if _, err := launches.Bind(prepared.LaunchID, witness, desktop.PID, desktop.UID, time.Now().Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	consumed, err := launches.Consume(pid, desktop.UID)
	if err != nil {
		t.Fatal(err)
	}
	if _, exists := launches.Prepared(prepared.LaunchID); exists {
		t.Fatal("test launch remained pending after Consume")
	}
	return DirectLocalAppPeer{OS: desktop.OS, PID: pid, UID: desktop.UID}, consumed
}
