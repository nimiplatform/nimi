package grpcserver

import (
	"bytes"
	"context"
	"crypto/rand"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/health"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
)

func TestNewConfiguresRuntimeAgentDefaultExecutors(t *testing.T) {
	t.Parallel()

	cfg := config.Config{
		GRPCAddr:             "127.0.0.1:0",
		HTTPAddr:             "127.0.0.1:0",
		ShutdownTimeout:      2 * time.Second,
		LocalStatePath:       filepath.Join(t.TempDir(), "local-state.json"),
		AuditRingBufferSize:  64,
		UsageStatsBufferSize: 64,
		IdempotencyCapacity:  32,
	}
	server, err := NewNonProduction(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
	if err != nil {
		t.Fatalf("grpcserver.New: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
		if svc := server.LocalService(); svc != nil {
			svc.Close()
		}
		if svc := server.MemoryService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.CognitionService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.AgentService(); svc != nil {
			svc.Close()
		}
	})

	agentSvc := server.AgentService()
	if agentSvc == nil {
		t.Fatal("expected runtime agent service")
	}
	appSvc := server.AppService()
	if appSvc == nil {
		t.Fatal("expected app service")
	}
	accountSvc := server.AccountService()
	if accountSvc == nil {
		t.Fatal("expected active account service")
	}
	status, err := accountSvc.GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{
		Caller: &runtimev1.AccountCaller{
			AppId:         "nimi.desktop",
			AppInstanceId: "desktop-test",
			Mode:          runtimev1.AccountCallerMode_ACCOUNT_CALLER_MODE_DESKTOP_SHELL,
		},
	})
	if err != nil {
		t.Fatalf("account status: %v", err)
	}
	if !status.GetProductionInert() {
		t.Fatal("non-production server must not activate production account custody")
	}
	if !agentSvc.HasLifeTrackExecutor() {
		t.Fatal("expected life-track executor to be configured")
	}
	if !agentSvc.HasChatTrackSidecarExecutor() {
		t.Fatal("expected chat-track sidecar executor to be configured")
	}
	if !agentSvc.HasPublicChatBindingResolver() {
		t.Fatal("expected public chat binding resolver to be configured")
	}
	if !agentSvc.HasPublicChatTurnExecutor() {
		t.Fatal("expected public chat turn executor to be configured")
	}
	if !agentSvc.HasCanonicalReviewExecutor() {
		t.Fatal("expected canonical review executor to be configured")
	}
	if !agentSvc.HasRealmGroupMessageCandidateExecutor() {
		t.Fatal("expected realm group message candidate executor to be configured")
	}
	if !agentSvc.HasVoiceLipsyncScenarioExecutor() {
		t.Fatal("expected voice/lipsync scenario executor to be configured")
	}
	if !appSvc.HasInternalConsumer("runtime.agent.internal.chat_track_sidecar") {
		t.Fatal("expected runtime.agent.internal.chat_track_sidecar app consumer to be configured")
	}
	if !appSvc.HasInternalConsumer("runtime.agent") {
		t.Fatal("expected runtime.agent app consumer to be configured")
	}
}

