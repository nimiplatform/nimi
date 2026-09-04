package localappkernel

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestCanonicalRegistrationDatabasePathAndHostInstallIDAreRequired(t *testing.T) {
	root := t.TempDir()
	path, err := CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(root, "apps", "local-app-kernel.db"); path != want {
		t.Fatalf("database path = %q, want %q", path, want)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	if _, err := OpenSQLite(context.Background(), path, identity, Options{}); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("missing host install ID = %v", err)
	}
}

func TestSourceClassUsesCanonicalLifecycleVocabulary(t *testing.T) {
	if SourceClassVerified != "verified" || SourceClassLocalDevelopment != "local_development" {
		t.Fatalf("source classes = (%q, %q)", SourceClassVerified, SourceClassLocalDevelopment)
	}
}

func TestOpenSQLiteRejectsRetiredUserImportedRegistrationSchema(t *testing.T) {
	root := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	retiredSchema := strings.Replace(
		canonicalRegistrationCreateStatement,
		"CHECK(source_class IN ('verified','local_development'))",
		"CHECK(source_class IN ('verified','user_imported','local_development'))",
		1,
	)
	if _, err := database.Exec(retiredSchema); err != nil {
		_ = database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	if _, err := OpenSQLite(context.Background(), databasePath, identity, Options{HostInstallID: "install-one", DataRoot: root}); err == nil || !strings.Contains(err.Error(), "unsupported canonical_registration source-class constraint") {
		t.Fatalf("retired registration schema error = %v", err)
	}
}

func TestOpenSQLiteRejectsRetiredUserImportedPackageSchema(t *testing.T) {
	root := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(canonicalRegistrationCreateStatement); err != nil {
		_ = database.Close()
		t.Fatal(err)
	}
	for _, statement := range packageLifecycleSchemaStatements {
		retiredSchema := strings.Replace(
			statement,
			"CHECK(source_class IN ('verified'))",
			"CHECK(source_class IN ('verified','user_imported'))",
			1,
		)
		if _, err := database.Exec(retiredSchema); err != nil {
			_ = database.Close()
			t.Fatal(err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	if _, err := OpenSQLite(context.Background(), databasePath, identity, Options{HostInstallID: "install-one", DataRoot: root}); err == nil || !strings.Contains(err.Error(), "unsupported app_package_job source-class constraint") {
		t.Fatalf("retired package schema error = %v", err)
	}
}

func TestOpenSQLiteRejectsRetiredReadingLocalPackagePhase(t *testing.T) {
	root := t.TempDir()
	databasePath, err := CanonicalRegistrationDatabasePath(root)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Dir(databasePath), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", "file:"+filepath.ToSlash(databasePath))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(canonicalRegistrationCreateStatement); err != nil {
		_ = database.Close()
		t.Fatal(err)
	}
	for _, statement := range packageLifecycleSchemaStatements {
		retiredSchema := strings.Replace(
			statement,
			"CHECK(phase IN ('queued','downloading','verifying'",
			"CHECK(phase IN ('queued','downloading','reading-local','verifying'",
			1,
		)
		if _, err := database.Exec(retiredSchema); err != nil {
			_ = database.Close()
			t.Fatal(err)
		}
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	if _, err := OpenSQLite(context.Background(), databasePath, identity, Options{HostInstallID: "install-one", DataRoot: root}); err == nil || !strings.Contains(err.Error(), "unsupported app_package_job phase constraint") {
		t.Fatalf("retired package phase schema error = %v", err)
	}
}

func TestDevelopmentRegistrationUsesOnlyExactHandleForMutation(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x11)
	defer func() { _ = kernel.Close() }()
	base := developmentInput()
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
	if first.ImmutableLineageID != "" || len(first.ProvenanceAttestationRefs) != 0 || first.ProvenanceRevision != 0 || first.ExecutionProfileRef != "" || first.PayloadRootDigest != "" {
		t.Fatalf("mutable development persisted host/payload evidence in canonical state: %+v", first)
	}

	// Repeating App/source/path facts without the exact handle is a genuinely
	// new registration; none of those raw facts selects the existing subject.
	second, err := kernel.Registrations().RegisterDevelopment(ctx, base)
	if err != nil {
		t.Fatal(err)
	}
	if second.RegistrationHandle == first.RegistrationHandle || second.RegisteredAppSubject == first.RegisteredAppSubject {
		t.Fatal("raw App/source/path facts reopened an existing registration")
	}

	updatedInput := base
	updatedInput.ExistingRegistrationHandle = first.RegistrationHandle
	updatedInput.HostExecutableDigest = "host:two"
	updatedInput.RawDeclaration = []string{"agent.local"}
	updated, err := kernel.Registrations().RegisterDevelopment(ctx, updatedInput)
	if err != nil {
		t.Fatal(err)
	}
	if updated.RegistrationHandle != first.RegistrationHandle || updated.RegisteredAppSubject != first.RegisteredAppSubject ||
		updated.SourceGeneration != 2 || updated.DeclarationGeneration != 2 {
		t.Fatalf("exact-handle mutation = %+v", updated)
	}
	if updated.ImmutableLineageID != "" || len(updated.ProvenanceAttestationRefs) != 0 || updated.ProvenanceRevision != 0 || updated.ExecutionProfileRef != "" || updated.PayloadRootDigest != "" {
		t.Fatalf("development refresh persisted host/payload evidence in canonical state: %+v", updated)
	}

	wrong := updatedInput
	wrong.SourceRef = "project-file:other"
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, wrong); !errors.Is(err, ErrStateConflict) {
		t.Fatalf("exact handle with conflicting canonical identity = %v", err)
	}
}

func TestInstalledBindingSlotReopensOnlyCurrentHost(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "registered-app.db")
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	firstKernel := openTestKernel(t, path, identity, "install-one", 0x21)
	input := installedInput()
	input.BindingSlot = "first-party-profile:desktop"
	first, err := firstKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := firstKernel.Close(); err != nil {
		t.Fatal(err)
	}

	reopened := openTestKernel(t, path, identity, "install-one", 0x31)
	defer func() { _ = reopened.Close() }()
	got, err := reopened.Registrations().GetActiveByBindingSlot(ctx, input.BindingSlot)
	if err != nil || got.RegistrationHandle != first.RegistrationHandle || got.RegisteredAppSubject != first.RegisteredAppSubject {
		t.Fatalf("same-host binding slot reopen = (%+v, %v)", got, err)
	}
	refresh := input
	refresh.ExistingRegistrationHandle = got.RegistrationHandle
	refresh.ImmutableLineageID = "lineage:installed:two"
	refresh.ProvenanceRevision = 2
	updated, err := reopened.Registrations().RegisterInstalled(ctx, refresh)
	if err != nil {
		t.Fatal(err)
	}
	if updated.RegisteredAppSubject != first.RegisteredAppSubject || updated.SourceGeneration != 2 {
		t.Fatalf("installed exact-handle refresh = %+v", updated)
	}
}

func TestSameHostCopiedRootRebasesDataRootRelativeBindingLocators(t *testing.T) {
	ctx := context.Background()
	rootOne := filepath.Join(t.TempDir(), "root-one")
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	firstKernel := openTestKernelAtDataRoot(t, rootOne, identity, "install-one", 0x24)
	input := developmentInput()
	input.ProjectRoot = filepath.Join(rootOne, "projects", "example")
	input.ManifestPath = filepath.Join(input.ProjectRoot, "nimi.app.yaml")
	if err := os.MkdirAll(input.ProjectRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(input.ManifestPath, []byte("app_id: nimi.example\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	registered, err := firstKernel.Registrations().RegisterDevelopment(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	var storedProject, storedManifest string
	if err := firstKernel.db.QueryRow(`SELECT project_root, manifest_path FROM current_host_binding WHERE registration_handle = ?`, registered.RegistrationHandle).Scan(&storedProject, &storedManifest); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(storedProject, dataRootRelativeLocatorPrefix) || !strings.HasPrefix(storedManifest, dataRootRelativeLocatorPrefix) || strings.Contains(storedProject, rootOne) || strings.Contains(storedManifest, rootOne) {
		t.Fatalf("binding locators are not root-relative: project=%q manifest=%q", storedProject, storedManifest)
	}
	if err := firstKernel.Close(); err != nil {
		t.Fatal(err)
	}

	rootTwo := filepath.Join(t.TempDir(), "root-two")
	if err := os.CopyFS(rootTwo, os.DirFS(rootOne)); err != nil {
		t.Fatal(err)
	}
	reopened := openTestKernelAtDataRoot(t, rootTwo, identity, "install-one", 0x25)
	defer func() { _ = reopened.Close() }()
	got, err := reopened.Registrations().GetActiveByHandle(ctx, registered.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	if got.ProjectRoot != filepath.Join(rootTwo, "projects", "example") || got.ManifestPath != filepath.Join(rootTwo, "projects", "example", "nimi.app.yaml") || strings.Contains(got.ProjectRoot, rootOne) || strings.Contains(got.ManifestPath, rootOne) {
		t.Fatalf("copied-root binding did not rebase: %+v", got)
	}
	listed, err := reopened.Registrations().ListDevelopment(ctx)
	if err != nil || len(listed) != 1 || listed[0].ProjectRoot != got.ProjectRoot || listed[0].ManifestPath != got.ManifestPath {
		t.Fatalf("copied-root development list = %+v err=%v", listed, err)
	}
	if _, err := reopened.db.Exec(`UPDATE current_host_binding SET project_root = ? WHERE registration_handle = ?`, dataRootRelativeLocatorPrefix+"../escape", registered.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	if _, err := reopened.Registrations().GetActiveByHandle(ctx, registered.RegistrationHandle); !errors.Is(err, ErrInvalidArgument) {
		t.Fatalf("escaping root-relative locator did not fail closed: %v", err)
	}
}

func TestSameMacUserNewAuditSessionReopensSameHostBinding(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "registered-app.db")
	firstIdentity, err := ValidateVerifiedMacOSInteractiveUser(501, 10)
	if err != nil {
		t.Fatal(err)
	}
	secondIdentity, err := ValidateVerifiedMacOSInteractiveUser(501, 20)
	if err != nil {
		t.Fatal(err)
	}
	firstAnchor, _ := firstIdentity.LocalOSUserAnchor()
	secondAnchor, _ := secondIdentity.LocalOSUserAnchor()
	if firstAnchor != secondAnchor {
		t.Fatalf("audit session leaked into stable macOS scope: %q != %q", firstAnchor, secondAnchor)
	}
	firstKernel := openTestKernel(t, path, firstIdentity, "mac-install", 0x41)
	input := installedInput()
	input.BindingSlot = "first-party-profile:desktop"
	registered, err := firstKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	_ = firstKernel.Close()
	reopened := openTestKernel(t, path, secondIdentity, "mac-install", 0x51)
	defer func() { _ = reopened.Close() }()
	got, err := reopened.Registrations().GetActiveByBindingSlot(ctx, input.BindingSlot)
	if err != nil || got.RegistrationHandle != registered.RegistrationHandle {
		t.Fatalf("same macOS user new session reopen = (%+v, %v)", got, err)
	}
}

func TestSameWindowsSIDWithDifferentInstallIDDoesNotActivateCopiedCanonical(t *testing.T) {
	ctx := context.Background()
	path := filepath.Join(t.TempDir(), "registered-app.db")
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	firstKernel := openTestKernel(t, path, identity, "install-one", 0x61)
	input := installedInput()
	input.BindingSlot = "first-party-profile:desktop"
	first, err := firstKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	_ = firstKernel.Close()

	secondKernel := openTestKernel(t, path, identity, "install-two", 0x71)
	defer func() { _ = secondKernel.Close() }()
	status, err := secondKernel.Registrations().Status(ctx, first.RegistrationHandle)
	if err != nil || status.CurrentHostBound || status.Available || status.State != RegistrationStateActive {
		t.Fatalf("copied canonical status = (%+v, %v)", status, err)
	}
	if _, err := secondKernel.Registrations().GetActiveByHandle(ctx, first.RegistrationHandle); !errors.Is(err, ErrRegistrationUnavailable) {
		t.Fatalf("copied canonical exact-handle activation = %v", err)
	}
	if _, err := secondKernel.Registrations().GetActiveByBindingSlot(ctx, input.BindingSlot); !errors.Is(err, ErrNotFound) {
		t.Fatalf("copied host binding slot = %v", err)
	}

	second, err := secondKernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if second.RegistrationHandle == first.RegistrationHandle || second.RegisteredAppSubject == first.RegisteredAppSubject {
		t.Fatalf("new host rebound copied identity: first=%+v second=%+v", first, second)
	}
	statuses, err := secondKernel.Registrations().ListStatuses(ctx)
	if err != nil || len(statuses) != 2 {
		t.Fatalf("statuses = (%+v, %v)", statuses, err)
	}
	available := 0
	for _, item := range statuses {
		if item.Available {
			available++
		}
	}
	if available != 1 {
		t.Fatalf("available registrations = %d, statuses=%+v", available, statuses)
	}
}

func TestCurrentHostBindingDoesNotCopyCanonicalIdentityOrLifecycle(t *testing.T) {
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x81)
	defer func() { _ = kernel.Close() }()
	rows, err := kernel.db.Query(`PRAGMA table_info(current_host_binding)`)
	if err != nil {
		t.Fatal(err)
	}
	columns := make(map[string]bool)
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, kind string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &kind, &notNull, &defaultValue, &primaryKey); err != nil {
			t.Fatal(err)
		}
		columns[name] = true
	}
	_ = rows.Close()
	for _, forbidden := range []string{
		"registered_app_subject", "app_id", "source_class", "source_ref", "source_generation",
		"declaration_generation", "immutable_lineage_id", "provenance_attestation_refs_json",
		"provenance_revision", "execution_profile_ref", "declaration_digest", "state", "tombstoned_unix_nano",
	} {
		if columns[forbidden] {
			t.Fatalf("current-host binding copied canonical field %q", forbidden)
		}
	}
	want := []string{"host_install_id", "local_os_user_scope", "registration_handle", "binding_slot", "project_root", "manifest_path", "host_executable_digest", "payload_root_digest", "created_unix_nano", "updated_unix_nano"}
	for _, required := range want {
		if !columns[required] {
			t.Fatalf("current-host binding missing field %q", required)
		}
	}
}

func TestCanonicalAndBindingMutationRollBackTogether(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x91)
	defer func() { _ = kernel.Close() }()
	injected := errors.New("injected before commit")
	kernel.beforeCommit = func() error { return injected }
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput()); !errors.Is(err, injected) {
		t.Fatalf("injected create failure = %v", err)
	}
	assertTableCount(t, kernel, "canonical_registration", 0)
	assertTableCount(t, kernel, "current_host_binding", 0)

	kernel.beforeCommit = nil
	created, err := kernel.Registrations().RegisterDevelopment(ctx, developmentInput())
	if err != nil {
		t.Fatal(err)
	}
	original, err := kernel.Registrations().GetActiveByHandle(ctx, created.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	update := developmentInput()
	update.ExistingRegistrationHandle = created.RegistrationHandle
	update.HostExecutableDigest = "host:changed"
	kernel.beforeCommit = func() error { return injected }
	if _, err := kernel.Registrations().RegisterDevelopment(ctx, update); !errors.Is(err, injected) {
		t.Fatalf("injected update failure = %v", err)
	}
	after, err := kernel.Registrations().GetActiveByHandle(ctx, created.RegistrationHandle)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(after, original) {
		t.Fatalf("failed transaction changed registration:\nbefore=%+v\nafter=%+v", original, after)
	}
	kernel.beforeCommit = func() error { return injected }
	if err := kernel.Registrations().Tombstone(ctx, created.RegistrationHandle); !errors.Is(err, injected) {
		t.Fatalf("injected tombstone failure = %v", err)
	}
	if _, err := kernel.Registrations().GetActiveByHandle(ctx, created.RegistrationHandle); err != nil {
		t.Fatalf("failed tombstone changed lifecycle: %v", err)
	}
}

func TestTombstoneIsPermanentAndReleasesCurrentHostBindingSlot(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"),
		mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0xa1)
	defer func() { _ = kernel.Close() }()
	input := installedInput()
	input.BindingSlot = "first-party-profile:desktop"
	first, err := kernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err := kernel.Registrations().Tombstone(ctx, first.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	if _, err := kernel.Registrations().GetActiveByHandle(ctx, first.RegistrationHandle); !errors.Is(err, ErrRegistrationTombstoned) {
		t.Fatalf("tombstoned exact handle = %v", err)
	}
	status, err := kernel.Registrations().Status(ctx, first.RegistrationHandle)
	if err != nil || status.State != RegistrationStateTombstoned || status.Available {
		t.Fatalf("tombstoned status = (%+v, %v)", status, err)
	}
	replacement, err := kernel.Registrations().RegisterInstalled(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if replacement.RegistrationHandle == first.RegistrationHandle || replacement.RegisteredAppSubject == first.RegisteredAppSubject {
		t.Fatal("tombstoned identity was reused")
	}
	bySlot, err := kernel.Registrations().GetActiveByBindingSlot(ctx, input.BindingSlot)
	if err != nil || bySlot.RegistrationHandle != replacement.RegistrationHandle {
		t.Fatalf("replacement binding slot = (%+v, %v)", bySlot, err)
	}
}

func openTestKernel(t *testing.T, path string, identity VerifiedLocalOSUserIdentity, installID string, entropyByte byte) *Kernel {
	t.Helper()
	return openTestKernelAtDataRoot(t, path+"-data-root", identity, installID, entropyByte)
}

func openTestKernelAtDataRoot(t *testing.T, dataRoot string, identity VerifiedLocalOSUserIdentity, installID string, entropyByte byte) *Kernel {
	t.Helper()
	canonicalPath, err := CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	entropy := make([]byte, 32*64)
	for block := 0; block < 64; block++ {
		value := entropyByte + byte(block)
		if value == 0 {
			value = 1
		}
		for index := block * 32; index < (block+1)*32; index++ {
			entropy[index] = value
		}
	}
	kernel, err := OpenSQLite(context.Background(), canonicalPath, identity, Options{
		HostInstallID: installID,
		DataRoot:      dataRoot,
		Random:        bytes.NewReader(entropy),
		Now:           func() time.Time { return time.Date(2026, 8, 30, 12, 0, 0, 0, time.UTC) },
	})
	if err != nil {
		t.Fatal(err)
	}
	return kernel
}

func mustWindowsIdentity(t *testing.T, sid string) VerifiedLocalOSUserIdentity {
	t.Helper()
	identity, err := ValidateVerifiedWindowsInteractiveUserSID(sid)
	if err != nil {
		t.Fatal(err)
	}
	return identity
}

func developmentInput() RegisterDevelopmentInput {
	return RegisterDevelopmentInput{
		AppID: "nimi.example", DisplayName: "Example", SourceRef: "project-file:one",
		ProjectRoot: "/projects/example", ManifestPath: "/projects/example/nimi.app.yaml", ShellKind: 1,
		RawDeclaration:       []string{"realm.data", "future.domain"},
		HostExecutableDigest: "host:one",
	}
}

func installedInput() RegisterInstalledInput {
	return RegisterInstalledInput{
		AppID: "nimi.desktop", DisplayName: "Nimi Desktop", SourceRef: "formal-release:nimi.desktop",
		ProjectRoot: "C:/Program Files/Nimi/Nimi.exe", ManifestPath: "formal-release-manifest:nimi.desktop",
		ShellKind: 1, RawDeclaration: []string{"runtime.consume", "agent.local"}, SourceClass: SourceClassVerified,
		ImmutableLineageID: "lineage:installed:one", ProvenanceAttestationRefs: []string{"attestation:installed:one"},
		ProvenanceRevision: 1, ExecutionProfileRef: "execution:installed:one",
		HostExecutableDigest: "host:installed:one", PayloadRootDigest: "payload:installed:one",
	}
}

func assertTableCount(t *testing.T, kernel *Kernel, table string, want int) {
	t.Helper()
	var got int
	if err := kernel.db.QueryRow(`SELECT COUNT(*) FROM ` + table).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("%s count = %d, want %d", table, got, want)
	}
}
