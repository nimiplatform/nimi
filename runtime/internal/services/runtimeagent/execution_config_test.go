package runtimeagent

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/config"
	memoryservice "github.com/nimiplatform/nimi/runtime/internal/services/memory"
	"github.com/nimiplatform/nimi/runtime/internal/texttarget"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func executionConfigTestContext(appID string) *runtimev1.AgentRequestContext {
	return &runtimev1.AgentRequestContext{AppId: appID}
}

func newExecutionConfigTestServiceWithClose(t *testing.T, localStatePath string) (*Service, func()) {
	t.Helper()
	memorySvc, err := memoryservice.New(nil, config.Config{
		LocalStatePath:       localStatePath,
		AIHTTPTimeoutSeconds: 2,
	})
	if err != nil {
		t.Fatalf("memory.New: %v", err)
	}
	var svc *Service
	closeFn := func() {
		if svc != nil {
			svc.Close()
		}
		_ = memorySvc.Close()
	}
	svc, err = New(nil, localStatePath, memorySvc)
	if err != nil {
		closeFn()
		t.Fatalf("runtimeagent.New: %v", err)
	}
	return svc, closeFn
}

func newExecutionConfigTestService(t *testing.T) *Service {
	t.Helper()
	svc, closeFn := newExecutionConfigTestServiceWithClose(t, filepath.Join(t.TempDir(), "local-state.json"))
	t.Cleanup(closeFn)
	return svc
}

func requireExecutionConfigBinding(t *testing.T, config *runtimev1.RuntimeAgentExecutionConfig, capability string) *runtimev1.RuntimeAgentExecutionCapabilityBinding {
	t.Helper()
	for _, binding := range config.GetBindings() {
		if binding.GetCapability() == capability {
			return binding
		}
	}
	t.Fatalf("expected %q binding in config %+v", capability, config)
	return nil
}

func TestExecutionConfigSeedOnStartAndGet(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	resp, err := svc.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionConfig: %v", err)
	}
	config := resp.GetConfig()
	if config.GetRevision() != 1 {
		t.Fatalf("expected seeded revision 1, got %d", config.GetRevision())
	}
	if config.GetUpdatedByAppId() != executionConfigSeedAppID {
		t.Fatalf("expected seed updated_by_app_id %q, got %q", executionConfigSeedAppID, config.GetUpdatedByAppId())
	}
	if config.GetUpdatedAt() == nil {
		t.Fatal("expected seed updated_at timestamp")
	}
	if len(config.GetBindings()) != 1 {
		t.Fatalf("expected exactly one seeded binding, got %d", len(config.GetBindings()))
	}
	text := requireExecutionConfigBinding(t, config, executionCapabilityTextGenerate)
	if text.GetModelId() != texttarget.InternalDefaultLocalTextModelAlias {
		t.Fatalf("expected seeded model %q, got %q", texttarget.InternalDefaultLocalTextModelAlias, text.GetModelId())
	}
	if text.GetRoutePolicy() != runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL {
		t.Fatalf("expected seeded route policy local, got %v", text.GetRoutePolicy())
	}
}

func TestExecutionConfigUpsertBumpsRevision(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	resp, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	})
	if err != nil {
		t.Fatalf("UpsertAgentExecutionConfig: %v", err)
	}
	config := resp.GetConfig()
	if config.GetRevision() != 2 {
		t.Fatalf("expected revision 2 after mutation, got %d", config.GetRevision())
	}
	if config.GetUpdatedByAppId() != "nimi.desktop" {
		t.Fatalf("expected updated_by_app_id nimi.desktop, got %q", config.GetUpdatedByAppId())
	}
	text := requireExecutionConfigBinding(t, config, executionCapabilityTextGenerate)
	if text.GetModelId() != "local/qwen3-chat" {
		t.Fatalf("expected committed model local/qwen3-chat, got %q", text.GetModelId())
	}

	// The next read must reflect the committed mutation.
	getResp, err := svc.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionConfig after upsert: %v", err)
	}
	if getResp.GetConfig().GetRevision() != 2 {
		t.Fatalf("expected committed revision 2 on read, got %d", getResp.GetConfig().GetRevision())
	}
}

func TestExecutionConfigUpsertStaleRevisionAborted(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 7,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	})
	if status.Code(err) != codes.Aborted {
		t.Fatalf("expected Aborted for stale expected_revision, got %v", err)
	}

	// The committed config must be untouched by the rejected mutation.
	resp, err := svc.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionConfig: %v", err)
	}
	if resp.GetConfig().GetRevision() != 1 {
		t.Fatalf("expected committed revision still 1, got %d", resp.GetConfig().GetRevision())
	}
}

func TestExecutionConfigUpsertRejectsUnknownCapability(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  "audio.generate",
				ModelId:     "local/qwen3-tts",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for unknown capability, got %v", err)
	}
}

func TestExecutionConfigUpsertRejectsRemovingTextGenerate(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument when text.generate is removed, got %v", err)
	}
}