func TestProtectedServiceUsesOnlyVerifiedSecurityBindings(t *testing.T) {
	t.Parallel()

	serviceStateRoot := t.TempDir()
	if _, err := NewProtectedService(config.Config{}, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test", ProtectedServiceBindings{
		ServiceStateRoot: serviceStateRoot,
	}); err == nil {
		t.Fatal("protected service must reject missing custody bindings")
	}

	userStateRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(userStateRoot, "connectors"), 0o700); err != nil {
		t.Fatalf("create untrusted connector root: %v", err)
	}
	if err := os.WriteFile(filepath.Join(userStateRoot, "connectors", "connector-registry.json"), []byte("not-json"), 0o600); err != nil {
		t.Fatalf("write untrusted connector registry: %v", err)
	}
	cfg := config.Config{
		GRPCAddr:                "127.0.0.1:0",
		HTTPAddr:                "127.0.0.1:0",
		ShutdownTimeout:         2 * time.Second,
		LocalStatePath:          filepath.Join(userStateRoot, "local-state.json"),
		AccountRealmBaseURL:     "https://user-config.invalid",
		AccountAuthorizationURL: "https://user-config.invalid/oauth/authorize",
		AccountTokenURL:         "https://user-config.invalid/oauth/token",
		AuditRingBufferSize:     64,
		UsageStatsBufferSize:    64,
		IdempotencyCapacity:     32,
	}
	authorities := newProtectedAuthoritiesForServerTest(t)
	server, err := NewProtectedService(
		cfg,
		health.NewState(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		ProtectedServiceBindings{
			ServiceStateRoot: serviceStateRoot,
			AccountCustody:   emptyProtectedAccountCustody{},
			AccountPartition: "verified-user-and-logon-session",
			ConnectorSecrets: emptyProtectedConnectorSecrets{},
			DesktopSessions:  authorities.desktop,
			LifecycleIntents: authorities.lifecycle,
		},
	)
	if err != nil {
		t.Fatalf("protected service must ignore user-config security roots: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
		if svc := server.LocalService(); svc != nil {
			svc.Close()
		}
		if svc := server.MemoryService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.CognitionService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.AgentService(); svc != nil {
			svc.Close()
		}
	})
	status, err := server.AccountService().GetAccountSessionStatus(context.Background(), &runtimev1.GetAccountSessionStatusRequest{})
	if err != nil {
		t.Fatalf("protected account status: %v", err)
	}
	if status.GetProductionInert() {
		t.Fatal("verified protected bindings must activate the production account service")
	}
	if _, err := server.authService.OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{}); err == nil {
		t.Fatal("plain context unexpectedly opened a protected Desktop session")
	} else if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED {
		t.Fatalf("protected auth service manager injection reason = %v (present=%v), err=%v", reason, ok, err)
	}
}

