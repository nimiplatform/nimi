package grpcserver

import (
	"context"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	"github.com/nimiplatform/nimi/runtime/internal/health"
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
	server, err := New(cfg, health.NewState(), slog.New(slog.NewTextHandler(io.Discard, nil)), "test")
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
	if status.GetProductionInert() {
		t.Fatal("account service must be production-active in wave-3")
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
	if !appSvc.HasInternalConsumer("runtime.agent.internal.chat_track_sidecar") {
		t.Fatal("expected runtime.agent.internal.chat_track_sidecar app consumer to be configured")
	}
	if !appSvc.HasInternalConsumer("runtime.agent") {
		t.Fatal("expected runtime.agent app consumer to be configured")
	}
}

func TestLoadNimiAppRegistryCatalog(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nimi-app-registry.yaml")
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
    admission_status: admitted
    source_rule: P-NAPP-011
`
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write registry: %v", err)
	}

	registry, err := loadNimiAppRegistryCatalog(path)
	if err != nil {
		t.Fatalf("load registry: %v", err)
	}
	if registry == nil {
		t.Fatal("expected registry")
	}
	eligibility, err := registry.CheckCallerEligibility("nimi.parentos")
	if err != nil {
		t.Fatalf("check eligibility: %v", err)
	}
	if !eligibility.Eligible {
		t.Fatalf("expected admitted parentos eligibility, reason=%s", eligibility.Reason)
	}
}

func TestLoadNimiAppRegistryCatalogEmptyPath(t *testing.T) {
	registry, err := loadNimiAppRegistryCatalog("")
	if err != nil {
		t.Fatalf("empty path should not error: %v", err)
	}
	if registry != nil {
		t.Fatalf("empty path should not load registry")
	}
}

func TestDefaultFirstPartyMigrationLaunchGate(t *testing.T) {
	gate := defaultFirstPartyMigrationLaunchGate()
	parentOS := gate.Evaluate("nimi.parentos")
	if !parentOS.Admitted {
		t.Fatalf("ParentOS should default to migration-not-required until standalone state is inventoried: %+v", parentOS)
	}
	avatar := gate.Evaluate("nimi.avatar")
	if avatar.Admitted {
		t.Fatalf("Avatar must remain blocked until master gate ack: %+v", avatar)
	}
}
