package localappkernel

import (
	"bytes"
	"context"
	"errors"
	"path/filepath"
	"testing"
	"time"
)

func TestDevelopmentRegistrationOwnsRandomNonReusableSubjectAndGenerations(t *testing.T) {
	ctx := context.Background()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 8, 3, 12, 0, 0, 0, time.UTC)
	entropy := append(bytes.Repeat([]byte{0x11}, 32), bytes.Repeat([]byte{0x22}, 32)...)
	entropy = append(entropy, bytes.Repeat([]byte{0x33}, 32)...)
	entropy = append(entropy, bytes.Repeat([]byte{0x44}, 32)...)
	kernel, err := OpenSQLite(ctx, filepath.Join(t.TempDir(), "registered-app.db"), identity, Options{
		Random: bytes.NewReader(entropy),
		Now:    func() time.Time { return now },
	})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = kernel.Close() }()

	base := RegisterDevelopmentInput{
		AppID: "nimi.example", DisplayName: "Example", SourceRef: "project-file:one",
		ProjectRoot: "/projects/example", ManifestPath: "/projects/example/nimi.app.yaml", ShellKind: 1,
		RawDeclaration: []string{"realm.data", "future.domain"}, SourceDigest: "source:one",
		HostExecutableDigest: "host:one", PayloadRootDigest: "payload:one",
	}
	first, err := kernel.Registrations().RegisterDevelopment(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if first.RegisteredAppSubject == "" || first.RegisteredAppSubject == first.AppID || first.RegistrationHandle == first.RegisteredAppSubject {
		t.Fatalf("registration identities are not opaque and separate: %+v", first)
	}
	if first.SourceGeneration != 1 || first.DeclarationGeneration != 1 {
		t.Fatalf("initial generations = (%d,%d)", first.SourceGeneration, first.DeclarationGeneration)
	}
	if len(first.RawDeclaration) != 2 || len(first.ActivatedDomains) != 1 || first.ActivatedDomains[0] != "realm.data" {
		t.Fatalf("declaration resolution = raw:%v activated:%v", first.RawDeclaration, first.ActivatedDomains)
	}

	same, err := kernel.Registrations().RegisterDevelopment(ctx, base)
	if err != nil || same.RegisteredAppSubject != first.RegisteredAppSubject || same.SourceGeneration != 1 || same.DeclarationGeneration != 1 {
		t.Fatalf("stable registration = (%+v, %v)", same, err)
	}
	sourceChanged := base
	sourceChanged.SourceDigest = "source:two"
	sourceChanged.PayloadRootDigest = "payload:two"
	next, err := kernel.Registrations().RegisterDevelopment(ctx, sourceChanged)
	if err != nil || next.SourceGeneration != 2 || next.DeclarationGeneration != 1 {
		t.Fatalf("source generation = (%+v, %v)", next, err)
	}
	declarationChanged := sourceChanged
	declarationChanged.RawDeclaration = []string{"agent.local"}
	next, err = kernel.Registrations().RegisterDevelopment(ctx, declarationChanged)
	if err != nil || next.SourceGeneration != 2 || next.DeclarationGeneration != 2 {
		t.Fatalf("declaration generation = (%+v, %v)", next, err)
	}

	if err := kernel.Registrations().Tombstone(ctx, first.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	replacement, err := kernel.Registrations().RegisterDevelopment(ctx, declarationChanged)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.RegisteredAppSubject == first.RegisteredAppSubject || replacement.RegistrationHandle == first.RegistrationHandle {
		t.Fatal("tombstoned registration identity was reused")
	}
}

func TestRegistrationStoreFailsClosedAcrossOSUserPartition(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "registered-app.db")
	first, _ := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	kernel, err := OpenSQLite(ctx, path, first, Options{})
	if err != nil {
		t.Fatal(err)
	}
	_ = kernel.Close()
	second, _ := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1002")
	if _, err := OpenSQLite(ctx, path, second, Options{}); !errors.Is(err, ErrPartitionMismatch) {
		t.Fatalf("partition error = %v", err)
	}
}
