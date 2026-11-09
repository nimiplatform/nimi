package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"slices"
	"testing"
)

func TestRemoteRegistrationRetainsSubjectAndDoesNotInventNativeFacts(t *testing.T) {
	ctx := context.Background()
	root := t.TempDir()
	identity := mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001")
	kernel := openTestKernel(t, filepath.Join(root, "registered-app.db"), identity, "install-one", 0x31)
	defer func() { _ = kernel.Close() }()
	input := RegisterRemoteInput{AppID: "publisher.editor", DisplayName: "Editor", RealmEnvironmentID: "realm-one", ClientID: "publisher.editor.web",
		Origin: "https://editor.test", RedirectURI: "https://editor.test/callback", Role: "app", SourceRevision: 1,
		RawDeclaration: []string{"runtime.consume", "future.domain"}, CapabilityContractRefs: []string{"text.generate"}}
	first, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if first.SourceClass != SourceClassRemote || first.RegisteredAppSubject == "" || first.RegisteredAppSubject == input.AppID {
		t.Fatal("missing distinct registered subject")
	}
	if first.ProjectRoot != "" || first.ManifestPath != "" || first.HostExecutableDigest != "" || first.ImmutablePackageFactsComplete() || first.IsPlatformSourceDevelopment() {
		t.Fatal("remote registration invented local package or process facts")
	}
	if !slices.Equal(first.ActivatedDomains, []string{"runtime.consume"}) {
		t.Fatal("unknown domain activated")
	}
	input.ExistingRegistrationHandle = first.RegistrationHandle
	again, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil || again.RegisteredAppSubject != first.RegisteredAppSubject || again.SourceGeneration != 1 {
		t.Fatal("reconnect changed canonical identity", err)
	}
	changed := input
	changed.Origin = "https://new-editor.test"
	if _, err = kernel.Registrations().RegisterRemote(ctx, changed); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("source changed without revision", err)
	}
	changed.SourceRevision = 2
	changed.RedirectURI = "https://new-editor.test/callback"
	changed.RawDeclaration = []string{"runtime.consume", "integration.consume"}
	next, err := kernel.Registrations().RegisterRemote(ctx, changed)
	if err != nil || next.RegisteredAppSubject != first.RegisteredAppSubject || next.SourceGeneration != 2 || next.DeclarationGeneration != 2 {
		t.Fatal("new revision did not preserve subject and advance generations", err)
	}
	if _, err = kernel.Registrations().RegisterRemote(ctx, input); !errors.Is(err, ErrRevisionConflict) {
		t.Fatal("stale source revision accepted", err)
	}
	source, err := kernel.Registrations().RemoteSource(ctx, first.RegistrationHandle)
	if err != nil || source.Origin != changed.Origin || source.SourceRevision != 2 {
		t.Fatal("remote source was not persisted", err)
	}
	// As for existing native sources, identity facts alone never select a handle.
	changed.ExistingRegistrationHandle = ""
	separate, err := kernel.Registrations().RegisterRemote(ctx, changed)
	if err != nil || separate.RegisteredAppSubject == first.RegisteredAppSubject {
		t.Fatal("raw client identity reopened another registration", err)
	}
}

func TestRemoteRegistrationTransactionAndActivationGeneration(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x32)
	defer func() { _ = kernel.Close() }()
	input := RegisterRemoteInput{AppID: "publisher.editor", DisplayName: "Editor", RealmEnvironmentID: "realm-one", ClientID: "publisher.editor.web",
		Origin: "https://editor.test", RedirectURI: "https://editor.test/callback", Role: "app", SourceRevision: 1, RawDeclaration: []string{"runtime.consume"}}
	kernel.beforeCommit = func() error { return errors.New("storage unavailable") }
	if _, err := kernel.Registrations().RegisterRemote(ctx, input); err == nil {
		t.Fatal("failed commit reported success")
	}
	var rows int
	if err := kernel.db.QueryRow("SELECT count(*) FROM canonical_registration").Scan(&rows); err != nil || rows != 0 {
		t.Fatal("failed source persisted half a registration", err)
	}
	kernel.beforeCommit = nil
	first, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	// Persisted inactive coverage from an earlier supported vocabulary must
	// remain inactive until a source/declaration generation actually changes.
	if _, err = kernel.db.Exec(`UPDATE canonical_registration SET activated_domains_json='[]' WHERE registration_handle=?`, first.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	input.ExistingRegistrationHandle = first.RegistrationHandle
	again, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil || len(again.ActivatedDomains) != 0 {
		t.Fatal("unchanged source gained a newly supported domain", err)
	}
	input.SourceRevision++
	next, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil || !slices.Equal(next.ActivatedDomains, []string{"runtime.consume"}) {
		t.Fatal("new source generation did not resolve coverage", err)
	}
}
