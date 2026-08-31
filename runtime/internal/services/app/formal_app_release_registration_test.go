package app

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

type formalAppReleaseResolverFunc func(context.Context, string) (FormalAppRelease, error)

const formalReleaseTestBindingSlot = "formal_release_test_v1"

func (resolve formalAppReleaseResolverFunc) ResolveFormalAppRelease(ctx context.Context, appID string) (FormalAppRelease, error) {
	return resolve(ctx, appID)
}

func TestFormalAppReleaseRegistrationUsesCanonicalDeclarationInput(t *testing.T) {
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 77)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		Random: bytes.NewReader(bytes.Repeat([]byte{0x91}, 1024)), HostInstallID: "formal-release-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	release := FormalAppRelease{
		AppID: "nimi.desktop", DisplayName: "Nimi Desktop", SourceRef: "platform-release:nimi.desktop:1",
		InstallRoot: "C:/Program Files/Nimi", ManifestRef: "platform-release-manifest:nimi.desktop:1", ShellKind: 1,
		Declaration:        []string{"runtime.consume", "agent.local", "future.inert"},
		ImmutableLineageID: "lineage:desktop:1", ProvenanceAttestationRefs: []string{"attestation:desktop:1"},
		ProvenanceRevision: 1, ExecutionProfileRef: "execution:desktop", PayloadRootDigest: "release-payload-digest:desktop:1",
	}
	resolverCalls := 0
	account := newLocalAppSessionTestAccount("account-formal-release", "realm-formal-release")
	service := New(nil,
		WithLocalAppKernel(kernel),
		WithRuntimeAccountProjectionProvider(account),
		WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute),
		WithFormalAppReleaseResolver(formalAppReleaseResolverFunc(func(_ context.Context, appID string) (FormalAppRelease, error) {
			resolverCalls++
			if appID != release.AppID {
				t.Fatalf("resolved app id = %q", appID)
			}
			return release, nil
		})),
	)
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 5101, CreationMarker: "formal-release-start",
		OSLoginSession: "interactive-login", SecurityPrincipal: "interactive-user",
		CanonicalExecutableIdentity: "formal-release-executable",
		ExecutableDigest:            localAppSessionTestIdentifier(0x92),
		ExecutableTrustSetID:        "formal-release",
	}
	registration, err := service.registerFormalAppRelease(ctx, release.AppID, formalReleaseTestBindingSlot, process)
	if err != nil {
		t.Fatal(err)
	}
	if resolverCalls != 1 || registration.AppID != release.AppID || registration.SourceRef != release.SourceRef ||
		registration.ImmutableLineageID != release.ImmutableLineageID ||
		!sameStrings(registration.ProvenanceAttestationRefs, release.ProvenanceAttestationRefs) ||
		registration.ProvenanceRevision != release.ProvenanceRevision || registration.ExecutionProfileRef != release.ExecutionProfileRef ||
		registration.PayloadRootDigest != release.PayloadRootDigest ||
		registration.RegisteredAppSubject == "" || registration.DeclarationGeneration != 1 ||
		!containsAll(registration.ActivatedDomains, "runtime.consume", "agent.local") ||
		containsAll(registration.ActivatedDomains, "future.inert") {
		t.Fatalf("formal App registration = %+v calls=%d", registration, resolverCalls)
	}
	if registration.HostExecutableDigest != protectedExecutableDigestRef(process.ExecutableDigest) {
		t.Fatalf("host witness digest = %q", registration.HostExecutableDigest)
	}
	ownerDone := make(chan struct{})
	connection, err := protectedlocal.EstablishInstalledAppConnection(
		registration.RegistrationHandle,
		protectedlocal.LocalAppTrustBuiltIn,
		localAppSessionTestIdentifier(0x95),
		localAppSessionTestIdentifier(0x96),
		process,
		ownerDone,
	)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(connection.Revoke)
	localCtx := protectedlocal.ContextWithLocalAppConnection(ctx, connection)
	if _, err := service.OpenLocalAppSessionProjection(localCtx); err != nil {
		t.Fatal(err)
	}
	authorized, err := service.AuthorizeLocalAppIngress(localCtx, localappop.IngressAgentReferenceList)
	if err != nil {
		t.Fatal(err)
	}
	decision, ok := accountservice.AuthorizedLocalAppDecisionFromContext(authorized)
	if !ok || decision.AppID != release.AppID || decision.RegisteredAppSubject != registration.RegisteredAppSubject ||
		decision.OperationCapability != "agent.local" || decision.SessionID == (protectedlocal.Identifier{}) ||
		strings.HasPrefix(decision.RegisteredAppSubject, "protected-product:") {
		t.Fatalf("formal App authorization = %+v ok=%v", decision, ok)
	}

	release.ImmutableLineageID = "lineage:desktop:2"
	release.ProvenanceAttestationRefs = []string{"attestation:desktop:2"}
	release.ProvenanceRevision = 2
	nextProcess := process
	nextProcess.ExecutableDigest = localAppSessionTestIdentifier(0x97)
	updated, err := service.registerFormalAppRelease(ctx, release.AppID, formalReleaseTestBindingSlot, nextProcess)
	if err != nil {
		t.Fatal(err)
	}
	if updated.RegistrationHandle != registration.RegistrationHandle || updated.SourceGeneration <= registration.SourceGeneration {
		t.Fatalf("updated formal App registration = %+v, prior = %+v", updated, registration)
	}
	if _, err := service.RenewLocalAppSessionProjection(localCtx); err == nil {
		t.Fatal("old installed executable renewed after the canonical release witness changed")
	}
}

