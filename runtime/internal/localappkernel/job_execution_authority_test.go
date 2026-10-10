package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestJobRegistrationAuthorityTracksCommittedOwnerWithdrawal(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "job-install", 0x31)
	defer kernel.Close()
	ctx := context.Background()
	input := developmentInput()
	input.RawDeclaration = []string{"runtime.consume"}
	r, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	signal, release, err := kernel.Registrations().BindJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration)
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	// A new unrelated subject cannot revoke this admitted work.
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, input); err != nil {
		t.Fatal(err)
	}
	select {
	case <-signal:
		t.Fatal("unrelated registration revoked work")
	default:
	}
	kernel.beforeCommit = func() error { return errors.New("disk failure") }
	if err := kernel.Registrations().Tombstone(ctx, r.RegistrationHandle); err == nil {
		t.Fatal("expected real transaction failure")
	}
	kernel.beforeCommit = nil
	select {
	case <-signal:
		t.Fatal("rolled back withdrawal revoked work")
	default:
	}
	if err := kernel.Registrations().Tombstone(ctx, r.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	select {
	case <-signal:
	default:
		t.Fatal("committed withdrawal did not invalidate work")
	}
	called := false
	if err := kernel.Registrations().WithJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, func() error { called = true; return nil }); err == nil || called {
		t.Fatal("withdrawn owner published")
	}
}

func TestJobRegistrationCommitFenceOrdersActualMutation(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "job-install", 0x32)
	defer kernel.Close()
	ctx := context.Background()
	input := developmentInput()
	input.RawDeclaration = []string{"runtime.consume"}
	r, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	entered, release := make(chan struct{}), make(chan struct{})
	committed, revoked := make(chan error, 1), make(chan error, 1)
	go func() {
		committed <- kernel.Registrations().WithJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, func() error { close(entered); <-release; return nil })
	}()
	<-entered
	go func() { revoked <- kernel.Registrations().Tombstone(ctx, r.RegistrationHandle) }()
	select {
	case err := <-revoked:
		close(release)
		t.Fatalf("withdrawal crossed commit fence: %v", err)
	case <-time.After(20 * time.Millisecond):
	}
	close(release)
	if err := <-committed; err != nil {
		t.Fatal(err)
	}
	if err := <-revoked; err != nil {
		t.Fatal(err)
	}
}