func TestProtectedServiceDoesNotRegisterPublicRuntimeGrantService(t *testing.T) {
	authorities := newProtectedAuthoritiesForServerTest(t)
	server, err := NewProtectedService(
		config.Config{
			GRPCAddr:             "127.0.0.1:0",
			HTTPAddr:             "127.0.0.1:0",
			ShutdownTimeout:      2 * time.Second,
			AuditRingBufferSize:  64,
			UsageStatsBufferSize: 64,
			IdempotencyCapacity:  32,
		},
		health.NewState(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		ProtectedServiceBindings{
			ServiceStateRoot: t.TempDir(),
			AccountCustody:   emptyProtectedAccountCustody{},
			AccountPartition: "verified-user-and-logon-session",
			ConnectorSecrets: emptyProtectedConnectorSecrets{},
			DesktopSessions:  authorities.desktop,
			LifecycleIntents: authorities.lifecycle,
		},
	)
	if err != nil {
		t.Fatalf("NewProtectedService: %v", err)
	}
	t.Cleanup(func() {
		_ = server.Stop(context.Background())
		if svc := server.LocalService(); svc != nil {
			svc.Close()
		}
		if svc := server.MemoryService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.CognitionService(); svc != nil {
			_ = svc.Close()
		}
		if svc := server.AgentService(); svc != nil {
			svc.Close()
		}
	})
	if _, registered := server.grpcServer.GetServiceInfo()["nimi.runtime.v1.RuntimeGrantService"]; registered {
		t.Fatal("protected Runtime must not register the public RuntimeGrantService")
	}
}

func TestProtectedServiceRejectsMissingDesktopSessionAuthority(t *testing.T) {
	for name, manager := range map[string]*protectedlocal.DesktopSessionManager{
		"missing": nil,
		"zero":    {},
	} {
		t.Run(name, func(t *testing.T) {
			server, err := NewProtectedService(
				config.Config{
					GRPCAddr:                "127.0.0.1:0",
					HTTPAddr:                "127.0.0.1:0",
					ShutdownTimeout:         2 * time.Second,
					AuditRingBufferSize:     64,
					UsageStatsBufferSize:    64,
					IdempotencyCapacity:     32,
					AccountRealmBaseURL:     "https://portable.invalid",
					AccountAuthorizationURL: "https://portable.invalid/oauth/authorize",
					AccountTokenURL:         "https://portable.invalid/oauth/token",
				},
				health.NewState(),
				slog.New(slog.NewTextHandler(io.Discard, nil)),
				"test",
				ProtectedServiceBindings{
					ServiceStateRoot: t.TempDir(),
					AccountCustody:   emptyProtectedAccountCustody{},
					AccountPartition: "verified-user-and-logon-session",
					ConnectorSecrets: emptyProtectedConnectorSecrets{},
					DesktopSessions:  manager,
					LifecycleIntents: &protectedlocal.LifecycleIntentManager{},
				},
			)
			if server != nil {
				_ = server.Stop(context.Background())
			}
			if err == nil {
				t.Fatal("protected service accepted incomplete Desktop session authority")
			}
		})
	}
}

func TestProtectedServiceRejectsMismatchedLifecycleIntentAuthority(t *testing.T) {
	first := newProtectedAuthoritiesForServerTest(t)
	second := newProtectedAuthoritiesForServerTest(t)
	for name, lifecycle := range map[string]*protectedlocal.LifecycleIntentManager{
		"zero":        {},
		"other_state": second.lifecycle,
	} {
		t.Run(name, func(t *testing.T) {
			server, err := NewProtectedService(
				config.Config{},
				health.NewState(),
				slog.New(slog.NewTextHandler(io.Discard, nil)),
				"test",
				ProtectedServiceBindings{
					ServiceStateRoot: t.TempDir(),
					AccountCustody:   emptyProtectedAccountCustody{},
					AccountPartition: "verified-user-and-logon-session",
					ConnectorSecrets: emptyProtectedConnectorSecrets{},
					DesktopSessions:  first.desktop,
					LifecycleIntents: lifecycle,
				},
			)
			if server != nil {
				_ = server.Stop(context.Background())
			}
			if err == nil {
				t.Fatal("protected service accepted mismatched lifecycle intent authority")
			}
		})
	}
}

type protectedAuthoritiesForServerTest struct {
	desktop   *protectedlocal.DesktopSessionManager
	lifecycle *protectedlocal.LifecycleIntentManager
}

func newProtectedAuthoritiesForServerTest(t *testing.T) protectedAuthoritiesForServerTest {
	t.Helper()
	directory := t.TempDir()
	anchor, err := protectedlocal.NewFileAnchorStore(
		filepath.Join(directory, "protected_local.anchor"),
		bytes.Repeat([]byte{0x91}, protectedlocal.IdentifierBytes),
	)
	if err != nil {
		t.Fatalf("create protected test anchor: %v", err)
	}
	ledger, err := protectedlocal.OpenLedger(context.Background(), protectedlocal.LedgerOptions{
		Path:         filepath.Join(directory, protectedlocal.LedgerFilename),
		AnchorStore:  anchor,
		RecordMACKey: bytes.Repeat([]byte{0x92}, protectedlocal.IdentifierBytes),
		Random:       rand.Reader,
	})
	if err != nil {
		t.Fatalf("open protected test ledger: %v", err)
	}
	t.Cleanup(func() { _ = ledger.Close() })
	bootEpoch, err := ledger.StartRuntime(context.Background())
	if err != nil {
		t.Fatalf("start protected test Runtime: %v", err)
	}
	desktop, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader, ledger)
	if err != nil {
		t.Fatalf("create protected test Desktop session manager: %v", err)
	}
	lifecycle, err := protectedlocal.NewLifecycleIntentManager(protectedlocal.LifecycleIntentManagerOptions{
		Sessions: desktop,
		Ledger:   ledger,
	})
	if err != nil {
		t.Fatalf("create protected test lifecycle intent manager: %v", err)
	}
	return protectedAuthoritiesForServerTest{desktop: desktop, lifecycle: lifecycle}
}

type emptyProtectedAccountCustody struct{}

func (emptyProtectedAccountCustody) Load(context.Context, string) (accountservice.AccountMaterial, error) {
	return accountservice.AccountMaterial{}, accountservice.ErrNoStoredAccount
}

func (emptyProtectedAccountCustody) Store(context.Context, string, accountservice.AccountMaterial) error {
	return nil
}

func (emptyProtectedAccountCustody) Clear(context.Context, string) error { return nil }

type emptyProtectedConnectorSecrets struct{}

