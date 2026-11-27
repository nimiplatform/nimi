package app

import (
	"bytes"
	"context"
	"encoding/base64"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/publicappregistry"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type dynamicApprovedAppCatalogProvider struct {
	mu      sync.Mutex
	targets []publicappregistry.ResolvedApprovedTarget
	err     error
}

func (p *dynamicApprovedAppCatalogProvider) ListCurrentPlatformTargets(context.Context) ([]publicappregistry.ResolvedApprovedTarget, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.err != nil {
		return nil, p.err
	}
	out := make([]publicappregistry.ResolvedApprovedTarget, len(p.targets))
	copy(out, p.targets)
	return out, nil
}

func (p *dynamicApprovedAppCatalogProvider) Set(targets []publicappregistry.ResolvedApprovedTarget, err error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.targets = targets
	p.err = err
}

func makeBrowseTestApprovedTarget(t *testing.T, appID, version string, killSwitchActive bool) publicappregistry.ResolvedApprovedTarget {
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
	var ksReason *string
	var ksRevision uint64
	if killSwitchActive {
		r := "security-review-revoked"
		ksReason = &r
		ksRevision = 4
	}
	return publicappregistry.ResolvedApprovedTarget{
		Selector: selector, RegistryRevision: revision, DescriptorID: descriptorID,
		AppID: appID, DisplayName: "Browse Fixture App", Version: version, Visibility: "public",
		Origin:     "open-source-adapted",
		Upstream:   &publicappregistry.ProductUpstream{Name: "Upstream Project", URL: "https://github.com/upstream/example"},
		Admission:  publicappregistry.Admission{TrustTier: "community"},
		KillSwitch: publicappregistry.KillSwitch{Active: killSwitchActive, Reason: ksReason, Revision: ksRevision},
		Publisher:  publicappregistry.Publisher{GitHubNamespace: "publisher", NamespaceKind: "organization", Assurance: "pseudonymous"},
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

func openBrowseTestKernel(t *testing.T, dataRoot string, now func() time.Time) *localappkernel.Kernel {
	t.Helper()
	identity, err := localappkernel.ValidateVerifiedMacOSInteractiveUser(501, 42)
	if err != nil {
		t.Fatal(err)
	}
	databasePath, err := localappkernel.CanonicalRegistrationDatabasePath(dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := localappkernel.OpenSQLite(context.Background(), databasePath, identity, localappkernel.Options{
		Random:        bytes.NewReader(bytes.Repeat([]byte{0x42}, 1024)),
		HostInstallID: "browse-test-host",
		DataRoot:      dataRoot,
		Now:           now,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = kernel.Close() })
	return kernel
}

func TestApprovedAppCatalogBrowsePersistsDisplayOnlySnapshotAcrossRestart(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	currentTime := t0
	now := func() time.Time { return currentTime }

	dataRoot := t.TempDir()
	kernel := openBrowseTestKernel(t, dataRoot, now)
	target := makeBrowseTestApprovedTarget(t, "publisher.browse-app", "1.2.3", false)
	provider := &dynamicApprovedAppCatalogProvider{}
	service := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(provider), WithClock(now))
	t.Cleanup(service.Close)

	// Cold offline (no persisted snapshot yet) MUST fail with APP_CATALOG_UNAVAILABLE.
	provider.Set(nil, publicappregistry.ErrRegistryUnavailable)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{}); status.Code(err) != codes.Unavailable {
		t.Fatalf("cold offline error = %v, want Unavailable", err)
	}

	// Online fetch returns fresh targets (stale=false), non-empty selector, and updated_at=t0.
	provider.Set([]publicappregistry.ResolvedApprovedTarget{target}, nil)
	fresh, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil {
		t.Fatalf("fresh catalog fetch failed: %v", err)
	}
	if fresh.GetStale() || fresh.GetRefreshInProgress() || !fresh.GetUpdatedAt().AsTime().Equal(t0) || len(fresh.GetTargets()) != 1 || len(fresh.GetTargets()[0].GetApprovedTargetSelector()) == 0 {
		t.Fatalf("fresh response = stale:%v refreshInProgress:%v updatedAt:%v targets:%d", fresh.GetStale(), fresh.GetRefreshInProgress(), fresh.GetUpdatedAt().AsTime(), len(fresh.GetTargets()))
	}

	// Simulate Runtime restart + offline network failure at t0 + 3h.
	service.Close()
	if err := kernel.Close(); err != nil {
		t.Fatal(err)
	}
	currentTime = t0.Add(3 * time.Hour)
	reopened := openBrowseTestKernel(t, dataRoot, now)
	provider.Set(nil, publicappregistry.ErrRegistryUnavailable)
	restartedService := New(nil, WithLocalAppKernel(reopened), WithApprovedAppCatalogProvider(provider), WithClock(now))
	t.Cleanup(restartedService.Close)

	stale, err := restartedService.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil {
		t.Fatalf("stale catalog fallback failed: %v", err)
	}
	if !stale.GetStale() || !stale.GetRefreshInProgress() || !stale.GetUpdatedAt().AsTime().Equal(t0) || len(stale.GetTargets()) != 1 {
		t.Fatalf("stale response = stale:%v refreshInProgress:%v updatedAt:%v targets:%d", stale.GetStale(), stale.GetRefreshInProgress(), stale.GetUpdatedAt().AsTime(), len(stale.GetTargets()))
	}
	settled, err := restartedService.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil {
		t.Fatalf("await stale catalog settle failed: %v", err)
	}
	if !settled.GetStale() || settled.GetRefreshInProgress() || !settled.GetUpdatedAt().AsTime().Equal(t0) || len(settled.GetTargets()) != 1 {
		t.Fatalf("settled stale response = stale:%v refreshInProgress:%v updatedAt:%v targets:%d", settled.GetStale(), settled.GetRefreshInProgress(), settled.GetUpdatedAt().AsTime(), len(settled.GetTargets()))
	}
	projected := settled.GetTargets()[0]
	// Stale display record MUST preserve display/descriptor fields while omitting install/update authority selector.
	if len(projected.GetApprovedTargetSelector()) != 0 {
		t.Fatalf("stale catalog target leaked approved_target_selector: %q", string(projected.GetApprovedTargetSelector()))
	}
	if projected.GetAppId() != target.AppID || projected.GetDisplayName() != target.DisplayName ||
		projected.GetVersion() != target.Version || projected.GetDescriptorId() != target.DescriptorID ||
		projected.GetPublisherGithubNamespace() != "publisher" || projected.GetSourceLicenseSpdxExpression() != "MIT" ||
		projected.GetProductOrigin() != "open-source-adapted" || projected.GetProductUpstream().GetName() != "Upstream Project" ||
		projected.GetAdmissionTrustTier() != "community" || projected.GetAssetSize() != 4242 ||
		len(projected.GetAppAccess()) != 1 || projected.GetAppAccess()[0] != "runtime.consume" {
		t.Fatalf("stale display projection lost fields: %+v", projected)
	}

	// Stale display record MUST NOT grant install authority.
	_, err = restartedService.StartAppPackageInstall(ctx, &runtimev1.StartAppPackageInstallRequest{
		ApprovedTargetSelector: projected.GetApprovedTargetSelector(),
	})
	reason, _ := grpcerr.ExtractReasonCode(err)
	if status.Code(err) != codes.InvalidArgument || (reason != runtimev1.ReasonCode_APP_PACKAGE_SELECTION_INVALID && reason != runtimev1.ReasonCode_PROTOCOL_ENVELOPE_INVALID) {
		t.Fatalf("stale selector install error = code:%s reason:%s err:%v", status.Code(err), reason, err)
	}
}

func TestApprovedAppCatalogBrowseNeverRenewsAllowButPersistsObservedKillSwitch(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	currentTime := t0
	now := func() time.Time { return currentTime }

	dataRoot := t.TempDir()
	kernel := openBrowseTestKernel(t, dataRoot, now)
	target := makeBrowseTestApprovedTarget(t, "publisher.browse-policy", "1.2.3", false)
	selectorText, err := target.Selector.Encode()
	if err != nil {
		t.Fatal(err)
	}

	// Commit a verified release with initial policy verification at t0.
	store := kernel.PackageLifecycle()
	job, err := store.Begin(ctx, localappkernel.BeginPackageJobInput{
		AppID: target.AppID, SourceClass: localappkernel.SourceClassVerified, Kind: localappkernel.PackageJobInstall,
		TargetRef: selectorText, ProgressBasis: localappkernel.PackageProgressIndeterminate,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, phase := range []localappkernel.PackageJobPhase{
		localappkernel.PackageJobDownloading, localappkernel.PackageJobVerifying,
		localappkernel.PackageJobStaging, localappkernel.PackageJobCommitting,
	} {
		job, err = store.Advance(ctx, job.JobID, job.Phase, phase, localappkernel.PackageJobProgress{})
		if err != nil {
			t.Fatal(err)
		}
	}
	appRoot := filepath.Join(dataRoot, "apps", "packages", "releases", job.JobID)
	if _, err := store.CommitPackageRelease(ctx, localappkernel.CommitPackageReleaseInput{
		JobID: job.JobID, Version: target.Version, LaunchConfigJSON: []byte(`{"fixture":true}`), AppInfoJSON: []byte(`{"fixture":true}`),
		Registration: localappkernel.RegisterInstalledInput{
			AppID: target.AppID, DisplayName: target.DisplayName, SourceClass: localappkernel.SourceClassVerified,
			SourceRef: "public-app-registry:v1:" + target.AppID, ProjectRoot: appRoot, ManifestPath: filepath.Join(appRoot, "nimi.app.yaml"),
			RawDeclaration: []string{"runtime.consume"}, ImmutableLineageID: selectorText,
			ProvenanceAttestationRefs: []string{"https://api.github.com/repos/publisher/example/attestations/sha256:" + strings.Repeat("a", 64)},
			ProvenanceRevision:        1, ExecutionProfileRef: target.Target.ExecutionProfileRef,
			HostExecutableDigest: "host:test", PayloadRootDigest: "payload:test",
		},
		InitialPolicyVerification: &localappkernel.VerifiedPolicyVerification{
			AppID: target.AppID, ReleaseRef: selectorText, DescriptorID: target.DescriptorID, TargetID: target.Target.TargetID,
			Status: localappkernel.VerifiedPolicyAllowed, RegistryRevision: target.RegistryRevision, VerifiedAt: t0,
		},
	}); err != nil {
		t.Fatal(err)
	}

	provider := &dynamicApprovedAppCatalogProvider{}
	service := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(provider), WithClock(now))
	t.Cleanup(service.Close)

	// Opening the store online 48h later MUST NOT renew the installed target's VerifiedAt.
	currentTime = t0.Add(48 * time.Hour)
	provider.Set([]publicappregistry.ResolvedApprovedTarget{target}, nil)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
		t.Fatal(err)
	}
	afterBrowse, err := store.GetVerifiedPolicy(ctx, target.AppID, selectorText, target.DescriptorID, target.Target.TargetID)
	if err != nil || afterBrowse.Status != localappkernel.VerifiedPolicyAllowed || !afterBrowse.VerifiedAt.Equal(t0) {
		t.Fatalf("browsing store renewed VerifiedAt: %+v err=%v", afterBrowse, err)
	}

	// Opening the store online when kill-switch IS active persists the deny over the old allow.
	currentTime = t0.Add(49 * time.Hour)
	killedTarget := makeBrowseTestApprovedTarget(t, "publisher.browse-policy", "1.2.3", true)
	provider.Set([]publicappregistry.ResolvedApprovedTarget{killedTarget}, nil)
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); err != nil {
		t.Fatal(err)
	}
	afterKillSwitch, err := store.GetVerifiedPolicy(ctx, target.AppID, selectorText, target.DescriptorID, target.Target.TargetID)
	if err != nil || afterKillSwitch.Status != localappkernel.VerifiedPolicyBlocked || afterKillSwitch.PolicyReason != "security-review-revoked" {
		t.Fatalf("observed catalog kill-switch did not overwrite allow: %+v err=%v", afterKillSwitch, err)
	}
}

