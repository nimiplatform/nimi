//go:build darwin && cgo

package protectedlocal

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestDirectLocalAppRevalidationRequiresRetainedProcessAndSupervisor(t *testing.T) {
	owner := directLocalAppTestDesktop(t, 41, 501)
	executable := filepath.Join(t.TempDir(), "Host")
	launches := NewDirectLocalAppLaunches()
	launch, err := launches.Prepare(owner, Identifier{1}, Identifier{2}, 3, 4, 41, 501, executable, time.Now().Add(time.Minute))
	if err != nil {
		t.Fatal(err)
	}
	witness := DirectLocalAppProcessWitness{PID: 52, ParentPID: 41, UID: 501, StartSeconds: 6, ExecutablePath: executable}
	if _, err := launches.Bind(launch.LaunchID, witness, 41, 501, time.Now().Add(10*time.Second)); err != nil {
		t.Fatal(err)
	}
	launch, err = launches.Consume(52, 501)
	if err != nil {
		t.Fatal(err)
	}
	connection, err := newDirectLocalAppConnection(DirectLocalAppPeer{OS: OSMacOS, PID: 52, UID: 501}, launch, Identifier{3})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	if err := RevalidateDirectLocalAppProcess(context.Background(), connection); err == nil {
		t.Fatal("missing native process witness admitted")
	}
	// Inject only the native verifier's result, leaving the exact retained
	// connection and owner checks intact. OS launch acceptance is separate.
	owner.revalidateProcess = func(context.Context) error { return nil }
	processChanged := errors.New("original process audit witness changed")
	connection.revalidateProcess = func(context.Context) error { return processChanged }
	if err := RevalidateDirectLocalAppProcess(context.Background(), connection); !errors.Is(err, processChanged) {
		t.Fatalf("changed original process was not rejected: %v", err)
	}
	connection.revalidateProcess = func(context.Context) error { return nil }
	if err := RevalidateDirectLocalAppProcess(context.Background(), connection); err != nil {
		t.Fatal(err)
	}
	owner.Revoke()
	if err := RevalidateDirectLocalAppProcess(context.Background(), connection); err == nil {
		t.Fatal("revoked supervisor retained rebind authority")
	}
	if err := revalidateMacOSAuditProcess(macOSAuditIdentity{}); err == nil {
		t.Fatal("empty audit evidence was accepted")
	}
}
