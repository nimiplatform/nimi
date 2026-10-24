//go:build windows

package app

import (
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const runInputManifest = "app_id: nimi.test.session\ndisplay_name: Session Test\napp_access: []\n"

func writeRunInputProject(t *testing.T, root string, manifest string) {
	t.Helper()
	host := localDevelopmentProjectHostAliasPath(root, runtimev1.LocalDevelopmentShellKind_LOCAL_DEVELOPMENT_SHELL_KIND_ELECTRON)
	if err := os.MkdirAll(filepath.Dir(host), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(host, []byte("component-test host witness"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nimi.app.yaml"), []byte(manifest), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestSourceRunAccessReadsDiskDeclarationBeforeReusingScope(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	writeRunInputProject(t, root, runInputManifest)
	f, ctx, req := bindRunAccessFixture(t, newLocalAppSessionFixtureAtProject(t, nil, root, WithPerUserRuntimeRebind(true)))
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	first, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !first.Available {
		t.Fatalf("initial scope: %v %v", first, err)
	}
	// Metadata-only edits are not a new declaration or an excuse to reset work.
	if err := os.WriteFile(f.registration.ManifestPath, []byte(runInputManifest+"# edited comment\n"), 0600); err != nil {
		t.Fatal(err)
	}
	unchanged, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !unchanged.Available || unchanged.ExecutionScopeRef != first.ExecutionScopeRef {
		t.Fatalf("comment invalidated scope: %v %v", unchanged, err)
	}
	// Do not pre-update the database: this is the missing real filesystem edge.
	changed := "app_id: nimi.test.session\ndisplay_name: Session Test\napp_access: [future.i1.inert]\n"
	if err := os.WriteFile(f.registration.ManifestPath, []byte(changed), 0600); err != nil {
		t.Fatal(err)
	}
	observed, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || observed.Available || observed.ExecutionScopeRef != "" || observed.ReasonCode != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("disk declaration reused old scope: %v %v", observed, err)
	}
	if _, err := f.service.RenewLocalAppSessionProjection(f.context); err == nil {
		t.Fatal("old scope survived declaration drift")
	}
	stored, err := f.kernel.Registrations().GetByHandle(ctx, f.registration.RegistrationHandle)
	if err != nil || stored.DeclarationGeneration != f.registration.DeclarationGeneration {
		t.Fatalf("observation published a registration: %v %v", stored, err)
	}
}

func TestSourceRunAccessUnverifiedInputsDoNotInventRevocation(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	writeRunInputProject(t, root, runInputManifest)
	f, ctx, req := bindRunAccessFixture(t, newLocalAppSessionFixtureAtProject(t, nil, root, WithPerUserRuntimeRebind(true)))
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(f.registration.ManifestPath, []byte("app_access: ["), 0600); err != nil {
		t.Fatal(err)
	}
	observed, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || observed.Available || observed.ExecutionScopeRef != "" || observed.ReasonCode != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("unverified input claimed current/revoked scope: %v %v", observed, err)
	}
	if err := os.WriteFile(f.registration.ManifestPath, []byte(runInputManifest), 0600); err != nil {
		t.Fatal(err)
	}
	restored, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || !restored.Available {
		t.Fatalf("read uncertainty became fabricated revocation: %v %v", restored, err)
	}
}

func TestSourceRunAccessRejectsReplacedProjectDirectory(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "project")
	writeRunInputProject(t, root, runInputManifest)
	f, ctx, req := bindRunAccessFixture(t, newLocalAppSessionFixtureAtProject(t, nil, root, WithPerUserRuntimeRebind(true)))
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	if err := os.Rename(root, filepath.Join(base, "previous-project")); err != nil {
		t.Fatal(err)
	}
	writeRunInputProject(t, root, runInputManifest)
	observed, err := f.service.GetLocalDevelopmentRunAccess(ctx, req)
	if err != nil || observed.Available || observed.ReasonCode != runtimev1.ReasonCode_LOCAL_APP_SESSION_REVOKED {
		t.Fatalf("replacement directory inherited scope: %v %v", observed, err)
	}
}

func TestSourceRunInputObservationRejectsChangedHostAlias(t *testing.T) {
	root := filepath.Join(t.TempDir(), "project")
	writeRunInputProject(t, root, runInputManifest)
	f := newLocalAppSessionFixtureAtProject(t, nil, root)
	current, err := localDevelopmentRunInputsCurrent(f.registration, []string{filepath.Join(root, "previous-electron.exe")})
	if err != nil || current {
		t.Fatalf("changed host alias reused old launch: %v %v", current, err)
	}
}

func TestSourceRunLateInputMismatchCannotInvalidateReplacementScope(t *testing.T) {
	f, owner, request := rebindSessionFixture(t)
	if _, err := f.service.OpenLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	old, _ := f.connection.Session()
	started := make(chan struct{})
	finish := make(chan struct{})
	result := make(chan runtimev1.ReasonCode, 1)
	go func() {
		result <- checkObservedLocalDevelopmentRunInputs([]localDevelopmentObservedScope{{f.connection, old}}, func() (bool, error) {
			close(started)
			<-finish
			return false, nil
		})
	}()
	<-started
	expireRebindSession(f)
	if _, err := f.service.RebindLocalAppSessionProjection(f.context); err != nil {
		t.Fatal(err)
	}
	fresh, _ := f.connection.Session()
	if fresh == old {
		t.Fatal("expected an independently revalidated fresh scope")
	}
	cleaned := false
	if !f.connection.BindSessionResource(fresh, "fresh-work", func() { cleaned = true }) {
		t.Fatal("bind fresh work")
	}
	close(finish)
	if reason := <-result; reason != runtimev1.ReasonCode_LOCAL_APP_OWNER_UNAVAILABLE {
		t.Fatalf("obsolete read claimed current revocation: %v", reason)
	}
	current, err := f.service.GetLocalDevelopmentRunAccess(owner, request)
	if err != nil || !current.Available || cleaned || !f.connection.SessionOwnsResource(fresh, "fresh-work") {
		t.Fatalf("late input check invalidated new work: %v %v cleaned=%v", current, err, cleaned)
	}
}
