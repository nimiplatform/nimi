package grpcserver

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	appservice "github.com/nimiplatform/nimi/runtime/internal/services/app"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type appRootHandoffStub struct {
	entered chan struct{}
	settled chan struct{}
	fail    error
	resumed int
}

func (a *appRootHandoffStub) QuiesceDataRootContext(ctx context.Context) error {
	close(a.entered)
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-a.settled:
		return a.fail
	}
}

func (a *appRootHandoffStub) ResumeDataRootAfterAbort() { a.resumed++ }

func TestProductControlRootHandoffWaitsForAppWorkersAndKeepsCommittedOwnerClosed(t *testing.T) {
	owner := &appRootHandoffStub{entered: make(chan struct{}), settled: make(chan struct{})}
	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appPackages: owner}
	finished := make(chan error, 1)
	go func() { finished <- handoff.CloseRootAdmission(context.Background()) }()
	<-owner.entered
	select {
	case err := <-finished:
		t.Fatalf("root handoff passed unsettled App workers: %v", err)
	default:
	}
	_, release, admitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppPackageService/StartAppPackageInstall")
	release()
	if admitted {
		t.Fatal("new App download admitted during root handoff")
	}
	close(owner.settled)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	handoff.CommitRootHandoff()
	handoff.AbortRootHandoff()
	if owner.resumed != 0 {
		t.Fatal("committed handoff reopened the old App owner")
	}
}

func TestProductControlRootHandoffAbortsWhenAppCommitCannotBeSettled(t *testing.T) {
	unknown := errors.New("App commit outcome unknown")
	owner := &appRootHandoffStub{entered: make(chan struct{}), settled: make(chan struct{}), fail: unknown}
	close(owner.settled)
	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appPackages: owner}
	if err := handoff.CloseRootAdmission(context.Background()); !errors.Is(err, unknown) {
		t.Fatalf("App owner failure did not block activation: %v", err)
	}
	handoff.AbortRootHandoff()
	if owner.resumed != 1 {
		t.Fatal("pre-commit abort did not restore App owner admission")
	}
	_, release, admitted := registry.TrackUnary(context.Background(), "/nimi.runtime.v1.RuntimeAppPackageService/ListAppPackageJobs")
	defer release()
	if !admitted {
		t.Fatal("pre-commit abort left current root RPC admission closed")
	}
}

func TestProductControlRootHandoffIncludesActivityRetention(t *testing.T) {
	owner := &appRootHandoffStub{entered: make(chan struct{}), settled: make(chan struct{})}
	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appActivity: owner}
	finished := make(chan error, 1)
	go func() { finished <- handoff.CloseRootAdmission(context.Background()) }()
	<-owner.entered
	select {
	case err := <-finished:
		t.Fatalf("handoff crossed activity worker: %v", err)
	default:
	}
	close(owner.settled)
	if err := <-finished; err != nil {
		t.Fatal(err)
	}
	handoff.AbortRootHandoff()
	if owner.resumed != 1 {
		t.Fatal("activity owner was not restored after abort")
	}
}

type rootHandoffCatalogProvider struct {
	mu      sync.Mutex
	targets []publicappregistry.ResolvedApprovedTarget
	calls   atomic.Int64
	entered chan struct{}
	release chan struct{}
}

func (p *rootHandoffCatalogProvider) ListCurrentPlatformTargets(ctx context.Context) ([]publicappregistry.ResolvedApprovedTarget, error) {
	p.calls.Add(1)
	p.mu.Lock()
	entered := p.entered
	release := p.release
	p.mu.Unlock()
	if entered != nil {
		select {
		case entered <- struct{}{}:
		default:
		}
	}
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]publicappregistry.ResolvedApprovedTarget, len(p.targets))
	copy(out, p.targets)
	return out, nil
}