func (emptyProtectedConnectorSecrets) WriteSecret(string, string) error { return nil }

func (emptyProtectedConnectorSecrets) ReadSecret(string) (string, bool, error) {
	return "", false, nil
}

func (emptyProtectedConnectorSecrets) DeleteSecret(string) error { return nil }

func TestLoadNimiAppRegistryCatalog(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nimi-app-registry.yaml")
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
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nimi-app-release-descriptors.yaml"), []byte(exampleAppReleaseDescriptorYAML("nimi.example-app", "nimi-data-app-roots")), 0o600); err != nil {
		t.Fatalf("write release descriptors: %v", err)
	}

	registry, releases, err := loadNimiAppRegistryCatalog(path)
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	if registry == nil {
		t.Fatal("expected registry")
	}
	if releases == nil {
		t.Fatal("expected release descriptor catalog")
	}
	eligibility, err := registry.CheckCallerEligibility("nimi.example-app")
	if err != nil {
		t.Fatalf("check eligibility: %v", err)
	}
	if eligibility.Eligible {
		t.Fatalf("expected admitted example-app to remain install-required until verified")
	}
	if eligibility.Reason != "app-install-required" {
		t.Fatalf("expected install-required eligibility, reason=%s", eligibility.Reason)
	}
}

func TestLoadNimiAppRegistryCatalogRejectsCrossAppDescriptorBinding(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nimi-app-registry.yaml")
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
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nimi-app-release-descriptors.yaml"), []byte(exampleAppReleaseDescriptorYAML("other.app", "nimi-data-app-roots")), 0o600); err != nil {
		t.Fatalf("write release descriptors: %v", err)
	}

	_, _, err := loadNimiAppRegistryCatalog(path)
	if err == nil {
		t.Fatal("expected cross-app descriptor binding rejection")
	}
	if !strings.Contains(err.Error(), "release descriptor belongs to a different app") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadNimiAppRegistryCatalogRejectsDescriptorStorageMismatch(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nimi-app-registry.yaml")
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
    install_storage_policy_ref: other-storage-policy
    admission_status: admitted
    source_rule: P-NAPP-011
`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}
	if err := os.WriteFile(filepath.Join(dir, "nimi-app-release-descriptors.yaml"), []byte(exampleAppReleaseDescriptorYAML("nimi.example-app", "nimi-data-app-roots")), 0o600); err != nil {
		t.Fatalf("write release descriptors: %v", err)
	}

	_, _, err := loadNimiAppRegistryCatalog(path)
	if err == nil {
		t.Fatal("expected descriptor storage mismatch rejection")
	}
	if !strings.Contains(err.Error(), "storage policy does not match") {
		t.Fatalf("error = %v", err)
	}
}

func TestLoadNimiAppRegistryCatalogEmptyPath(t *testing.T) {
	registry, releases, err := loadNimiAppRegistryCatalog("")
	if err != nil {
		t.Fatalf("empty path should not error: %v", err)
	}
	if registry != nil {
		t.Fatalf("empty path should not load registry")
	}
	if releases != nil {
		t.Fatalf("empty path should not load release descriptor catalog")
	}
}

func exampleAppReleaseDescriptorYAML(appID string, storagePolicyRef string) string {
	return `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_release_descriptors
descriptors:
  - descriptor_id: nimi.example-app.bundled-with-nimi
    app_id: ` + appID + `
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
    storage_policy_ref: ` + storagePolicyRef + `
    review:
      admission_path: first-party-bundled-release
      mutable_source_allowed: false
      install_digest_verification_required: inherited_from_atomic_bundle
    source_rule: P-NAPP-014
`
}

func TestDefaultFirstPartyMigrationLaunchGate(t *testing.T) {
	gate := defaultFirstPartyMigrationLaunchGate()
	nonHardcut := gate.Evaluate("nimi.example-app")
	if !nonHardcut.Admitted {
		t.Fatalf("non-hardcut app should admit immediately: %+v", nonHardcut)
	}
	avatar := gate.Evaluate("nimi.avatar")
	if !avatar.Admitted {
		t.Fatalf("Avatar should be admitted after master gate clearance: %+v", avatar)
	}
}