func TestExecutionConfigUpsertRejectsStructurallyInvalidBindings(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	cases := []struct {
		name     string
		bindings []*runtimev1.RuntimeAgentExecutionCapabilityBinding
	}{
		{
			name:     "empty binding set",
			bindings: nil,
		},
		{
			name: "missing model_id",
			bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{Capability: executionCapabilityTextGenerate, RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
			},
		},
		{
			name: "unspecified route_policy",
			bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{Capability: executionCapabilityTextGenerate, ModelId: "local/default"},
			},
		},
		{
			name: "duplicate capability",
			bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{Capability: executionCapabilityTextGenerate, ModelId: "local/default", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
				{Capability: executionCapabilityTextGenerate, ModelId: "local/other", RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL},
			},
		},
		{
			name: "empty target_ref oneof",
			bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{
					Capability:  executionCapabilityTextGenerate,
					ModelId:     "local/default",
					RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef:   &runtimev1.RuntimeDurableTargetRef{},
				},
			},
		},
		{
			name: "cloud target_ref with local route_policy",
			bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
				{
					Capability:  executionCapabilityTextGenerate,
					ModelId:     "local/default",
					RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
					TargetRef: &runtimev1.RuntimeDurableTargetRef{
						Target: &runtimev1.RuntimeDurableTargetRef_Cloud{
							Cloud: &runtimev1.RuntimeDurableCloudTargetRef{Provider: "openai", ConnectorId: "cloud-openai"},
						},
					},
				},
			},
		},
	}
	for _, tc := range cases {
		_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
			Context:          executionConfigTestContext("nimi.desktop"),
			ExpectedRevision: 1,
			Bindings:         tc.bindings,
		})
		if status.Code(err) != codes.InvalidArgument {
			t.Fatalf("%s: expected InvalidArgument, got %v", tc.name, err)
		}
	}
}

func TestExecutionConfigUpsertRequiresAppID(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("  "),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/default",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
		},
	})
	if status.Code(err) != codes.InvalidArgument {
		t.Fatalf("expected InvalidArgument for missing app_id, got %v", err)
	}
}

func TestExecutionConfigSurvivesRestartWithoutReseed(t *testing.T) {
	t.Parallel()
	localStatePath := filepath.Join(t.TempDir(), "local-state.json")

	svc, closeFirst := newExecutionConfigTestServiceWithClose(t, localStatePath)
	_, err := svc.UpsertAgentExecutionConfig(context.Background(), &runtimev1.UpsertAgentExecutionConfigRequest{
		Context:          executionConfigTestContext("nimi.desktop"),
		ExpectedRevision: 1,
		Bindings: []*runtimev1.RuntimeAgentExecutionCapabilityBinding{
			{
				Capability:  executionCapabilityTextGenerate,
				ModelId:     "local/qwen3-chat",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL,
			},
			{
				Capability:  executionCapabilityImageGenerate,
				ModelId:     "openai/gpt-image-1",
				RoutePolicy: runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD,
				ConnectorId: "cloud-openai",
			},
		},
	})
	if err != nil {
		closeFirst()
		t.Fatalf("UpsertAgentExecutionConfig: %v", err)
	}
	closeFirst()

	restarted, closeRestarted := newExecutionConfigTestServiceWithClose(t, localStatePath)
	defer closeRestarted()

	resp, err := restarted.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionConfig after restart: %v", err)
	}
	config := resp.GetConfig()
	if config.GetRevision() != 2 {
		t.Fatalf("expected committed revision 2 to survive restart (no re-seed), got %d", config.GetRevision())
	}
	if config.GetUpdatedByAppId() != "nimi.desktop" {
		t.Fatalf("expected committed updated_by_app_id to survive restart, got %q", config.GetUpdatedByAppId())
	}
	text := requireExecutionConfigBinding(t, config, executionCapabilityTextGenerate)
	if text.GetModelId() != "local/qwen3-chat" {
		t.Fatalf("expected committed text model to survive restart, got %q", text.GetModelId())
	}
	image := requireExecutionConfigBinding(t, config, executionCapabilityImageGenerate)
	if image.GetConnectorId() != "cloud-openai" {
		t.Fatalf("expected committed image connector to survive restart, got %q", image.GetConnectorId())
	}
}

func TestExecutionConfigSeedNeverOverwritesCommittedRow(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	// A second explicit init over the same live service must observe the
	// committed row and refuse to re-seed.
	if err := svc.initExecutionConfig(); err != nil {
		t.Fatalf("initExecutionConfig(second): %v", err)
	}
	resp, err := svc.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if err != nil {
		t.Fatalf("GetAgentExecutionConfig: %v", err)
	}
	if resp.GetConfig().GetRevision() != 1 {
		t.Fatalf("expected revision 1 after redundant init, got %d", resp.GetConfig().GetRevision())
	}
}

func TestExecutionConfigMissingRowAfterSeedFailsClosed(t *testing.T) {
	t.Parallel()
	svc := newExecutionConfigTestService(t)

	// Simulate committed-state corruption: the row disappears after seeding.
	if _, err := svc.backend.DB().Exec(`DELETE FROM runtime_agent_execution_config`); err != nil {
		t.Fatalf("delete execution config row: %v", err)
	}
	_, err := svc.GetAgentExecutionConfig(context.Background(), &runtimev1.GetAgentExecutionConfigRequest{
		Context: executionConfigTestContext("nimi.desktop"),
	})
	if status.Code(err) != codes.Internal {
		t.Fatalf("expected Internal for missing committed row after seed, got %v", err)
	}
}