type blockingApprovedAppCatalogProvider struct {
	mu      sync.Mutex
	targets []publicappregistry.ResolvedApprovedTarget
	err     error
	calls   atomic.Int64
	entered chan struct{}
	release chan struct{}
}

func (p *blockingApprovedAppCatalogProvider) ListCurrentPlatformTargets(ctx context.Context) ([]publicappregistry.ResolvedApprovedTarget, error) {
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
	if p.err != nil {
		return nil, p.err
	}
	out := make([]publicappregistry.ResolvedApprovedTarget, len(p.targets))
	copy(out, p.targets)
	return out, nil
}

func TestApprovedAppCatalogColdOpenReturnsPersistedSnapshotBeforeSlowRefreshAndSingleflightsAwait(t *testing.T) {
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
	kernel := openBrowseTestKernel(t, dataRoot, now)
	v1 := makeBrowseTestApprovedTarget(t, "publisher.cold-open", "1.0.0", false)
	v2 := makeBrowseTestApprovedTarget(t, "publisher.cold-open", "2.0.0", false)

	// Seed persisted browse projection with v1 at t0.
	seedProvider := &dynamicApprovedAppCatalogProvider{}
	seedProvider.Set([]publicappregistry.ResolvedApprovedTarget{v1}, nil)
	seedSvc := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(seedProvider), WithClock(now))
	if _, err := seedSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{}); err != nil {
		t.Fatalf("seed browse snapshot: %v", err)
	}
	seedSvc.Close()

	// Simulate fresh cold-open Runtime service with slow Registry fetch for v2.
	clockMu.Lock()
	currentTime = t0.Add(2 * time.Hour)
	clockMu.Unlock()
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	slowProvider := &blockingApprovedAppCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v2},
		entered: entered,
		release: release,
	}
	service := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(slowProvider), WithClock(now))
	t.Cleanup(service.Close)

	// 1. Default cold-open call MUST return persisted v1 immediately BEFORE slow network resolves.
	coldResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil {
		t.Fatalf("cold-open default call failed: %v", err)
	}
	if !coldResp.GetStale() || !coldResp.GetRefreshInProgress() || !coldResp.GetUpdatedAt().AsTime().Equal(t0) ||
		len(coldResp.GetTargets()) != 1 || coldResp.GetTargets()[0].GetVersion() != "1.0.0" ||
		len(coldResp.GetTargets()[0].GetApprovedTargetSelector()) != 0 {
		t.Fatalf("unexpected cold-open response: stale=%v refreshInProgress=%v updatedAt=%v targets=%+v",
			coldResp.GetStale(), coldResp.GetRefreshInProgress(), coldResp.GetUpdatedAt().AsTime(), coldResp.GetTargets())
	}
	// Background singleflight refresh has started and is blocked waiting on slow network.
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("background singleflight refresh did not start")
	}

	// 2. Concurrent second default call returns persisted snapshot immediately without duplicate fetch.
	secondCold, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !secondCold.GetStale() || !secondCold.GetRefreshInProgress() {
		t.Fatalf("second cold-open call = %+v err=%v", secondCold, err)
	}
	if calls := slowProvider.calls.Load(); calls != 1 {
		t.Fatalf("expected 1 singleflight fetch, got %d", calls)
	}

	// 3. await_refresh=true joins the SAME active flight without starting a duplicate fetch.
	type awaitOutcome struct {
		resp *runtimev1.ListApprovedAppCatalogTargetsResponse
		err  error
	}
	awaitCh := make(chan awaitOutcome, 1)
	go func() {
		resp, awaitErr := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
		awaitCh <- awaitOutcome{resp: resp, err: awaitErr}
	}()
	select {
	case out := <-awaitCh:
		t.Fatalf("await_refresh returned before slow refresh resolved: %+v err=%v", out.resp, out.err)
	case <-time.After(50 * time.Millisecond):
	}
	if calls := slowProvider.calls.Load(); calls != 1 {
		t.Fatalf("await_refresh started duplicate fetch: calls=%d", calls)
	}

	// Release slow network: await_refresh resolves with live v2 + real selector.
	close(release)
	outcome := <-awaitCh
	if outcome.err != nil {
		t.Fatalf("await_refresh failed: %v", outcome.err)
	}
	if outcome.resp.GetStale() || outcome.resp.GetRefreshInProgress() ||
		len(outcome.resp.GetTargets()) != 1 || outcome.resp.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(outcome.resp.GetTargets()[0].GetApprovedTargetSelector()) == 0 {
		t.Fatalf("unexpected live await_refresh response: stale=%v refreshInProgress=%v targets=%+v",
			outcome.resp.GetStale(), outcome.resp.GetRefreshInProgress(), outcome.resp.GetTargets())
	}
	if calls := slowProvider.calls.Load(); calls != 1 {
		t.Fatalf("expected exactly 1 network fetch total, got %d", calls)
	}

	// 4. Follow-up await_refresh right after completion returns just-completed live response with 0 duplicate calls.
	coalesced, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil || coalesced.GetStale() || coalesced.GetRefreshInProgress() || coalesced.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("coalesced await_refresh = %+v err=%v", coalesced, err)
	}
	if calls := slowProvider.calls.Load(); calls != 1 {
		t.Fatalf("coalesced await_refresh triggered duplicate fetch: calls=%d", calls)
	}

	// 5. Explicit force_refresh triggers a new live fetch immediately.
	slowProvider.mu.Lock()
	slowProvider.entered = nil
	slowProvider.release = nil
	slowProvider.mu.Unlock()
	forced, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true})
	if err != nil || forced.GetStale() || forced.GetRefreshInProgress() || forced.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("force_refresh = %+v err=%v", forced, err)
	}
	if calls := slowProvider.calls.Load(); calls != 2 {
		t.Fatalf("expected force_refresh to perform 2nd fetch, got %d", calls)
	}
}

