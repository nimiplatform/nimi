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
	entropy = append(entropy, bytes.Repeat([]byte{0x55}, 32)...)
	entropy = append(entropy, bytes.Repeat([]byte{0x66}, 32)...)
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
	resolved, err := kernel.Registrations().GetActiveByAppID(ctx, base.AppID)
	if err != nil || resolved.RegisteredAppSubject != first.RegisteredAppSubject {
		t.Fatalf("active App owner = (%+v, %v)", resolved, err)
	}
	conflicting := base
	conflicting.SourceRef = "project-file:two"
	conflicting.ProjectRoot = "/projects/other"
	conflicting.ManifestPath = "/projects/other/nimi.app.yaml"
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, conflicting); err == nil {
		t.Fatal("duplicate active App owner was admitted")
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
	if _, err := kernel.Registrations().GetActiveByAppID(ctx, base.AppID); !errors.Is(err, ErrNotFound) {
		t.Fatalf("tombstoned App owner lookup = %v", err)
	}
	replacement, err := kernel.Registrations().RegisterDevelopment(ctx, declarationChanged)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.RegisteredAppSubject == first.RegisteredAppSubject || replacement.RegistrationHandle == first.RegistrationHandle {
		t.Fatal("tombstoned registration identity was reused")
	}
}

func TestInstalledRegistrationSubjectPersistsAcrossReleaseRefresh(t *testing.T) {
	ctx := context.Background()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatal(err)
	}
	databasePath := filepath.Join(t.TempDir(), "registered-app.db")
	input := RegisterInstalledInput{
		AppID: "nimi.desktop", DisplayName: "Nimi Desktop", SourceRef: "platform-app:nimi.desktop",
		ProjectRoot: "C:/Program Files/Nimi/Nimi.exe", ManifestPath: "platform-app-identity:nimi.desktop",
		ShellKind: 1, RawDeclaration: []string{"runtime.consume", "agent.local", "agent.configure"},
		SourceDigest: "source:desktop", HostExecutableDigest: "host:desktop", PayloadRootDigest: "payload:desktop",
	}
	firstKernel, err := OpenSQLite(ctx, databasePath, identity, Options{Random: bytes.NewReader(bytes.Repeat([]byte{0x91}, 128))})
	if err != nil {
		t.Fatal(err)
	}
	first, err := firstKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := firstKernel.Close(); err != nil {
		t.Fatal(err)
	}

	secondKernel, err := OpenSQLite(ctx, databasePath, identity, Options{Random: bytes.NewReader(bytes.Repeat([]byte{0xa1}, 128))})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = secondKernel.Close() }()
	release := input
	release.SourceDigest = "source:desktop:next"
	release.PayloadRootDigest = "payload:desktop:next"
	second, err := secondKernel.Registrations().RegisterInstalled(ctx, release)
	if err != nil {
		t.Fatal(err)
	}
	if second.RegisteredAppSubject != first.RegisteredAppSubject || second.RegistrationHandle != first.RegistrationHandle ||
		second.SourceGeneration != first.SourceGeneration+1 || second.DeclarationGeneration != first.DeclarationGeneration ||
		second.SourceRef != input.SourceRef {
		t.Fatalf("installed registration identity changed across release refresh: first=%+v second=%+v", first, second)
	}
	stable, err := secondKernel.Registrations().RegisterInstalled(ctx, release)
	if err != nil || stable.RegisteredAppSubject != second.RegisteredAppSubject || stable.SourceGeneration != second.SourceGeneration {
		t.Fatalf("refreshed installed registration was not stable: second=%+v stable=%+v err=%v", second, stable, err)
	}
	conflicting := release
	conflicting.SourceRef = "platform-app-release:nimi.desktop"
	if _, err := secondKernel.Registrations().RegisterInstalled(ctx, conflicting); !errors.Is(err, ErrStateConflict) {
		t.Fatalf("installed source identity replacement = %v", err)
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
