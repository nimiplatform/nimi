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
	"github.com/nimiplatform/nimi/runtime/internal/localappkernel"
	"github.com/nimiplatform/nimi/runtime/internal/protectedlocal"
	accountservice "github.com/nimiplatform/nimi/runtime/internal/services/account"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
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
	productControlRoot := filepath.Join(t.TempDir(), ".nimi")
	cfg.LocalStatePath = filepath.Join(productControlRoot, "runtime", "local-state.json")
	server, err := newServer(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test", nil, productControlRoot, localservice.ProductControlDataRootSecurityBinding{})
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
	if status.GetAccepted() || status.GetSnapshot() != nil || status.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_INERT_NOT_ACTIVATED {
		t.Fatalf("non-production account status must reject without a snapshot: %+v", status)
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
	consentStorePath := filepath.Join(t.TempDir(), "local-development.db")
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
	untrustedIdentityProjection := filepath.Join(userStateRoot, "nimi-app-identity-surfaces.yaml")
	if err := os.WriteFile(untrustedIdentityProjection, []byte("apps: ["), 0o600); err != nil {
		t.Fatalf("write untrusted app identity projection: %v", err)
	}
	cfg := config.Config{
		GRPCAddr:                  "127.0.0.1:0",
		HTTPAddr:                  "127.0.0.1:0",
		ShutdownTimeout:           2 * time.Second,
		LocalStatePath:            filepath.Join(userStateRoot, "local-state.json"),
		AccountRealmBaseURL:       "https://user-config.invalid",
		AccountAuthorizationURL:   "https://user-config.invalid/oauth/authorize",
		AccountTokenURL:           "https://user-config.invalid/oauth/token",
		AppIdentityProjectionPath: untrustedIdentityProjection,
		AppBundledArtifactsRoot:   filepath.Join(userStateRoot, "untrusted-bundled-apps"),
		AuditRingBufferSize:       64,
		UsageStatsBufferSize:      64,
		IdempotencyCapacity:       32,
	}
	authorities := newProtectedAuthoritiesForServerTest(t)
	server, err := NewProtectedService(
		cfg,
		health.NewState(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		ProtectedServiceBindings{
			ServiceStateRoot:                 serviceStateRoot,
			ProductControlRoot:               filepath.Join(t.TempDir(), ".nimi"),
			RuntimeServiceSID:                protectedlocal.WindowsProductionServiceSID,
			LocalDevelopmentConsentStorePath: consentStorePath,
			AccountCustody:                   emptyProtectedAccountCustody{},
			AccountPartition:                 "verified-user-and-logon-session",
			LocalOSUserIdentity:              verifiedServerTestIdentity(t),
			ConnectorSecrets:                 emptyProtectedConnectorSecrets{},
			DesktopSessions:                  authorities.desktop,
			LocalAppLaunches:                 authorities.localApps,
			LocalDevelopmentVerifier:         serverTestLocalDevelopmentVerifier{},
			RuntimeRestartRequester:          func() bool { return true },
		},
	)
	if err != nil {
		t.Fatalf("protected service must ignore user-config security roots: %v", err)
	}
	if _, err := os.Stat(consentStorePath); err != nil {
		t.Fatalf("protected service did not create the stable consent store: %v", err)
	}
	if _, err := os.Stat(filepath.Join(serviceStateRoot, "local-development.db")); !os.IsNotExist(err) {
		t.Fatalf("candidate-local service root must not own project consent: %v", err)
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
	if status.GetAccepted() || status.GetSnapshot() != nil || status.GetAccountReasonCode() != runtimev1.AccountReasonCode_ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED {
		t.Fatalf("active protected account service must reach caller validation without exposing a snapshot: %+v", status)
	}
	if _, err := server.authService.OpenDesktopSession(context.Background(), &runtimev1.OpenDesktopSessionRequest{}); err == nil {
		t.Fatal("plain context unexpectedly opened a protected Desktop session")
	} else if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_DESKTOP_CONTROL_TRANSPORT_REQUIRED {
		t.Fatalf("protected auth service manager injection reason = %v (present=%v), err=%v", reason, ok, err)
	}
}

func TestProtectedServiceRejectsPortableProtectedResourceBindings(t *testing.T) {
	authorities := newProtectedAuthoritiesForServerTest(t)
	_, err := NewProtectedService(
		config.Config{},
		health.NewState(),
		slog.New(slog.NewTextHandler(io.Discard, nil)),
		"test",
		ProtectedServiceBindings{
			ServiceStateRoot:                  t.TempDir(),
			ProductControlRoot:                filepath.Join(t.TempDir(), ".nimi"),
			RuntimeServiceSID:                 protectedlocal.WindowsProductionServiceSID,
			LocalDevelopmentConsentStorePath:  filepath.Join(t.TempDir(), "local-development.db"),
			PlatformAppIdentityProjectionPath: "relative/nimi-app-identity-surfaces.yaml",
			AccountCustody:                    emptyProtectedAccountCustody{},
			AccountPartition:                  "verified-user-and-logon-session",
			LocalOSUserIdentity:               verifiedServerTestIdentity(t),
			ConnectorSecrets:                  emptyProtectedConnectorSecrets{},
			DesktopSessions:                   authorities.desktop,
			LocalAppLaunches:                  authorities.localApps,
			LocalDevelopmentVerifier:          serverTestLocalDevelopmentVerifier{},
			RuntimeRestartRequester:           func() bool { return true },
		},
	)
	if err == nil || !strings.Contains(err.Error(), "Platform app identity projection must be an absolute non-root path") {
		t.Fatalf("relative protected identity binding err = %v", err)
	}
}

func TestProtectedServiceRejectsMissingDesktopSessionAuthority(t *testing.T) {
	authorities := newProtectedAuthoritiesForServerTest(t)
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
					ServiceStateRoot:                 t.TempDir(),
					ProductControlRoot:               filepath.Join(t.TempDir(), ".nimi"),
					RuntimeServiceSID:                protectedlocal.WindowsProductionServiceSID,
					LocalDevelopmentConsentStorePath: filepath.Join(t.TempDir(), "local-development.db"),
					AccountCustody:                   emptyProtectedAccountCustody{},
					AccountPartition:                 "verified-user-and-logon-session",
					LocalOSUserIdentity:              verifiedServerTestIdentity(t),
					ConnectorSecrets:                 emptyProtectedConnectorSecrets{},
					DesktopSessions:                  manager,
					LocalAppLaunches:                 authorities.localApps,
					LocalDevelopmentVerifier:         serverTestLocalDevelopmentVerifier{},
					RuntimeRestartRequester:          func() bool { return true },
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

type protectedAuthoritiesForServerTest struct {
	desktop   *protectedlocal.DesktopSessionManager
	localApps *protectedlocal.LocalAppLaunchRegistry
}

func verifiedServerTestIdentity(t *testing.T) localappkernel.VerifiedLocalOSUserIdentity {
	t.Helper()
	identity, err := localappkernel.ValidateVerifiedWindowsInteractiveUserSID("S-1-5-21-100-200-300-1001")
	if err != nil {
		t.Fatalf("validate server test OS-user identity: %v", err)
	}
	return identity
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
	desktop, err := protectedlocal.NewDesktopSessionManager(bootEpoch, rand.Reader)
	if err != nil {
		t.Fatalf("create protected test Desktop session manager: %v", err)
	}
	localApps, err := protectedlocal.NewLocalAppLaunchRegistry(bootEpoch)
	if err != nil {
		t.Fatalf("create protected test local-app launch registry: %v", err)
	}
	return protectedAuthoritiesForServerTest{desktop: desktop, localApps: localApps}
}

type serverTestLocalDevelopmentVerifier struct{}

func (serverTestLocalDevelopmentVerifier) VerifyLocalDevelopmentProcess(context.Context, uint32, protectedlocal.LocalDevelopmentProcessPolicy) (protectedlocal.ProcessTuple, protectedlocal.DesktopProcessLiveness, error) {
	return protectedlocal.ProcessTuple{}, nil, context.Canceled
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

func TestLoadNimiAppIdentityProjection(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "nimi-app-identity-surfaces.yaml")
	body := `version: 1
table_family: product_catalog
owner: platform
catalog_id: platform_nimi_app_identity_surfaces
apps:
  - canonical_app_id: nimi.avatar
    runtime_app_id: nimi.avatar
    runtime_caller_mode: local-first-party
  - canonical_app_id: nimi.web
    runtime_app_id: nimi.web
    runtime_caller_mode: web-cloud-adapter
`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write identity projection: %v", err)
	}

	projection, err := loadNimiAppIdentityProjection(path)
	if err != nil {
		t.Fatalf("load identity projection: %v", err)
	}
	if projection == nil {
		t.Fatal("expected identity projection")
	}
	if !projection.IsLocalFirstParty("nimi.avatar") {
		t.Fatal("expected Avatar local-first-party identity")
	}
	if projection.IsLocalFirstParty("nimi.web") {
		t.Fatal("web-cloud-adapter identity must not enter local first-party admission")
	}
}

func TestLoadNimiAppIdentityProjectionEmptyPath(t *testing.T) {
	projection, err := loadNimiAppIdentityProjection("")
	if err != nil {
		t.Fatalf("empty path should not error: %v", err)
	}
	if projection != nil {
		t.Fatal("empty path should not load identity projection")
	}
}
