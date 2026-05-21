package app

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/appinstallgateway"
	"github.com/nimiplatform/nimi/runtime/internal/appregistrycatalog"
	"github.com/nimiplatform/nimi/runtime/internal/appreleasecatalog"
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

func bundledRegistry(t *testing.T) *appregistrycatalog.Registry {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: test_nimi_app_registry
apps:
  - app_id: nimi.parentos
    display_label: ParentOS
    publisher: nimi-first-party
    trust_tier_ref: nimi-first-party
    package_kind: nimi-app
    runtime_registration_mode: app-managed
    ordinary_visibility: ordinary-visible
    release_descriptor_ref: nimi.parentos.bundled-with-nimi
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

func bundledReleaseCatalog(t *testing.T) *appreleasecatalog.Catalog {
	t.Helper()
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: nimi.parentos.bundled-with-nimi
    app_id: nimi.parentos
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
      entry_ref: parentos-runtime-registration
      sandbox_ref: first-party-bundled-app
    permissions_ref: nimi.parentos.permission_scope_ref
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
	dataRoot := t.TempDir()
	bundledRoot := t.TempDir()
	appArtifact := filepath.Join(bundledRoot, "nimi.parentos")
	if err := os.MkdirAll(appArtifact, 0o755); err != nil {
		t.Fatalf("mkdir bundled artifact: %v", err)
	}
	if err := os.WriteFile(filepath.Join(appArtifact, "manifest.json"), []byte(`{"name":"parentos"}`), 0o644); err != nil {
		t.Fatalf("write bundled manifest: %v", err)
	}
	runtime, err := NewInstallRuntime(
		bundledRegistry(t),
		bundledReleaseCatalog(t),
		dataRoot,
		bundledRoot,
		appinstallgateway.NewHTTPSDownloader(),
		appinstallgateway.NewArchiveUnpacker(),
	)
	if err != nil {
		t.Fatalf("NewInstallRuntime: %v", err)
	}
	svc := New(testLogger(), WithInstallRuntime(runtime))
	return svc, dataRoot
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
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
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

func TestInstallAppRejectsUnknownApp(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.unknown"})
	if err == nil {
		t.Fatal("expected unknown app rejection")
	}
}

func TestInstallAppRequiresInstallRuntime(t *testing.T) {
	svc := New(testLogger())
	_, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos"})
	if err == nil {
		t.Fatal("expected fail-closed without install runtime")
	}
}

func TestGetAppInstallJobReturnsTypedProjection(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
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
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
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

	uninstall, err := svc.UninstallApp(context.Background(), &runtimev1.UninstallAppRequest{AppId: "nimi.parentos"})
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
		AppId:             "nimi.parentos",
		DeleteDurableData: true,
	})
	if err == nil {
		t.Fatal("expected unconfirmed destructive delete rejection")
	}
}

func TestWatchAppInstallJobEventsStreamsProgress(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	stream := newRecordingInstallEventStream()
	done := make(chan error, 1)
	go func() {
		done <- svc.WatchAppInstallJobEvents(&runtimev1.WatchAppInstallJobEventsRequest{}, stream)
	}()

	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
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
	_, err := svc.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{AppId: "nimi.parentos"})
	if err == nil {
		t.Fatal("expected fail-closed: app not installed")
	}
}

func TestUpdateAppRejectsAlreadyAtBoundVersion(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	// The bound bundled descriptor version equals the active version: no update.
	_, err = svc.UpdateApp(context.Background(), &runtimev1.UpdateAppRequest{AppId: "nimi.parentos"})
	if err == nil {
		t.Fatal("expected fail-closed: update not available")
	}
}

func TestHealthRepairRejectsUnknownAction(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.parentos",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_UNSPECIFIED,
	})
	if err == nil {
		t.Fatal("expected fail-closed: invalid repair action")
	}
}

func TestHealthRepairRepairRematerializesRelease(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
	if err != nil {
		t.Fatalf("InstallApp: %v", err)
	}
	installed := waitForTerminalJob(t, svc, resp.GetJob().GetJobId())
	// Damage the release payload.
	if err := os.WriteFile(filepath.Join(installed.GetStorage().GetReleaseRoot(), "manifest.json"), []byte("damaged"), 0o644); err != nil {
		t.Fatalf("damage release: %v", err)
	}
	repairResp, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.parentos",
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
	if string(got) != `{"name":"parentos"}` {
		t.Fatalf("repair must re-materialize a clean release payload, got %q", string(got))
	}
}

func TestHealthRepairReinstallKeepsData(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	resp, err := svc.InstallApp(context.Background(), &runtimev1.InstallAppRequest{AppId: "nimi.parentos", Confirmed: true})
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
		AppId:  "nimi.parentos",
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
		AppId:  "nimi.parentos",
		Action: runtimev1.AppHealthRepairAction_APP_HEALTH_REPAIR_ACTION_RETRY,
	})
	if err == nil {
		t.Fatal("expected fail-closed: no recoverable job to retry")
	}
}

func TestHealthRepairCancelWithoutInFlightJobFailsClosed(t *testing.T) {
	svc, _ := newBundledInstallService(t)
	_, err := svc.HealthRepairApp(context.Background(), &runtimev1.HealthRepairAppRequest{
		AppId:  "nimi.parentos",
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
