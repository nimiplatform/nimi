package app

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appinstallgateway"
	"github.com/nimiplatform/nimi/runtime/internal/appregistry"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/metadata"
)

type recordingInstallEventStream struct {
	ctx    context.Context
	cancel context.CancelFunc
	mu     sync.Mutex
	events []*runtimev1.AppInstallJobEvent
}

func newRecordingInstallEventStream() *recordingInstallEventStream {
	ctx, cancel := context.WithCancel(context.Background())
	return &recordingInstallEventStream{ctx: ctx, cancel: cancel}
}

func (s *recordingInstallEventStream) Send(event *runtimev1.AppInstallJobEvent) error {
	s.mu.Lock()
	s.events = append(s.events, event)
	s.mu.Unlock()
	return nil
}

func (s *recordingInstallEventStream) terminalSeen() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, event := range s.events {
		if installJobTerminal(event.GetJob().GetState()) {
			return true
		}
	}
	return false
}

func (s *recordingInstallEventStream) SetHeader(metadata.MD) error  { return nil }
func (s *recordingInstallEventStream) SendHeader(metadata.MD) error { return nil }
func (s *recordingInstallEventStream) SetTrailer(metadata.MD)       {}
func (s *recordingInstallEventStream) Context() context.Context     { return s.ctx }
func (s *recordingInstallEventStream) SendMsg(any) error            { return nil }
func (s *recordingInstallEventStream) RecvMsg(any) error            { return nil }

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

type allowingAppSessionValidator struct{}

func (allowingAppSessionValidator) ValidateAppSession(string, string, string) (runtimev1.ReasonCode, bool) {
	return runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED, true
}

func bundledRegistry(t *testing.T) *appregistrycatalog.Registry {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: test_nimi_app_registry
apps:
  - app_id: nimi.example-app
    display_label: Example App
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    runtime_registration_mode: app-managed
    ordinary_visibility: ordinary-visible
    release_descriptor_ref: nimi.example-app.bundled-with-nimi
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: admitted
    source_rule: P-NAPP-011
`
	registry, err := appregistrycatalog.LoadRegistry(stringReader(body))
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	return registry
}

func bundledRegistryWithPermission(t *testing.T) *appregistrycatalog.Registry {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: test_nimi_app_registry
apps:
  - app_id: nimi.example-app
    display_label: Example App
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    runtime_registration_mode: app-managed
    permission_scope_ref:
      - { appId: nimi.example-app, scopeFamily: account, scopeName: account.read }
    ordinary_visibility: ordinary-visible
    release_descriptor_ref: nimi.example-app.bundled-with-nimi
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: admitted
    source_rule: P-NAPP-011
`
	registry, err := appregistrycatalog.LoadRegistry(stringReader(body))
	if err != nil {
		t.Fatalf("load registry with permission: %v", err)
	}
	return registry
}