func TestApprovedAppCatalogAwaitRefreshDeliversCompletedLiveResultPastCoalesceWindow(t *testing.T) {
	ctx := context.Background()
	t0 := time.Date(2026, 11, 27, 10, 0, 0, 0, time.UTC)
	var clockMu sync.Mutex
	currentTime := t0
	now := func() time.Time {
		clockMu.Lock()
		defer clockMu.Unlock()
		return currentTime
	}
	advanceClock := func(delta time.Duration) {
		clockMu.Lock()
		currentTime = currentTime.Add(delta)
		clockMu.Unlock()
	}

	dataRoot := t.TempDir()
	kernel := openBrowseTestKernel(t, dataRoot, now)
	v1 := makeBrowseTestApprovedTarget(t, "publisher.delayed-await", "1.0.0", false)
	v2 := makeBrowseTestApprovedTarget(t, "publisher.delayed-await", "2.0.0", false)

	// Seed SQLite browse projection with v1 at t0.
	seedProvider := &dynamicApprovedAppCatalogProvider{}
	seedProvider.Set([]publicappregistry.ResolvedApprovedTarget{v1}, nil)
	seedSvc := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(seedProvider), WithClock(now))
	if _, err := seedSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{}); err != nil {
		t.Fatalf("seed browse snapshot: %v", err)
	}
	seedSvc.Close()

	// Fresh cold-open Service with fast live Registry returning v2.
	advanceClock(time.Hour)
	provider := &blockingApprovedAppCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v2},
	}
	service := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(provider), WithClock(now))
	t.Cleanup(service.Close)

	// 1. Default cold-open returns cached v1 immediately with refresh_in_progress=true and empty selector.
	coldResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil {
		t.Fatalf("cold-open default call failed: %v", err)
	}
	if !coldResp.GetStale() || !coldResp.GetRefreshInProgress() ||
		len(coldResp.GetTargets()) != 1 || coldResp.GetTargets()[0].GetVersion() != "1.0.0" ||
		len(coldResp.GetTargets()[0].GetApprovedTargetSelector()) != 0 {
		t.Fatalf("unexpected cold-open response: stale=%v refreshInProgress=%v targets=%+v",
			coldResp.GetStale(), coldResp.GetRefreshInProgress(), coldResp.GetTargets())
	}

	// Wait deterministically for the background refresh flight to complete.
	deadline := time.Now().Add(5 * time.Second)
	for {
		service.catalogRefreshMu.Lock()
		done := service.catalogRefreshCompleted && service.catalogRefreshFlight == nil
		service.catalogRefreshMu.Unlock()
		if done {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("timed out waiting for background catalog refresh to complete")
		}
		time.Sleep(5 * time.Millisecond)
	}
	if calls := provider.calls.Load(); calls != 1 {
		t.Fatalf("expected 1 background Registry call, got %d", calls)
	}

	// 2. Advance clock by 3.5 seconds (past the 3s coalesce window) and call await_refresh=true.
	advanceClock(3500 * time.Millisecond)
	delayedResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil {
		t.Fatalf("delayed await_refresh (3.5s) failed: %v", err)
	}
	if delayedResp.GetStale() || delayedResp.GetRefreshInProgress() ||
		len(delayedResp.GetTargets()) != 1 || delayedResp.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(delayedResp.GetTargets()[0].GetApprovedTargetSelector()) == 0 {
		t.Fatalf("delayed await_refresh (3.5s) reverted to stale or missing selector: stale=%v refreshInProgress=%v targets=%+v",
			delayedResp.GetStale(), delayedResp.GetRefreshInProgress(), delayedResp.GetTargets())
	}
	if calls := provider.calls.Load(); calls != 1 {
		t.Fatalf("delayed await_refresh (3.5s) triggered duplicate Registry call: calls=%d", calls)
	}

	// 3. Advance clock further (10s total past completion) and confirm await_refresh=true still delivers live v2.
	advanceClock(6500 * time.Millisecond)
	laterResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil {
		t.Fatalf("delayed await_refresh (10s) failed: %v", err)
	}
	if laterResp.GetStale() || laterResp.GetRefreshInProgress() ||
		len(laterResp.GetTargets()) != 1 || laterResp.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(laterResp.GetTargets()[0].GetApprovedTargetSelector()) == 0 {
		t.Fatalf("delayed await_refresh (10s) = stale:%v refreshInProgress:%v targets:%+v",
			laterResp.GetStale(), laterResp.GetRefreshInProgress(), laterResp.GetTargets())
	}
	if calls := provider.calls.Load(); calls != 1 {
		t.Fatalf("delayed await_refresh (10s) triggered duplicate Registry call: calls=%d", calls)
	}

	// 4. Subsequent ForceRefresh while offline MUST clear catalogLastLiveResponse and return stale v2 with empty selectors.
	provider.mu.Lock()
	provider.err = publicappregistry.ErrRegistryUnavailable
	provider.mu.Unlock()
	offlineForced, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true})
	if err != nil {
		t.Fatalf("offline force_refresh failed: %v", err)
	}
	if !offlineForced.GetStale() || offlineForced.GetRefreshInProgress() ||
		len(offlineForced.GetTargets()) != 1 || offlineForced.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(offlineForced.GetTargets()[0].GetApprovedTargetSelector()) != 0 {
		t.Fatalf("offline force_refresh did not return display-only stale v2: stale=%v refreshInProgress=%v targets=%+v",
			offlineForced.GetStale(), offlineForced.GetRefreshInProgress(), offlineForced.GetTargets())
	}
	if calls := provider.calls.Load(); calls != 2 {
		t.Fatalf("expected 2 total Registry calls after force_refresh, got %d", calls)
	}

	// Follow-up await_refresh after failed offline force_refresh MUST NOT resurrect old live install selectors.
	offlineAwait, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil {
		t.Fatalf("await_refresh after offline force_refresh failed: %v", err)
	}
	if !offlineAwait.GetStale() || offlineAwait.GetRefreshInProgress() ||
		len(offlineAwait.GetTargets()) != 1 || offlineAwait.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(offlineAwait.GetTargets()[0].GetApprovedTargetSelector()) != 0 {
		t.Fatalf("await_refresh resurrected live selectors after offline failure: stale=%v refreshInProgress=%v targets=%+v",
			offlineAwait.GetStale(), offlineAwait.GetRefreshInProgress(), offlineAwait.GetTargets())
	}
	if calls := provider.calls.Load(); calls != 2 {
		t.Fatalf("await_refresh after failed flight triggered unexpected Registry call: calls=%d", calls)
	}

	// 5. Cold await_refresh when no flight has ever run in a fresh process starts one live fetch instead of silently returning stale.
	freshProvider := &blockingApprovedAppCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v2},
	}
	freshService := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(freshProvider), WithClock(now))
	t.Cleanup(freshService.Close)
	coldAwait, err := freshService.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil {
		t.Fatalf("cold await_refresh failed: %v", err)
	}
	if coldAwait.GetStale() || coldAwait.GetRefreshInProgress() ||
		len(coldAwait.GetTargets()) != 1 || coldAwait.GetTargets()[0].GetVersion() != "2.0.0" ||
		len(coldAwait.GetTargets()[0].GetApprovedTargetSelector()) == 0 {
		t.Fatalf("cold await_refresh silently returned stale instead of live fetch: stale=%v refreshInProgress=%v targets=%+v",
			coldAwait.GetStale(), coldAwait.GetRefreshInProgress(), coldAwait.GetTargets())
	}
	if calls := freshProvider.calls.Load(); calls != 1 {
		t.Fatalf("expected 1 Registry call for cold await_refresh, got %d", calls)
	}
}

