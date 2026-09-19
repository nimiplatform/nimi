package app

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"

	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/localappop"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
)

func sourcePlatformManifest(t *testing.T, path, access string) {
	t.Helper()
	if err := os.WriteFile(path, []byte("app_id: nimi.desktop\ndisplay_name: Nimi Desktop\napp_access: ["+access+"]\n"), 0o600); err != nil {
		t.Fatal(err)
	}
}

func sourcePlatformFixture(t *testing.T) (string, string) {
	t.Helper()
	root := t.TempDir()
	appRoot := filepath.Join(root, "desktop")
	if err := os.MkdirAll(filepath.Join(appRoot, ".tmp"), 0o700); err != nil {
		t.Fatal(err)
	}
	manifest := filepath.Join(appRoot, "nimi.app.yaml")
	sourcePlatformManifest(t, manifest, "agent.local")
	return root, manifest
}

func TestSourceDevelopmentAppResolverUsesOnlyCurrentManifest(t *testing.T) {
	root, manifest := sourcePlatformFixture(t)
	resolver, err := NewSourceDevelopmentAppResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	before, err := resolver.ResolveFormalAppRelease(ctx, "nimi.desktop")
	if err != nil {
		t.Fatal(err)
	}
	if before.ImmutableLineageID != "" || len(before.ProvenanceAttestationRefs) != 0 || before.ProvenanceRevision != 0 ||
		before.ExecutionProfileRef != "" || before.PayloadRootDigest != "" {
		t.Fatalf("source workspace manufactured package evidence: %+v", before)
	}
	for _, name := range []string{"source.ts", ".tmp/report.json"} {
		if err := os.WriteFile(filepath.Join(filepath.Dir(manifest), name), []byte("a mutable non-manifest file"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	reloaded, err := NewSourceDevelopmentAppResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	after, err := reloaded.ResolveFormalAppRelease(ctx, "nimi.desktop")
	if err != nil || !reflect.DeepEqual(before, after) {
		t.Fatalf("workspace payload changed source input: before=%+v after=%+v err=%v", before, after, err)
	}
	sourcePlatformManifest(t, manifest, "runtime.consume")
	changed, err := resolver.ResolveFormalAppRelease(ctx, "nimi.desktop")
	if err != nil || !reflect.DeepEqual(changed.Declaration, []string{"runtime.consume"}) {
		t.Fatalf("current declaration was not re-read: %+v err=%v", changed, err)
	}
	if err := os.WriteFile(manifest, []byte("app_id: nimi.other\ndisplay_name: Other\napp_access: []\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.ResolveFormalAppRelease(ctx, "nimi.desktop"); err == nil {
		t.Fatal("changed manifest App identity was admitted")
	}
}

func TestImmutableFormalAppResolverStillTracksPayload(t *testing.T) {
	root, manifest := sourcePlatformFixture(t)
	first, err := NewManifestFormalAppReleaseResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	before, err := first.ResolveFormalAppRelease(context.Background(), "nimi.desktop")
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifest), "entry.js"), []byte("changed installed payload"), 0o600); err != nil {
		t.Fatal(err)
	}
	second, err := NewManifestFormalAppReleaseResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	after, err := second.ResolveFormalAppRelease(context.Background(), "nimi.desktop")
	if err != nil || before.PayloadRootDigest == after.PayloadRootDigest || before.ImmutableLineageID == after.ImmutableLineageID {
		t.Fatalf("immutable payload change was lost: before=%+v after=%+v err=%v", before, after, err)
	}
}

func TestPlatformSourceRegistrationPreservesSubjectAndSessionBoundaries(t *testing.T) {
	ctx := context.Background()
	root, manifest := sourcePlatformFixture(t)
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 91)
	if err != nil {
		t.Fatal(err)
	}
	dataRoot := t.TempDir()
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, databasePath, identity, localappkernel.Options{
		HostInstallID: "platform-source-host", DataRoot: dataRoot,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	account := newLocalAppSessionTestAccount("platform-source-account", "platform-source-realm")
	newService := func(option Option) *Service {
		return New(nil, WithLocalAppKernel(kernel), WithRuntimeAccountProjectionProvider(account),
			WithLocalAppSessionRuntime(bytes.NewReader(sessionTestEntropy()), time.Minute), option)
	}
	process := protectedlocal.ProcessTuple{
		OS: protectedlocal.OSWindows, PID: 5101, CreationMarker: "source-host-start",
		OSLoginSession: "interactive-login", SecurityPrincipal: "interactive-user",
		CanonicalExecutableIdentity: "source-host-executable", ExecutableDigest: localAppSessionTestIdentifier(0x31),
		ExecutableTrustSetID: "source-host",
	}
	const appID = "nimi.desktop"
	const slot = protectedlocal.DesktopAccountProductProfileID
	immutable, err := NewManifestFormalAppReleaseResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	prior, err := newService(WithFormalAppReleaseResolver(immutable)).registerFormalAppRelease(ctx, appID, slot, process)
	if err != nil {
		t.Fatal(err)
	}
	source, err := NewSourceDevelopmentAppResolver(root)
	if err != nil {
		t.Fatal(err)
	}
	service := newService(WithSourceDevelopmentAppResolver(source))
	registration, err := service.registerFormalAppRelease(ctx, appID, slot, process)
	if err != nil {
		t.Fatal(err)
	}
	if registration.RegisteredAppSubject != prior.RegisteredAppSubject || registration.RegistrationHandle != prior.RegistrationHandle ||
		registration.SourceGeneration != prior.SourceGeneration+1 || !registration.IsPlatformSourceDevelopment() || registration.ImmutablePackageFactsComplete() {
		t.Fatalf("source owner update lost subject or retained package facts: prior=%+v current=%+v", prior, registration)
	}
	status, err := kernel.Registrations().Status(ctx, registration.RegistrationHandle)
	if err != nil || !status.Available {
		t.Fatalf("source registration unavailable: %+v err=%v", status, err)
	}
	statuses, err := kernel.Registrations().ListStatuses(ctx)
	if err != nil || len(statuses) != 1 || !statuses[0].Available {
		t.Fatalf("source status listing: %+v err=%v", statuses, err)
	}
	connection := func(trust protectedlocal.LocalAppTrustClass, witness protectedlocal.ProcessTuple) *protectedlocal.LocalAppConnection {
		t.Helper()
		peer, err := protectedlocal.EstablishInstalledAppConnection(registration.RegistrationHandle, trust,
			localAppSessionTestIdentifier(0x32), localAppSessionTestIdentifier(0x33), witness, make(chan struct{}))
		if err != nil {
			t.Fatal(err)
		}
		t.Cleanup(peer.Revoke)
		return peer
	}
	peer := connection(protectedlocal.LocalAppTrustBuiltIn, process)
	localCtx := protectedlocal.ContextWithLocalAppConnection(ctx, peer)
	if _, err := service.OpenLocalAppSessionProjection(localCtx); err != nil {
		t.Fatalf("source BuiltIn session: %v", err)
	}
	if _, err := service.AuthorizeLocalAppIngress(localCtx, localappop.IngressAgentReferenceList); err != nil {
		t.Fatalf("declared operation denied: %v", err)
	}
	if _, err := service.AuthorizeLocalAppIngress(localCtx, localappop.IngressAgentManagerSnapshotGet); err == nil {
		t.Fatal("source posture granted an undeclared domain")
	}
	for _, trust := range []protectedlocal.LocalAppTrustClass{protectedlocal.LocalAppTrustVerified, protectedlocal.LocalAppTrustUserImported} {
		other := protectedlocal.ContextWithLocalAppConnection(ctx, connection(trust, process))
		if _, err := service.OpenLocalAppSessionProjection(other); err == nil {
			t.Fatalf("installed trust %v used non-package source registration", trust)
		}
	}
	production := newService(WithFormalAppReleaseResolver(immutable))
	if _, err := production.OpenLocalAppSessionProjection(protectedlocal.ContextWithLocalAppConnection(ctx, connection(protectedlocal.LocalAppTrustBuiltIn, process))); err == nil {
		t.Fatal("non-source Runtime accepted non-package platform input")
	}
	if err := os.WriteFile(filepath.Join(filepath.Dir(manifest), ".tmp", "report.txt"), []byte("irrelevant workspace change"), 0o600); err != nil {
		t.Fatal(err)
	}
	unchanged, err := service.registerFormalAppRelease(ctx, appID, slot, process)
	if err != nil || unchanged.SourceGeneration != registration.SourceGeneration || unchanged.DeclarationGeneration != registration.DeclarationGeneration {
		t.Fatalf("workspace content rotated registration: %+v err=%v", unchanged, err)
	}
	sourcePlatformManifest(t, manifest, "runtime.consume")
	changed, err := service.registerFormalAppRelease(ctx, appID, slot, process)
	if err != nil || changed.SourceGeneration != registration.SourceGeneration || changed.DeclarationGeneration != registration.DeclarationGeneration+1 {
		t.Fatalf("declaration generation not updated independently: %+v err=%v", changed, err)
	}
	if _, err := service.AuthorizeLocalAppIngress(localCtx, localappop.IngressAgentReferenceList); err == nil {
		t.Fatal("old declaration session remained authorized")
	}
	if _, err := service.RenewLocalAppSessionProjection(localCtx); err != nil {
		t.Fatalf("current declaration session could not renew: %v", err)
	}
	if _, err := service.AuthorizeLocalAppIngress(localCtx, localappop.IngressAgentReferenceList); err == nil {
		t.Fatal("renewal restored removed declaration")
	}
	newProcess := process
	newProcess.ExecutableDigest = localAppSessionTestIdentifier(0x34)
	if _, err := service.registerFormalAppRelease(ctx, appID, slot, newProcess); err == nil {
		t.Fatal("native Host witness changed inside one Runtime composition")
	}
	restarted := newService(WithSourceDevelopmentAppResolver(source))
	newHost, err := restarted.registerFormalAppRelease(ctx, appID, slot, newProcess)
	if err != nil || newHost.SourceGeneration != changed.SourceGeneration+1 || newHost.RegisteredAppSubject != prior.RegisteredAppSubject {
		t.Fatalf("new composition did not re-evaluate Host while preserving subject: %+v err=%v", newHost, err)
	}
	if _, err := service.RenewLocalAppSessionProjection(localCtx); err == nil {
		t.Fatal("old Host session renewed after current witness changed")
	}
	if _, err := restarted.registerFormalAppRelease(ctx, appID, slot, process); err == nil {
		t.Fatal("older Host overwrote the current witness")
	}
}