func bundledReleaseCatalog(t *testing.T) *appreleasecatalog.Catalog {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: nimi.example-app.bundled-with-nimi
    app_id: nimi.example-app
    version: bundled-with-current-nimi-release
    descriptor_class: bundled-with-nimi
    source:
      kind: nimi-bundle
      ref: current-atomic-nimi-release
    artifact:
      locator: current-nimi-release-bundle
      digest_algorithm: sha256
      sha256: inherited-from-atomic-nimi-release-manifest
      size: inherited-from-atomic-nimi-release-manifest
      signature_or_provenance_ref: nimi-first-party-signature-policy
    runtime:
      package_kind: nimi-app
      entry_ref: example-app-runtime-registration
      sandbox_ref: first-party-bundled-app
    permissions_ref: nimi.example-app.permission_scope_ref
    storage_policy_ref: nimi-data-app-roots
    review:
      admission_path: first-party-bundled-release
      mutable_source_allowed: false
      install_digest_verification_required: inherited_from_atomic_bundle
    source_rule: P-NAPP-014
`
	catalog, err := appreleasecatalog.LoadCatalog(stringReader(body))
	if err != nil {
		t.Fatalf("load release catalog: %v", err)
	}
	return catalog
}

func externalFixtureRegistry(t *testing.T, visibility string) *appregistrycatalog.Registry {
	t.Helper()
	body := fmt.Sprintf(`version: 1
table_family: product_catalog
owner: platform
catalog_id: test_nimi_app_registry
apps:
  - app_id: community.nimi.fixture.platform-proof
    display_label: Platform Proof Fixture
    publisher: nimiplatform-fixtures
    trust_tier_ref: nimi-community
    package_kind: nimi-app
    runtime_registration_mode: app-managed
    permission_scope_ref:
      - { appId: community.nimi.fixture.platform-proof, scopeFamily: account, scopeName: account.session.read }
    ordinary_visibility: %s
    release_descriptor_ref: community.nimi.fixture.platform-proof.0.1.0-sandbox
    install_storage_policy_ref: nimi-data-app-roots
    admission_status: admitted
    source_rule: P-NAPP-033
`, visibility)
	registry, err := appregistrycatalog.LoadRegistry(stringReader(body))
	if err != nil {
		t.Fatalf("load external fixture registry: %v", err)
	}
	return registry
}

func externalFixtureReleaseCatalog(t *testing.T, artifactURL string, payload []byte) *appreleasecatalog.Catalog {
	t.Helper()
	sum := sha256.Sum256(payload)
	body := fmt.Sprintf(`version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: community.nimi.fixture.platform-proof.0.1.0-sandbox
    app_id: community.nimi.fixture.platform-proof
    version: 0.1.0-sandbox
    admission_track: admission-sandbox-ci
    descriptor_class: external-immutable-artifact
    publisher:
      github_namespace: github.com/nimiplatform-fixtures
      namespace_kind: org
      identity_assurance: domain-verified
      verified_domain: fixtures.nimi.test
      kyc_verification_ref: ci-kyc-deferred
    source:
      kind: admission-sandbox-https-artifact
      ref: %s
    artifact:
      locator: %s
      digest_algorithm: sha256
      sha256: %s
      size:
        download: "%d"
        installed: "%d"
        user_data: "0"
        cache: "0"
        shared_deps: "0"
      signature_or_provenance_ref: ci-provenance/platform-proof/0.1.0-sandbox
    artifact_mirror_ref: nimi-ci-mirror://platform-proof/0.1.0-sandbox/app.zip
    mirror_license_cleared: true
    build_assurance: deterministic-fixture-build
    dependency_assurance: pnpm-lock-and-sdk-kit-boundary-scan
    platform_signing_assurance:
      macos_notarization: not-required-internal
      macos_developer_id_subject: not-required-internal
      windows_code_signing: not-required-internal
      installer_signature: not-required-internal
      entitlements_ref: ci-entitlements/platform-proof
      signing_subject: nimi-internal-ci
    runtime:
      package_kind: nimi-app
      entry_ref: dist/index.html
      sandbox_ref: installed-nimi-app-standard-shell-v1
    permissions_ref: community.nimi.fixture.platform-proof.permission_scope_ref
    storage_policy_ref:
      id: nimi-data-app-roots
      kind: nimi-mediated-default
    update_channel_ref: platform-proof-sandbox-channel
    rollback_eligibility: no-prior-admitted-descriptor
    review:
      admission_path: admission-sandbox-ci
      mutable_source_allowed: false
      install_digest_verification_required: required
      decision: approved
      adjudicator_kind: platform-review-bot
      adjudicator_ref: ci/platform-proof
      decided_at: "2026-06-30T00:00:00Z"
    support:
      diagnostics_bundle_fields: [runtime, storage, descriptor]
      redaction_rules: [strip-account-token]
      user_visible_issue_categories: [install-failed, launch-failed]
      escalation_path: ci-fixture-support
      kill_switch_visibility: developer-only
      recovery_instructions: [reinstall]
    source_rule: P-NAPP-033
`, artifactURL, artifactURL, hex.EncodeToString(sum[:]), len(payload), len(payload))
	catalog, err := appreleasecatalog.LoadCatalog(stringReader(body))
	if err != nil {
		t.Fatalf("load external fixture release catalog: %v", err)
	}
	return catalog
}

func zipFixturePayload(t *testing.T) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for name, body := range map[string]string{
		"dist/index.html":        "<main>Nimi platform fixture</main>",
		"dist/assets/fixture.js": "globalThis.__nimiFixture = true;",
		"nimi-app.manifest.json": `{"appId":"community.nimi.fixture.platform-proof","entryRef":"dist/index.html"}`,
	} {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(body)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func newExternalFixtureInstallService(t *testing.T, descriptorPayload []byte, servedPayload []byte, visibility string) (*Service, string, string) {
	t.Helper()
	svc, _, dataRoot, nimiDir := newExternalFixtureInstallServiceWithRuntimeAppRegistry(t, descriptorPayload, servedPayload, visibility)
	return svc, dataRoot, nimiDir
}

func newExternalFixtureInstallServiceWithRuntimeAppRegistry(
	t *testing.T,
	descriptorPayload []byte,
	servedPayload []byte,
	visibility string,
) (*Service, *appregistry.Registry, string, string) {
	t.Helper()
	server := httptest.NewTLSServer(httpBytesHandler(servedPayload))
	t.Cleanup(server.Close)
	runtime, err := NewInstallRuntime(
		externalFixtureRegistry(t, visibility),
		externalFixtureReleaseCatalog(t, server.URL+"/fixture.zip", descriptorPayload),
		t.TempDir(),
		"",
		appinstallgateway.NewHTTPSDownloader(
			appinstallgateway.WithHTTPClient(server.Client()),
			appinstallgateway.WithAllowedArtifactHosts("127.0.0.1"),
		),
		appinstallgateway.NewArchiveUnpacker(),
	)
	if err != nil {
		t.Fatalf("NewInstallRuntime external fixture: %v", err)
	}
	runtimeAppRegistry := appregistry.New()
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	svc := New(testLogger(),
		WithInstallRuntime(runtime),
		WithSessionValidator(allowingAppSessionValidator{}),
		WithOpenAppReadinessVerifier(allowOpenReadinessVerifier{}),
		WithRuntimeAppRegistry(runtimeAppRegistry),
		WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{
			projection: &runtimev1.AccountProjection{AccountId: "account_1"},
			ok:         true,
		}),
		WithAccountAppInventoryStoreForTest(newAccountAppInventoryStoreForTest(nimiDir)),
	)
	seedAccountInventoryStateForTest(t, nimiDir, "account_1", "community.nimi.fixture.platform-proof", accountAppInventoryStateVerified, accountAppInstallStateNotInstalled)
	return svc, runtimeAppRegistry, runtime.dataRootRef, nimiDir
}

func httpBytesHandler(payload []byte) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(payload)
	}
}

func stringReader(s string) *os.File {
	// stringReader writes s to a temp file and returns it as an io.Reader
	// compatible *os.File. LoadCatalog/LoadRegistry accept any io.Reader.
	f, err := os.CreateTemp("", "app-install-test-*.yaml")
	if err != nil {
		panic(err)
	}
	if _, err := f.WriteString(s); err != nil {
		panic(err)
	}
	if _, err := f.Seek(0, io.SeekStart); err != nil {
		panic(err)
	}
	return f
}

func newBundledInstallService(t *testing.T) (*Service, string) {
	t.Helper()
	return newBundledInstallServiceWithOpenReadiness(t, allowOpenReadinessVerifier{})
}

func newBundledInstallServiceWithOpenReadiness(t *testing.T, verifier OpenAppReadinessVerifier) (*Service, string) {
	t.Helper()
	return newBundledInstallServiceWithRegistry(t, bundledRegistry(t), verifier)
}

func newBundledInstallServiceWithRegistry(t *testing.T, registry *appregistrycatalog.Registry, verifier OpenAppReadinessVerifier) (*Service, string) {
	svc, dataRoot, _ := newBundledInstallServiceWithRegistryAndAccountRow(t, registry, verifier, accountAppInventoryStateVerified, accountAppInstallStateNotInstalled)
	return svc, dataRoot
}

func newBundledInstallServiceWithRegistryAndAccountRow(
	t *testing.T,
	registry *appregistrycatalog.Registry,
	verifier OpenAppReadinessVerifier,
	accountState string,
	installState string,
) (*Service, string, string) {
	t.Helper()
	dataRoot := t.TempDir()
	bundledRoot := t.TempDir()
	appArtifact := filepath.Join(bundledRoot, "nimi.example-app")
	if err := os.MkdirAll(appArtifact, 0o755); err != nil {
		t.Fatalf("mkdir bundled artifact: %v", err)
	}
	if err := os.WriteFile(filepath.Join(appArtifact, "manifest.json"), []byte(`{"name":"example-app"}`), 0o644); err != nil {
		t.Fatalf("write bundled manifest: %v", err)
	}
	runtime, err := NewInstallRuntime(
		registry,
		bundledReleaseCatalog(t),
		dataRoot,
		bundledRoot,
		appinstallgateway.NewHTTPSDownloader(),
		appinstallgateway.NewArchiveUnpacker(),
	)
	if err != nil {
		t.Fatalf("NewInstallRuntime: %v", err)
	}
	nimiDir := filepath.Join(t.TempDir(), ".nimi")
	svc := New(testLogger(),
		WithInstallRuntime(runtime),
		WithSessionValidator(allowingAppSessionValidator{}),
		WithOpenAppReadinessVerifier(verifier),
		WithRuntimeAppRegistry(appregistry.New()),
		WithRuntimeAccountProjectionProvider(testRuntimeAccountProjectionProvider{
			projection: &runtimev1.AccountProjection{AccountId: "account_1"},
			ok:         true,
		}),
		WithAccountAppInventoryStoreForTest(newAccountAppInventoryStoreForTest(nimiDir)),
	)
	seedAccountInventoryStateForTest(t, nimiDir, "account_1", "nimi.example-app", accountState, installState)
	return svc, dataRoot, nimiDir
}

func seedAccountInventoryForTest(t *testing.T, nimiDir string, accountID string, appID string, installState string) {
	t.Helper()
	seedAccountInventoryStateForTest(t, nimiDir, accountID, appID, accountAppInventoryStateVerified, installState)
}

func seedAccountInventoryStateForTest(t *testing.T, nimiDir string, accountID string, appID string, accountState string, installState string) {
	t.Helper()
	accountDir := filepath.Join(nimiDir, "accounts", accountPathSegment(accountID))
	writeRuntimeProjectionJSON(t, filepath.Join(accountDir, "apps", "inventory.json"), fmt.Sprintf(`{
  "schemaVersion": 2,
  "accountId": %q,
  "updatedAt": "2026-06-02T00:00:00.000Z",
  "apps": [{
    "appId": %q,
    "accountState": %q,
    "installState": %q,
    "lastOpenedAt": null,
    "dataPolicy": "keep_on_uninstall",
    "verifiedAt": "2026-06-01T00:00:00.000Z",
    "source": "nimi-account"
  }]
}`, accountID, appID, accountState, installState))
}

func waitForTerminalJob(t *testing.T, svc *Service, jobID string) *runtimev1.AppInstallJob {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job, ok := svc.installJobs.getJob(jobID)
		if ok && installJobTerminal(job.GetState()) {
			return job
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("install job %s did not reach a terminal state", jobID)
	return nil
}

func TestInstallAppBundledReachesInstalled(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	if resp.GetJob().GetSourceKind() != runtimev1.AppInstallSourceKind_APP_INSTALL_SOURCE_KIND_BUNDLED {
		t.Fatalf("source kind = %v, want bundled", resp.GetJob().GetSourceKind())
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
	if job.GetPhase() != runtimev1.AppInstallJobPhase_APP_INSTALL_JOB_PHASE_INSTALLED {
		t.Fatalf("job phase = %v, want INSTALLED", job.GetPhase())
	}
	if _, err := os.Stat(filepath.Join(job.GetStorage().GetReleaseRoot(), "manifest.json")); err != nil {
		t.Fatalf("expected materialized release payload: %v", err)
	}
}

func TestInstallAppExternalFixtureVerifiesDigestAndCommitsActiveRelease(t *testing.T) {
	payload := zipFixturePayload(t)
	svc, dataRoot, _ := newExternalFixtureInstallService(t, payload, payload, "developer-only")
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{
		AppId:     "community.nimi.fixture.platform-proof",
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("InstallApp external fixture: %v", err)
	}
	if resp.GetJob().GetSourceKind() != runtimev1.AppInstallSourceKind_APP_INSTALL_SOURCE_KIND_EXTERNAL_ARTIFACT {
		t.Fatalf("source kind = %v, want external artifact", resp.GetJob().GetSourceKind())
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
	if job.GetSha256() == "" || job.GetArtifactBytes() != int64(len(payload)) {
		t.Fatalf("job digest/bytes = %q/%d", job.GetSha256(), job.GetArtifactBytes())
	}
	readiness, err := svc.GetAppPackageReadiness(context.Background(), &runtimev1.GetAppPackageReadinessRequest{
		AppId: "community.nimi.fixture.platform-proof",
	})
	if err != nil {
		t.Fatalf("GetAppPackageReadiness: %v", err)
	}
	proj := readiness.GetProjection()
	if proj.GetState() != runtimev1.AppPackageReadinessState_APP_PACKAGE_READINESS_STATE_READY {
		t.Fatalf("readiness state = %v detail=%q, want READY", proj.GetState(), proj.GetDetail())
	}
	if proj.GetVerificationState() != "digest-verified" {
		t.Fatalf("verification state = %q, want digest-verified", proj.GetVerificationState())
	}
	activePath := filepath.Join(dataRoot, "apps", "community.nimi.fixture.platform-proof", ".nimi", "active-release.json")
	if _, err := os.Stat(activePath); err != nil {
		t.Fatalf("active release pointer missing: %v", err)
	}
}

func TestInstallAppExternalFixtureDigestMismatchDoesNotCommitInstall(t *testing.T) {
	descriptorPayload := zipFixturePayload(t)
	servedPayload := append([]byte(nil), descriptorPayload...)
	servedPayload[len(servedPayload)-1] ^= 0xff
	svc, dataRoot, nimiDir := newExternalFixtureInstallService(t, descriptorPayload, servedPayload, "developer-only")
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{
		AppId:     "community.nimi.fixture.platform-proof",
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("InstallApp external fixture mismatch: %v", err)
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_FAILED {
		t.Fatalf("job state = %v detail=%q, want FAILED", job.GetState(), job.GetFailureDetail())
	}
	if job.GetReasonCode() != runtimev1.ReasonCode_APP_INSTALL_DIGEST_MISMATCH {
		t.Fatalf("reason = %v, want APP_INSTALL_DIGEST_MISMATCH", job.GetReasonCode())
	}
	activePath := filepath.Join(dataRoot, "apps", "community.nimi.fixture.platform-proof", ".nimi", "active-release.json")
	if _, err := os.Stat(activePath); !os.IsNotExist(err) {
		t.Fatalf("active release pointer must not be committed, stat err=%v", err)
	}
	record, err := newAccountAppInventoryStoreForTest(nimiDir).readOrEmpty("account_1")
	if err != nil {
		t.Fatalf("read account inventory: %v", err)
	}
	if len(record.Apps) != 1 || record.Apps[0].InstallState != accountAppInstallStateNotInstalled {
		t.Fatalf("account inventory mutated after failed install: %+v", record.Apps)
	}
}

func TestInstallAppUpdatesRuntimeOwnedAccountInventoryProjection(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
	record, err := svc.accountInventory.readOrEmpty("account_1")
	if err != nil {
		t.Fatalf("read account inventory: %v", err)
	}
	if len(record.Apps) != 1 {
		t.Fatalf("inventory apps = %d, want 1", len(record.Apps))
	}
	row := record.Apps[0]
	if row.AppID != "nimi.example-app" || row.AccountState != accountAppInventoryStateVerified || row.InstallState != accountAppInstallStateInstalled {
		t.Fatalf("unexpected account inventory row: %+v", row)
	}
}

func TestInstallAppRejectsUnknownApp(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.unknown"})
	if err == nil {
		t.Fatal("expected unknown app rejection")
	}
}

func TestInstallAppRequiresInstallRuntime(t *testing.T) {
	svc := New(testLogger())
	_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app"})
	if err == nil {
		t.Fatal("expected fail-closed without install runtime")
	}
}

func TestInstallAppRejectsNonLaunchableAccountInventoryBeforeCreatingJob(t *testing.T) {
	svc, dataRoot, _ := newBundledInstallServiceWithRegistryAndAccountRow(
		t,
		bundledRegistry(t),
		allowOpenReadinessVerifier{},
		accountAppInventoryStateDisabled,
		accountAppInstallStateNotInstalled,
	)
	_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err == nil {
		t.Fatal("expected non-launchable account app-inventory row rejection")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason = %v ok=%v, want APP_OPEN_LIBRARY_STATE_INVALID", reason, ok)
	}
	if jobs := svc.installJobs.listJobs("nimi.example-app"); len(jobs) != 0 {
		t.Fatalf("install preflight must not create jobs, got %d", len(jobs))
	}
	if entries, readErr := os.ReadDir(dataRoot); readErr != nil || len(entries) != 0 {
		t.Fatalf("install preflight must not materialize package payloads, entries=%d err=%v", len(entries), readErr)
	}
}

func TestUninstallAppRejectsNonLaunchableAccountInventoryBeforeRemovingRelease(t *testing.T) {
	svc, _, nimiDir := newBundledInstallServiceWithRegistryAndAccountRow(
		t,
		bundledRegistry(t),
		allowOpenReadinessVerifier{},
		accountAppInventoryStateVerified,
		accountAppInstallStateNotInstalled,
	)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
	beforeJobs := len(svc.installJobs.listJobs("nimi.example-app"))
	seedAccountInventoryStateForTest(t, nimiDir, "account_1", "nimi.example-app", accountAppInventoryStateRevoked, accountAppInstallStateInstalled)

	_, err = svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "nimi.example-app"})
	if err == nil {
		t.Fatal("expected non-launchable account app-inventory row rejection")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_APP_OPEN_LIBRARY_STATE_INVALID {
		t.Fatalf("reason = %v ok=%v, want APP_OPEN_LIBRARY_STATE_INVALID", reason, ok)
	}
	if afterJobs := len(svc.installJobs.listJobs("nimi.example-app")); afterJobs != beforeJobs {
		t.Fatalf("uninstall preflight must not create a new job, before=%d after=%d", beforeJobs, afterJobs)
	}
	if _, statErr := os.Stat(job.GetStorage().GetReleaseRoot()); statErr != nil {
		t.Fatalf("uninstall preflight must not remove release root: %v", statErr)
	}
}

func TestGetAppInstallJobReturnsTypedProjection(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	got, err := svc.GetAppInstallJob(context.Background(), &runtimev1.GetAppInstallJobRequest{JobId: resp.GetJob().GetJobId()})
	if err != nil {
		t.Fatalf("GetAppInstallJob: %v", err)
	}
	if got.GetJob().GetJobId() != resp.GetJob().GetJobId() {
		t.Fatalf("job id mismatch")
	}
}

func TestUninstallAppRemovesReleaseKeepsData(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	job := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("install must succeed before uninstall: %v", job.GetFailureDetail())
	}
	durableData := job.GetStorage().GetDurableDataRoot()
	if err := os.WriteFile(filepath.Join(durableData, "user.json"), []byte(`{}`), 0o644); err != nil {
		t.Fatalf("seed durable data: %v", err)
	}

	uninstall, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "nimi.example-app"})
	if err != nil {
		t.Fatalf("UninstallApp: %v", err)
	}
	if !uninstall.GetResult().GetReleaseRemoved() {
		t.Fatal("expected release removed")
	}
	if uninstall.GetResult().GetDurableDataRemoved() {
		t.Fatal("durable data must be kept by default")
	}
	if _, err := os.Stat(job.GetStorage().GetReleaseRoot()); !os.IsNotExist(err) {
		t.Fatalf("release root should be removed, err=%v", err)
	}
	if _, err := os.Stat(filepath.Join(durableData, "user.json")); err != nil {
		t.Fatalf("durable data must be kept: %v", err)
	}
}

func TestUninstallAppRejectsUnconfirmedDestructiveDelete(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{
		AppId:             "nimi.example-app",
		DeleteDurableData: true,
	})
	if err == nil {
		t.Fatal("expected unconfirmed destructive delete rejection")
	}
}

func TestWatchAppInstallJobEventsStreamsProgress(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	stream := newRecordingInstallEventStream()
	done := make(chan error, 1)
	go func() {
		done <- svc.WatchAppInstallJobEvents(&runtimev1.WatchAppInstallJobEventsRequest{JobId: resp.GetJob().GetJobId()}, stream)
	}()
	waitForTerminalJob(t, svc, resp.GetJob().GetJobId())

	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if stream.terminalSeen() {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	stream.cancel()
	<-done
	if !stream.terminalSeen() {
		t.Fatal("expected a terminal install job event on the watch stream")
	}
}

func TestUpdateAppRejectsNotInstalled(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{AppId: "nimi.example-app"})
	if err == nil {
		t.Fatal("expected fail-closed: app not installed")
	}
}

func TestUpdateAppRejectsAlreadyAtBoundVersion(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	// The bound bundled descriptor version equals the active version: no update.
	_, err = svc.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{AppId: "nimi.example-app"})
	if err == nil {
		t.Fatal("expected fail-closed: update not available")
	}
}

func TestHealthRepairRejectsUnknownAction(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.example-app",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_UNSPECIFIED,
	})
	if err == nil {
		t.Fatal("expected fail-closed: invalid repair action")
	}
}

func TestHealthRepairRepairRematerializesRelease(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	installed := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	// Damage the release payload.
	if err := os.WriteFile(filepath.Join(installed.GetStorage().GetReleaseRoot(), "manifest.json"), []byte("damaged"), 0o644); err != nil {
		t.Fatalf("damage release: %v", err)
	}
	repairResp, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.example-app",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REPAIR,
	})
	if err != nil {
		t.Fatalf("HealthRepairApp repair: %v", err)
	}
	if repairResp.GetJob().GetKind() != runtimev1.AppLifecycleJobKind_APP_LIFECYCLE_JOB_KIND_REPAIR {
		t.Fatalf("repair job kind = %v, want REPAIR", repairResp.GetJob().GetKind())
	}
	job := waitForTerminalJob(t, svc, repairResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("repair job state = %v detail=%q, want INSTALLED", job.GetState(), job.GetFailureDetail())
	}
	got, err := os.ReadFile(filepath.Join(job.GetStorage().GetReleaseRoot(), "manifest.json"))
	if err != nil {
		t.Fatalf("read repaired manifest: %v", err)
	}
	if string(got) != `{"name":"example-app"}` {
		t.Fatalf("repair must re-materialize a clean release payload, got %q", string(got))
	}
}

func TestHealthRepairReinstallKeepsData(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.example-app", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	installed := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	durableFile := filepath.Join(installed.GetStorage().GetDurableDataRoot(), "state.json")
	if err := os.MkdirAll(installed.GetStorage().GetDurableDataRoot(), 0o755); err != nil {
		t.Fatalf("mkdir durable data: %v", err)
	}
	if err := os.WriteFile(durableFile, []byte(`{"k":"v"}`), 0o600); err != nil {
		t.Fatalf("write durable data: %v", err)
	}
	reinstallResp, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.example-app",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_REINSTALL,
	})
	if err != nil {
		t.Fatalf("HealthRepairApp reinstall: %v", err)
	}
	job := waitForTerminalJob(t, svc, reinstallResp.GetJob().GetJobId())
	if job.GetState() != runtimev1.AppInstallJobState_APP_INSTALL_JOB_STATE_INSTALLED {
		t.Fatalf("reinstall job state = %v, want INSTALLED", job.GetState())
	}
	if _, err := os.Stat(durableFile); err != nil {
		t.Fatalf("reinstall must keep durable data: %v", err)
	}
}

func TestHealthRepairRetryWithoutRecoverableJobFailsClosed(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.example-app",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_RETRY,
	})
	if err == nil {
		t.Fatal("expected fail-closed: no recoverable job to retry")
	}
}

func TestHealthRepairCancelWithoutInFlightJobFailsClosed(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.example-app",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_CANCEL,
	})
	if err == nil {
		t.Fatal("expected fail-closed: no in-flight job to cancel")
	}
}

func TestIsBreakingUpdate(t *testing.T) {
	cases := []struct {
		from, to string
		breaking bool
	}{
		{"1.0.0", "1.2.0", false},
		{"1.0.0", "2.0.0", true},
		{"2.3.1", "2.3.4", false},
		{"1.0.0", "not-a-version", true},
		{"bundled-with-current-nimi-release", "1.0.0", true},
	}
	for _, c := range cases {
		if got := isBreakingUpdate(c.from, c.to); got != c.breaking {
			t.Fatalf("isBreakingUpdate(%q,%q) = %v, want %v", c.from, c.to, got, c.breaking)
		}
	}
}