func TestFormalAppReleaseRegistrationFailsClosedWithoutCanonicalInput(t *testing.T) {
	ctx := context.Background()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 78)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		Random: bytes.NewReader(bytes.Repeat([]byte{0x93}, 1024)), HostInstallID: "formal-release-missing-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	process := protectedlocal.ProcessTuple{ExecutableDigest: localAppSessionTestIdentifier(0x94)}
	if _, err := New(nil, WithLocalAppKernel(kernel)).registerFormalAppRelease(ctx, "nimi.avatar", formalReleaseTestBindingSlot, process); !errors.Is(err, errFormalAppReleaseUnavailable) {
		t.Fatalf("missing resolver error = %v", err)
	}
	service := New(nil,
		WithLocalAppKernel(kernel),
		WithFormalAppReleaseResolver(formalAppReleaseResolverFunc(func(context.Context, string) (FormalAppRelease, error) {
			return FormalAppRelease{AppID: "nimi.desktop"}, nil
		})),
	)
	if _, err := service.registerFormalAppRelease(ctx, "nimi.avatar", formalReleaseTestBindingSlot, process); !errors.Is(err, errFormalAppReleaseUnavailable) {
		t.Fatalf("mismatched canonical input error = %v", err)
	}
	if _, err := kernel.Registrations().GetActiveByBindingSlot(ctx, formalReleaseTestBindingSlot); !errors.Is(err, localappkernel.ErrNotFound) {
		t.Fatalf("unexpected registration after failed canonical input: %v", err)
	}
}