type ignoreCancelApprovedAppCatalogProvider struct {
	mu      sync.Mutex
	targets []publicappregistry.ResolvedApprovedTarget
	calls   atomic.Int64
	entered chan struct{}
	release chan struct{}
}

func (p *ignoreCancelApprovedAppCatalogProvider) ListCurrentPlatformTargets(context.Context) ([]publicappregistry.ResolvedApprovedTarget, error) {
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
		<-release
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]publicappregistry.ResolvedApprovedTarget, len(p.targets))
	copy(out, p.targets)
	return out, nil
}

func readPersistedBrowseVersions(t *testing.T, kernel *localappkernel.Kernel) []string {
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
	versions := make([]string, 0, len(decoded.Targets))
	for _, item := range decoded.Targets {
		versions = append(versions, item.Version)
	}
	return versions
}

func TestApprovedAppCatalogRefreshQuiesceAbortAndPersistGuard(t *testing.T) {
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
	kernel := openBrowseTestKernel(t, dataRoot, now)
	v1 := makeBrowseTestApprovedTarget(t, "publisher.quiesce-app", "1.0.0", false)
	v2 := makeBrowseTestApprovedTarget(t, "publisher.quiesce-app", "2.0.0", false)
	v3 := makeBrowseTestApprovedTarget(t, "publisher.quiesce-app", "3.0.0", false)

	// Seed SQLite with v1 at t0.
	seedProvider := &dynamicApprovedAppCatalogProvider{}
	seedProvider.Set([]publicappregistry.ResolvedApprovedTarget{v1}, nil)
	seedSvc := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(seedProvider), WithClock(now))
	if _, err := seedSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{}); err != nil {
		t.Fatalf("seed browse snapshot: %v", err)
	}
	seedSvc.Close()

	// 1. Standard context-aware hung background fetch: QuiesceDataRootContext cancels and drains it,
	// and releasing the provider afterward MUST leave SQLite at 1.0.0.
	clockMu.Lock()
	currentTime = t0.Add(time.Hour)
	clockMu.Unlock()
	entered := make(chan struct{}, 2)
	release := make(chan struct{})
	provider := &blockingApprovedAppCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v2},
		entered: entered,
		release: release,
	}
	service := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(provider), WithClock(now))
	t.Cleanup(service.Close)

	coldResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !coldResp.GetStale() || !coldResp.GetRefreshInProgress() || coldResp.GetTargets()[0].GetVersion() != "1.0.0" {
		t.Fatalf("cold-open before quiesce = %+v err=%v", coldResp, err)
	}
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("background catalog refresh did not start")
	}

	if err := service.QuiesceDataRootContext(ctx); err != nil {
		t.Fatalf("QuiesceDataRootContext failed: %v", err)
	}
	close(release)

	if versions := readPersistedBrowseVersions(t, kernel); len(versions) != 1 || versions[0] != "1.0.0" {
		t.Fatalf("persisted browse snapshot mutated after quiesce: got %v, want [1.0.0]", versions)
	}

	// While quiesced, default browse returns cached 1.0.0 with refresh_in_progress=false and starts no new fetch.
	quiescedResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !quiescedResp.GetStale() || quiescedResp.GetRefreshInProgress() || quiescedResp.GetTargets()[0].GetVersion() != "1.0.0" {
		t.Fatalf("quiesced default browse = %+v err=%v", quiescedResp, err)
	}
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{ForceRefresh: true}); status.Code(err) != codes.Canceled {
		t.Fatalf("quiesced force_refresh error = %v, want Canceled", err)
	}
	if _, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true}); status.Code(err) != codes.Canceled {
		t.Fatalf("quiesced await_refresh error = %v, want Canceled", err)
	}
	if calls := provider.calls.Load(); calls != 1 {
		t.Fatalf("quiesced calls triggered extra Registry fetch: calls=%d", calls)
	}

	// 2. ResumeDataRootAfterAbort restores refreshes so the next refresh persists 2.0.0.
	service.ResumeDataRootAfterAbort()
	provider.mu.Lock()
	provider.entered = nil
	provider.release = nil
	provider.mu.Unlock()
	resumedResp, err := service.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{AwaitRefresh: true})
	if err != nil || resumedResp.GetStale() || resumedResp.GetRefreshInProgress() || resumedResp.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("post-abort await_refresh = %+v err=%v", resumedResp, err)
	}
	if versions := readPersistedBrowseVersions(t, kernel); len(versions) != 1 || versions[0] != "2.0.0" {
		t.Fatalf("persisted browse snapshot after abort resume = %v, want [2.0.0]", versions)
	}

	// 3. Persist-boundary race: even if a provider ignores ctx cancellation and returns v3
	// right as QuiesceDataRootContext runs, QuiesceDataRootContext waits for the flight to exit
	// and the persist guard prevents writing v3 to the old root's SQLite.
	clockMu.Lock()
	currentTime = t0.Add(2 * time.Hour)
	clockMu.Unlock()
	ignoreEntered := make(chan struct{}, 1)
	ignoreRelease := make(chan struct{})
	ignoreProvider := &ignoreCancelApprovedAppCatalogProvider{
		targets: []publicappregistry.ResolvedApprovedTarget{v3},
		entered: ignoreEntered,
		release: ignoreRelease,
	}
	raceSvc := New(nil, WithLocalAppKernel(kernel), WithApprovedAppCatalogProvider(ignoreProvider), WithClock(now))
	t.Cleanup(raceSvc.Close)

	raceCold, err := raceSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !raceCold.GetRefreshInProgress() || raceCold.GetTargets()[0].GetVersion() != "2.0.0" {
		t.Fatalf("race cold-open = %+v err=%v", raceCold, err)
	}
	select {
	case <-ignoreEntered:
	case <-time.After(2 * time.Second):
		t.Fatal("ignore-cancel background refresh did not start")
	}

	quiesceDone := make(chan error, 1)
	go func() {
		quiesceDone <- raceSvc.QuiesceDataRootContext(ctx)
	}()
	select {
	case err := <-quiesceDone:
		t.Fatalf("QuiesceDataRootContext returned before in-flight fetch exited: %v", err)
	case <-time.After(50 * time.Millisecond):
	}

	// Unblock provider returning v3 with nil error while quiesce is active.
	close(ignoreRelease)
	if err := <-quiesceDone; err != nil {
		t.Fatalf("QuiesceDataRootContext failed after provider returned: %v", err)
	}
	if versions := readPersistedBrowseVersions(t, kernel); len(versions) != 1 || versions[0] != "2.0.0" {
		t.Fatalf("persist-boundary race overwrote old root SQLite: got %v, want [2.0.0]", versions)
	}

	// 4. Permanent CloseLocalAppStorage cannot be reopened by ResumeDataRootAfterAbort.
	raceSvc.CloseLocalAppStorage()
	raceSvc.ResumeDataRootAfterAbort()
	closedResp, err := raceSvc.ListApprovedAppCatalogTargets(ctx, &runtimev1.ListApprovedAppCatalogTargetsRequest{})
	if err != nil || !closedResp.GetStale() || closedResp.GetRefreshInProgress() {
		t.Fatalf("closed service unexpectedly started refresh: %+v err=%v", closedResp, err)
	}
	if ignoreProvider.calls.Load() != 1 {
		t.Fatalf("closed service issued extra fetch after ResumeDataRootAfterAbort: calls=%d", ignoreProvider.calls.Load())
	}
}