func makeRootHandoffApprovedTarget(t *testing.T, appID, version string) publicappregistry.ResolvedApprovedTarget {
	t.Helper()
	targetID, expectedOS, expectedArch, err := publicappregistry.CurrentPlatformTarget()
	if err != nil {
		t.Skipf("unsupported test platform: %v", err)
	}
	encode := base64.RawURLEncoding.EncodeToString
	revision := strings.Repeat("a", 40)
	descriptorID := appID + "@" + version
	selectorText := "nats_v1_" + encode([]byte(descriptorID)) + "." +
		encode([]byte(targetID)) + "." + encode([]byte(revision))
	selector, err := publicappregistry.ParseApprovedTargetSelector(selectorText)
	if err != nil {
		t.Fatal(err)
	}
	return publicappregistry.ResolvedApprovedTarget{
		Selector: selector, RegistryRevision: revision, DescriptorID: descriptorID,
		AppID: appID, DisplayName: "Handoff Fixture App", Version: version, Visibility: "public",
		Origin:    "open-source-adapted",
		Upstream:  &publicappregistry.ProductUpstream{Name: "Upstream", URL: "https://github.com/upstream/example"},
		Admission: publicappregistry.Admission{TrustTier: "community"},
		Publisher: publicappregistry.Publisher{GitHubNamespace: "publisher", NamespaceKind: "organization", Assurance: "pseudonymous"},
		Source: publicappregistry.Source{Repository: "https://github.com/publisher/example", License: publicappregistry.SourceLicense{
			SPDXExpression: "MIT", Files: []publicappregistry.LicenseFile{{Path: "LICENSE", SHA256: strings.Repeat("b", 64)}},
		}},
		Release:   publicappregistry.Release{Tag: "v" + version, CommitSHA: strings.Repeat("c", 40), ReleaseURL: "https://github.com/publisher/example/releases/tag/v" + version, ReleaseNotesURL: "https://github.com/publisher/example/releases/tag/v" + version},
		AppAccess: []string{"runtime.consume"}, CapabilityContractRefs: []string{"text.generate"},
		StoragePolicy: publicappregistry.StoragePolicy{Kind: "app-owned-os-storage", OSStorageDisclosure: []publicappregistry.StorageDisclosure{{
			PathPattern: "%LOCALAPPDATA%/Example", Purpose: "cache", ExpectedSizeBand: "1-10 MiB",
		}}},
		UpdateChannel: "stable", Support: publicappregistry.Support{EscalationURL: "https://github.com/publisher/example/issues", RecoveryInstructions: "Reinstall."},
		Target: publicappregistry.Target{TargetID: targetID, OS: expectedOS, Arch: expectedArch, AssetName: "example.nimiapp", Size: 4242,
			RuntimeEntry: "payload/example.exe", ExecutionProfileRef: "windows-user-mode-as-invoker-v1",
			NativeTrust: publicappregistry.NativeTrust{WindowsCodeSigning: "unsigned", MacOSNotarization: "not-applicable"}},
	}
}

func readHandoffBrowseVersion(t *testing.T, kernel *localappkernel.Kernel) string {
	t.Helper()
	targetID, expectedOS, expectedArch, err := publicappregistry.CurrentPlatformTarget()
	if err != nil {
		t.Fatal(err)
	}
	snap, err := kernel.PackageLifecycle().ReadPublicCatalogBrowseSnapshot(context.Background(), targetID, expectedOS, expectedArch)
	if err != nil {
		t.Fatalf("read persisted browse snapshot: %v", err)
	}
	decoded, err := publicappregistry.DecodeBrowseProjection(snap.ProjectionJSON, expectedOS, expectedArch)
	if err != nil {
		t.Fatalf("decode persisted browse snapshot: %v", err)
	}
	if len(decoded.Targets) != 1 {
		t.Fatalf("expected 1 persisted target, got %d", len(decoded.Targets))
	}
	return decoded.Targets[0].Version
}