func TestManifestFormalAppReleaseResolverUsesManifestDeclarationAndPayload(t *testing.T) {
	root := t.TempDir()
	for _, fixture := range []struct {
		directory string
		manifest  string
	}{
		{directory: "desktop", manifest: "app_id: nimi.desktop\ndisplay_name: Nimi Desktop\napp_access:\n  - runtime.consume\n  - agent.local\n"},
		{directory: "avatar", manifest: "app_id: nimi.avatar\ndisplay_name: Nimi Avatar\napp_access:\n  - agent.local\n  - agent.configure\n"},
	} {
		releaseRoot := filepath.Join(root, fixture.directory)
		if err := os.MkdirAll(releaseRoot, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(releaseRoot, "nimi.app.yaml"), []byte(fixture.manifest), 0o600); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(releaseRoot, "payload.txt"), []byte(fixture.directory), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	resolver, err := NewManifestFormalAppReleaseResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	release, err := resolver.ResolveFormalAppRelease(context.Background(), "nimi.avatar")
	if err != nil {
		t.Fatal(err)
	}
	if release.AppID != "nimi.avatar" || release.DisplayName != "Nimi Avatar" ||
		release.SourceRef != "platform-app:nimi.avatar" || release.ShellKind != 1 ||
		!containsAll(release.Declaration, "agent.local", "agent.configure") ||
		strings.TrimSpace(release.ImmutableLineageID) == "" || len(release.ProvenanceAttestationRefs) == 0 ||
		release.ProvenanceRevision == 0 || strings.TrimSpace(release.ExecutionProfileRef) == "" || strings.TrimSpace(release.PayloadRootDigest) == "" ||
		filepath.Base(release.ManifestRef) != "nimi.app.yaml" || filepath.Base(release.InstallRoot) != "avatar" {
		t.Fatalf("formal manifest release = %+v", release)
	}
	release.Declaration[0] = "mutated"
	again, err := resolver.ResolveFormalAppRelease(context.Background(), "nimi.avatar")
	if err != nil {
		t.Fatal(err)
	}
	if again.Declaration[0] != "agent.local" {
		t.Fatalf("resolver leaked mutable declaration: %+v", again.Declaration)
	}
	if _, err := resolver.ResolveFormalAppRelease(context.Background(), "nimi.missing"); !errors.Is(err, errFormalAppReleaseUnavailable) {
		t.Fatalf("missing formal release error = %v", err)
	}
}

func TestManifestFormalAppReleaseResolverAcceptsShippedDesktopAndAvatarInputs(t *testing.T) {
	root := t.TempDir()
	for _, fixture := range []struct {
		directory string
		appID     string
		source    string
	}{
		{directory: "desktop", appID: "nimi.desktop", source: filepath.Join("..", "..", "..", "..", "apps", "desktop", "nimi.app.yaml")},
		{directory: "avatar", appID: "nimi.avatar", source: filepath.Join("..", "..", "..", "..", "apps", "avatar", "nimi.app.yaml")},
	} {
		raw, err := os.ReadFile(fixture.source)
		if err != nil {
			t.Fatalf("read %s formal App manifest: %v", fixture.appID, err)
		}
		releaseRoot := filepath.Join(root, fixture.directory)
		if err := os.MkdirAll(releaseRoot, 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(releaseRoot, "nimi.app.yaml"), raw, 0o600); err != nil {
			t.Fatal(err)
		}
	}

	resolver, err := NewManifestFormalAppReleaseResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	for _, appID := range []string{"nimi.desktop", "nimi.avatar"} {
		release, err := resolver.ResolveFormalAppRelease(context.Background(), appID)
		if err != nil {
			t.Fatalf("resolve shipped %s release: %v", appID, err)
		}
		if release.AppID != appID || !containsAll(release.Declaration, "realm.data", "runtime.consume", "agent.local", "agent.configure") {
			t.Fatalf("shipped %s release = %+v", appID, release)
		}
	}
}

func TestManifestFormalAppReleaseResolverRejectsDuplicateOrLegacyDeclaration(t *testing.T) {
	for _, testCase := range []struct {
		name      string
		manifests []string
	}{
		{name: "duplicate", manifests: []string{
			"app_id: nimi.avatar\ndisplay_name: Nimi Avatar\napp_access: [agent.local]\n",
			"app_id: nimi.avatar\ndisplay_name: Duplicate Avatar\napp_access: [agent.configure]\n",
		}},
		{name: "legacy", manifests: []string{
			"app_id: nimi.avatar\ndisplay_name: Nimi Avatar\npermissions: [agent.local]\napp_access: [agent.local]\n",
		}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			root := t.TempDir()
			for index, manifest := range testCase.manifests {
				releaseRoot := filepath.Join(root, fmt.Sprintf("release-%d", index))
				if err := os.MkdirAll(releaseRoot, 0o700); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(filepath.Join(releaseRoot, "nimi.app.yaml"), []byte(manifest), 0o600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := NewManifestFormalAppReleaseResolver(root); err == nil {
				t.Fatal("invalid formal release root was admitted")
			}
		})
	}
}
