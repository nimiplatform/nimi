package localappkernel

import (
	"context"
	"errors"
	"path/filepath"
	"testing"
)

func TestRemoteAccessIsPerOwnerBindingAndSourceWithoutDeviceApproval(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x33)
	defer func() { _ = kernel.Close() }()
	store := kernel.RemoteAccess()
	scope := RemoteAccessScope{RealmEnvironmentID: "realm-one", AccountID: "account-a", BindingID: "binding-one"}
	settings, err := store.Settings(ctx, scope.RealmEnvironmentID, scope.AccountID)
	if err != nil || settings.Enabled || settings.BindingID != "" {
		t.Fatal("remote access was enabled by default", err)
	}
	if err = store.SetEnabled(ctx, scope, true); err != nil {
		t.Fatal(err)
	}
	input := RegisterRemoteInput{AppID: "publisher.editor", DisplayName: "Editor", RealmEnvironmentID: scope.RealmEnvironmentID, ClientID: "publisher.editor.web",
		Origin: "https://editor.test", RedirectURI: "https://editor.test/callback", Role: "app", SourceRevision: 1, RawDeclaration: []string{"runtime.consume"}}
	registration, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.Source(ctx, scope, input.ClientID); !errors.Is(err, ErrNotFound) {
		t.Fatal("registration created source approval", err)
	}
	if err = store.ConfirmSource(ctx, scope, registration.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	for range 2 { // Another connection uses the same source relation, with no device key.
		access, err := store.Source(ctx, scope, input.ClientID)
		if err != nil || access.Paused || access.ApprovedRevision != 1 || access.RegistrationHandle != registration.RegistrationHandle {
			t.Fatal("confirmed source not reusable", err)
		}
	}
	other := scope
	other.AccountID = "account-b"
	if _, err = store.Source(ctx, other, input.ClientID); !errors.Is(err, ErrNotFound) {
		t.Fatal("another account inherited confirmation", err)
	}
	replacement := scope
	replacement.BindingID = "binding-two"
	if _, err = store.Source(ctx, replacement, input.ClientID); !errors.Is(err, ErrNotFound) {
		t.Fatal("new primary inherited confirmation", err)
	}
	if err = store.SetPaused(ctx, scope, input.ClientID, true); err != nil {
		t.Fatal(err)
	}
	paused, err := store.Source(ctx, scope, input.ClientID)
	if err != nil || !paused.Paused {
		t.Fatal("pause not recorded", err)
	}
	retained, err := kernel.Registrations().GetActiveByHandle(ctx, registration.RegistrationHandle)
	if err != nil || retained.RegisteredAppSubject != registration.RegisteredAppSubject {
		t.Fatal("pause deleted registration", err)
	}
	if err = store.SetPaused(ctx, scope, input.ClientID, false); err != nil {
		t.Fatal(err)
	}
	input.ExistingRegistrationHandle = registration.RegistrationHandle
	input.SourceRevision = 2
	input.RawDeclaration = []string{"runtime.consume", "integration.consume"}
	if _, err = kernel.Registrations().RegisterRemote(ctx, input); err != nil {
		t.Fatal(err)
	}
	old, err := store.Source(ctx, scope, input.ClientID)
	if err != nil || old.ApprovedRevision != 1 {
		t.Fatal("source revision silently enlarged confirmation", err)
	}
	if err = store.ConfirmSource(ctx, scope, registration.RegistrationHandle); err != nil {
		t.Fatal(err)
	}
	current, err := store.Source(ctx, scope, input.ClientID)
	if err != nil || current.ApprovedRevision != 2 {
		t.Fatal("new revision confirmation missing", err)
	}
	input.ExistingRegistrationHandle = ""
	duplicate, err := kernel.Registrations().RegisterRemote(ctx, input)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.ConfirmSource(ctx, scope, duplicate.RegistrationHandle); !errors.Is(err, ErrStateConflict) {
		t.Fatal("identity facts replaced the retained subject", err)
	}
	if err = store.SetEnabled(ctx, scope, false); err != nil {
		t.Fatal(err)
	}
	entries, err := store.Sources(ctx, scope)
	if err != nil || len(entries) != 1 {
		t.Fatal("disabling remote access removed a source relation", err)
	}
}

func TestRemoteConfirmationCommitsSourceAndApprovalTogether(t *testing.T) {
	ctx := context.Background()
	kernel := openTestKernel(t, filepath.Join(t.TempDir(), "registered-app.db"), mustWindowsIdentity(t, "S-1-5-21-100-200-300-1001"), "install-one", 0x34)
	defer func() { _ = kernel.Close() }()
	scope := RemoteAccessScope{RealmEnvironmentID: "realm-one", AccountID: "account-a", BindingID: "binding-one"}
	input := RegisterRemoteInput{AppID: "publisher.editor", DisplayName: "Editor", RealmEnvironmentID: scope.RealmEnvironmentID,
		ClientID: "publisher.editor.web", Origin: "https://editor.test", RedirectURI: "https://editor.test/callback",
		Role: "app", SourceRevision: 1, RawDeclaration: []string{"runtime.consume"}}
	fail := errors.New("disk commit unavailable")
	kernel.beforeCommit = func() error { return fail }
	if err := kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); !errors.Is(err, fail) {
		t.Fatal("failed confirmation reported success", err)
	}
	for _, table := range []string{"canonical_registration", "remote_app_source", "remote_source_access"} {
		var rows int
		if err := kernel.db.QueryRow("SELECT count(*) FROM " + table).Scan(&rows); err != nil || rows != 0 {
			t.Fatal("partial confirmation persisted", table, rows, err)
		}
	}
	kernel.beforeCommit = nil
	if err := kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); err != nil {
		t.Fatal(err)
	}
	first, err := kernel.RemoteAccess().Source(ctx, scope, input.ClientID)
	if err != nil {
		t.Fatal(err)
	}
	input.SourceRevision = 2
	input.RawDeclaration = []string{"runtime.consume", "integration.consume"}
	kernel.beforeCommit = func() error { return fail }
	if err = kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); !errors.Is(err, fail) {
		t.Fatal(err)
	}
	registration, err := kernel.Registrations().GetActiveByHandle(ctx, first.RegistrationHandle)
	if err != nil || registration.SourceGeneration != 1 || registration.DeclarationGeneration != 1 {
		t.Fatal("failed approval advanced registration generation", err)
	}
	kernel.beforeCommit = nil
	if err = kernel.RemoteAccess().ConfirmRegistration(ctx, scope, input); err != nil {
		t.Fatal(err)
	}
	updated, err := kernel.RemoteAccess().Source(ctx, scope, input.ClientID)
	if err != nil || updated.RegistrationHandle != first.RegistrationHandle || updated.ApprovedRevision != 2 {
		t.Fatal("reconfirmation did not retain the subject and advance approval", err)
	}
}