func TestProductControlRootHandoffQuiescesAppCatalogRefreshOnRealSQLite(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	currentTime := t0
	now := func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return currentTime
	}

	dataRoot := t.TempDir()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	dbPath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(ctx, dbPath, identity, localappkernel.Options{
		Random:        bytes.NewReader(bytes.Repeat([]byte{0x42}, 1024)),
		HostInstallID: "handoff-catalog-host",
		DataRoot:      dataRoot,
		Now:           now,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })

	v1 := makeRootHandoffApprovedTarget(t, "publisher.handoff-catalog", "1.0.0")
	v2 := makeRootHandoffApprovedTarget(t, "publisher.handoff-catalog", "2.0.0")
	v3 := makeRootHandoffApprovedTarget(t, "publisher.handoff-catalog", "3.0.0")

	// Seed SQLite with 1.0.0.
	seedProvider := &rootHandoffCatalogProvider{targets: []publicappregistry.ResolvedApprovedTarget{v1}}
	seedSvc := appservice.New(nil, appservice.WithLocalAppKernel(kernel), appservice.WithApprovedAppCatalogProvider(seedProvider), appservice.WithClock(now))
	if _, err := seedSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{}); err != nil {
		t.Fatalf("seed browse snapshot: %v", err)
	}
	seedSvc.Close()

	// Fresh service with hung background refresh for 2.0.0 wired into productControlRuntimeRootHandoff.
	clockMu.Lock()
	currentTime = t0.Add(time.Hour)
	clockMu.Unlock()
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	provider := &rootHandoffCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v2},
		entered: entered,
		release: release,
	}
	appSvc := appservice.New(nil, appservice.WithLocalAppKernel(kernel), appservice.WithApprovedAppCatalogProvider(provider), appservice.WithClock(now))
	t.Cleanup(appSvc.Close)

	registry := newActiveRPCRegistry(nil)
	handoff := &productControlRuntimeRootHandoff{registry: registry, appCatalog: appSvc}

	// 1. Default call returns cached 1.0.0 immediately and launches background fetch for 2.0.0.
	resp, err := appSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !resp.GetStale() || !resp.GetRefreshInProgress() || resp.GetTargets()[0].GetVersion() != "1.0.0" {
		t.Fatalf("cold-open response = %+v err=%v", resp, err)
	}
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("background catalog refresh did not start")
	}

	// 2. CloseRootAdmission(ctx) quiesces the background fetch and returns nil;
	// releasing the hung fetch afterward MUST NOT overwrite old root SQLite from 1.0.0 to 2.0.0.
	if err := handoff.CloseRootAdmission(ctx); err != nil {
		t.Fatalf("CloseRootAdmission failed: %v", err)
	}
	close(release)
	if got := readHandoffBrowseVersion(t, kernel); got != "1.0.0" {
		t.Fatalf("old root SQLite overwritten after CloseRootAdmission: got %q, want %q", got, "1.0.0")
	}

	// 3. AbortRootHandoff restores refreshes so the next refresh persists 2.0.0.
	handoff.AbortRootHandoff()
	provider.mu.Lock()
	provider.entered = nil
	provider.release = nil
	provider.mu.Unlock()
	resumed, err := appSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil || resumed.GetStale() || resumed.GetRefreshInProgress() || resumed.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("post-abort catalog refresh = %+v err=%v", resumed, err)
	}
	if got := readHandoffBrowseVersion(t, kernel); got != "2.0.0" {
		t.Fatalf("SQLite not updated after AbortRootHandoff: got %q, want %q", got, "2.0.0")
	}

	// 4. CommitRootHandoff keeps old root closed even if AbortRootHandoff is called afterward.
	clockMu.Lock()
	currentTime = t0.Add(2 * time.Hour)
	clockMu.Unlock()
	entered3 := make(chan struct{}, 2)
	release3 := make(chan struct{})
	provider.mu.Lock()
	provider.targets = []publicappregistry.ResolvedApprovedTarget{v3}
	provider.entered = entered3
	provider.release = release3
	provider.mu.Unlock()

	beforeCommit, err := appSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !beforeCommit.GetRefreshInProgress() || beforeCommit.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("pre-commit cold-open = %+v err=%v", beforeCommit, err)
	}
	select {
	case <-entered3:
	case <-time.After(2 * time.Second):
		t.Fatal("second background catalog refresh did not start")
	}
	if err := handoff.CloseRootAdmission(ctx); err != nil {
		t.Fatalf("second CloseRootAdmission failed: %v", err)
	}
	handoff.CommitRootHandoff()
	handoff.AbortRootHandoff()
	close(release3)

	callsAtCommit := provider.calls.Load()
	afterCommit, err := appSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !afterCommit.GetStale() || afterCommit.GetRefreshInProgress() || afterCommit.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("post-commit browse = %+v err=%v", afterCommit, err)
	}
	if _, err := appSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); status.Code(err) != codes.Canceled {
		t.Fatalf("post-commit force_refresh error = %v, want Canceled", err)
	}
	if provider.calls.Load() != callsAtCommit {
		t.Fatalf("post-commit calls triggered extra fetch: got %d, want %d", provider.calls.Load(), callsAtCommit)
	}
	if got := readHandoffBrowseVersion(t, kernel); got != "2.0.0" {
		t.Fatalf("committed old root SQLite mutated: got %q, want %q", got, "2.0.0")
	}
}
