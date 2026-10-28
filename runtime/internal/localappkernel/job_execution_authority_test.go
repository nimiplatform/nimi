package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestRegistrationPairChecksBothDomainsForOneSubject(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "pair-install", 0x34)
	defer kernel.Close()
	input := developmentInput()
	input.RawDeclaration = []string{"integration.consume"}
	r, err := kernel.Registrations().RegisterDevelopment(context.Background(), input)
	if err != nil {
		t.Fatal(err)
	}
	consumer := RegistrationRequirement{r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "integration.consume"}
	provider := consumer
	provider.Domain = "integration.provide"
	called := false
	if err := kernel.Registrations().WithRegistrationAuthorityPair(context.Background(), consumer, provider, func() error { called = true; return nil }); err == nil || called {
		t.Fatal("same-subject deduplication granted a missing provider domain")
	}
	if err := kernel.Registrations().WithRegistrationAuthorityPair(context.Background(), consumer, consumer, func() error { called = true; return nil }); err != nil || !called {
		t.Fatal("valid same-subject pair rejected", err)
	}
}

func TestJobRegistrationAuthorityTracksCommittedOwnerWithdrawal(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "job-install", 0x31)
	defer func() { _ = kernel.Close() }()
	ctx := context.Background()
	input := developmentInput()
	input.RawDeclaration = []string{"runtime.consume"}
	r, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	signal, release, err := kernel.Registrations().BindJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "runtime.consume")
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
	if err := kernel.Registrations().WithRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "runtime.consume", func() error { called = true; return nil }); err == nil || called {
		t.Fatal("withdrawn owner published")
	}
}

func TestJobRegistrationCommitFenceOrdersActualMutation(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "job-install", 0x32)
	defer func() { _ = kernel.Close() }()
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
		committed <- kernel.Registrations().WithRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "runtime.consume", func() error { close(entered); <-release; return nil })
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

func TestRegistrationPublicationFenceUsesCanonicalDomainsWithoutWideningJobs(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "publication", 0x33)
	defer func() {
		if err := kernel.Close(); err != nil {
			t.Errorf("close kernel: %v", err)
		}
	}()
	ctx := context.Background()
	input := developmentInput()
	input.RawDeclaration = []string{"agent.local", "integration.manage"}
	r, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	for _, domain := range []string{"", "agent.local", "integration.manage", "runtime.consume", "unknown.domain"} {
		called := false
		err := kernel.Registrations().WithRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, domain, func() error { called = true; return nil })
		allowed := domain == "" || domain == "agent.local" || domain == "integration.manage"
		if (err == nil) != allowed || called != allowed {
			t.Fatalf("domain %q: called=%v err=%v", domain, called, err)
		}
	}
	if _, release, err := kernel.Registrations().BindJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "integration.manage"); err == nil {
		release()
		t.Fatal("shared fence widened Job authority")
	}
}

func TestAgentVoiceRegistrationAuthorityRequiresOnlyItsAdmittedDomain(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "voice-job-install", 0x33)
	defer func() { _ = kernel.Close() }()
	ctx := context.Background()
	input := developmentInput()
	input.RawDeclaration = []string{"agent.local"}
	r, err := kernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	signal, release, err := kernel.Registrations().BindJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, "agent.local")
	if err != nil {
		t.Fatal(err)
	}
	defer release()
	for _, forbidden := range []string{"runtime.consume", "", "unadmitted.domain"} {
		if _, undo, err := kernel.Registrations().BindJobRegistrationAuthority(ctx, r.RegisteredAppSubject, r.SourceGeneration, r.DeclarationGeneration, forbidden); err == nil {
			undo()
			t.Fatalf("voice registration admitted %q", forbidden)
		}
	}
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, input); err != nil {
		t.Fatal(err)
	}
	select {
	case <-signal:
		t.Fatal("unrelated mutation invalidated the admitted Agent domain")
	default:
	}
	if err := kernel.Registrations().Tombstone(ctx, r.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	select {
	case <-signal:
	default:
		t.Fatal("withdrawn Agent registration kept its voice permit")
	}
}
