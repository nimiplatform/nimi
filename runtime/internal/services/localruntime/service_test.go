package localruntime

import (
	"context"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath)
}

func TestLocalRuntimeModelLifecycle(t *testing.T) {
	svc := newTestService(t)

	installed, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/test-chat",
		Capabilities: []string{"chat", "chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install local model: %v", err)
	}
	model := installed.GetModel()
	if model.GetLocalModelId() == "" {
		t.Fatalf("local model id must not be empty")
	}
	if model.GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("install status mismatch: got=%s", model.GetStatus())
	}
	if len(model.GetCapabilities()) != 1 || model.GetCapabilities()[0] != "chat" {
		t.Fatalf("capabilities must be normalized: %#v", model.GetCapabilities())
	}

	started, err := svc.StartLocalModel(context.Background(), &runtimev1.StartLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("start local model: %v", err)
	}
	if started.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("start status mismatch: got=%s", started.GetModel().GetStatus())
	}

	healthResp, err := svc.CheckLocalModelHealth(context.Background(), &runtimev1.CheckLocalModelHealthRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("check local model health: %v", err)
	}
	if len(healthResp.GetModels()) != 1 {
		t.Fatalf("health rows mismatch: got=%d want=1", len(healthResp.GetModels()))
	}
	if healthResp.GetModels()[0].GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_ACTIVE {
		t.Fatalf("health status mismatch: got=%s", healthResp.GetModels()[0].GetStatus())
	}
	if healthResp.GetModels()[0].GetDetail() != "model active" {
		t.Fatalf("health detail mismatch: got=%q", healthResp.GetModels()[0].GetDetail())
	}

	stopped, err := svc.StopLocalModel(context.Background(), &runtimev1.StopLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("stop local model: %v", err)
	}
	if stopped.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_INSTALLED {
		t.Fatalf("stop status mismatch: got=%s", stopped.GetModel().GetStatus())
	}

	removed, err := svc.RemoveLocalModel(context.Background(), &runtimev1.RemoveLocalModelRequest{
		LocalModelId: model.GetLocalModelId(),
	})
	if err != nil {
		t.Fatalf("remove local model: %v", err)
	}
	if removed.GetModel().GetStatus() != runtimev1.LocalModelStatus_LOCAL_MODEL_STATUS_REMOVED {
		t.Fatalf("remove status mismatch: got=%s", removed.GetModel().GetStatus())
	}
}

func TestLocalRuntimeResolveAndApplyDependencies(t *testing.T) {
	svc := newTestService(t)

	planResp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.user-math-quiz",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.chat.model",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL,
					Capability:   "chat",
					ModelId:      "local/chat-default",
					Engine:       "localai",
				},
				{
					DependencyId: "dep.chat.service",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE,
					Capability:   "chat",
					ServiceId:    "svc-chat",
					Engine:       "localai",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := planResp.GetPlan()
	if plan.GetPlanId() == "" {
		t.Fatalf("plan id must not be empty")
	}
	if len(plan.GetDependencies()) != 2 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=2", len(plan.GetDependencies()))
	}

	applyResp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: plan,
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := applyResp.GetResult()
	if result.GetPlanId() != plan.GetPlanId() {
		t.Fatalf("applied plan mismatch: got=%q want=%q", result.GetPlanId(), plan.GetPlanId())
	}
	if len(result.GetInstalledModels()) != 1 {
		t.Fatalf("installed model count mismatch: got=%d want=1", len(result.GetInstalledModels()))
	}
	if len(result.GetServices()) != 1 {
		t.Fatalf("installed service count mismatch: got=%d want=1", len(result.GetServices()))
	}
	if len(result.GetCapabilities()) != 1 || result.GetCapabilities()[0] != "chat" {
		t.Fatalf("applied capabilities mismatch: %#v", result.GetCapabilities())
	}
}

func TestLocalRuntimeAuditFilterByModID(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.AppendInferenceAudit(context.Background(), &runtimev1.AppendInferenceAuditRequest{
		EventType: "inference_invoked",
		ModId:     "world.nimi.user-math-quiz",
		Source:    "local-runtime",
		Provider:  "localai",
		Modality:  "chat",
		Adapter:   "openai_compat_adapter",
		Model:     "local/chat-default",
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	if _, err := svc.AppendRuntimeAudit(context.Background(), &runtimev1.AppendRuntimeAuditRequest{
		EventType: "runtime_model_ready_after_install",
		ModelId:   "local/chat-default",
	}); err != nil {
		t.Fatalf("append runtime audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		ModId: "world.nimi.user-math-quiz",
		Limit: 10,
	})
	if err != nil {
		t.Fatalf("list local audits by mod id: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("filtered events mismatch: got=%d want=1", len(filtered.GetEvents()))
	}
	if filtered.GetEvents()[0].GetEventType() != "inference_invoked" {
		t.Fatalf("unexpected filtered event type: %s", filtered.GetEvents()[0].GetEventType())
	}
}

func TestLocalRuntimeNodeCatalogFiltersByCapabilityAndProvider(t *testing.T) {
	svc := newTestService(t)

	installed, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-vision",
		Title:        "Vision Service",
		Engine:       "localai",
		Capabilities: []string{"image", "chat"},
	})
	if err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if installed.GetService().GetServiceId() != "svc-vision" {
		t.Fatalf("service id mismatch: %s", installed.GetService().GetServiceId())
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "image",
		Provider:   "localai",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 1 {
		t.Fatalf("node count mismatch: got=%d want=1", len(nodesResp.GetNodes()))
	}
	node := nodesResp.GetNodes()[0]
	if node.GetServiceId() != "svc-vision" {
		t.Fatalf("node service id mismatch: %s", node.GetServiceId())
	}
	if !node.GetAvailable() {
		t.Fatalf("node must be available before removal")
	}

	if _, err := svc.RemoveLocalService(context.Background(), &runtimev1.RemoveLocalServiceRequest{
		ServiceId: "svc-vision",
	}); err != nil {
		t.Fatalf("remove local service: %v", err)
	}

	nodesAfterRemove, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-vision",
	})
	if err != nil {
		t.Fatalf("list node catalog after remove: %v", err)
	}
	if len(nodesAfterRemove.GetNodes()) == 0 {
		t.Fatalf("expected removed service node to remain discoverable with unavailable flag")
	}
	if nodesAfterRemove.GetNodes()[0].GetAvailable() {
		t.Fatalf("node must be unavailable after service removal")
	}
}

func TestLocalRuntimeCollectDeviceProfileUsesRealProbe(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.CollectDeviceProfile(context.Background(), &runtimev1.CollectDeviceProfileRequest{})
	if err != nil {
		t.Fatalf("collect device profile: %v", err)
	}
	profile := resp.GetProfile()
	if profile.GetOs() == "" || profile.GetArch() == "" {
		t.Fatalf("device profile must include os/arch: %#v", profile)
	}
	if len(profile.GetPorts()) == 0 {
		t.Fatalf("device profile must include port probe results")
	}
}

func TestLocalRuntimeResolveDependenciesFailsOnInvalidRequired(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.invalid-required",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.invalid.service",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_SERVICE,
					Capability:   "chat",
					Engine:       "localai",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetDependencies()) != 1 || plan.GetDependencies()[0].GetSelected() {
		t.Fatalf("required dependency should be rejected: %#v", plan.GetDependencies())
	}
}

func TestLocalRuntimeResolveDependenciesRejectsWorkflowKind(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ResolveDependencies(context.Background(), &runtimev1.ResolveDependenciesRequest{
		ModId:      "world.nimi.invalid-workflow-kind",
		Capability: "chat",
		Dependencies: &runtimev1.LocalDependenciesDeclarationDescriptor{
			Required: []*runtimev1.LocalDependencyOptionDescriptor{
				{
					DependencyId: "dep.invalid.workflow",
					Kind:         runtimev1.LocalDependencyKind(4),
					Capability:   "chat",
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve dependencies: %v", err)
	}
	plan := resp.GetPlan()
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected plan reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetDependencies()) != 1 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=1", len(plan.GetDependencies()))
	}
	dependency := plan.GetDependencies()[0]
	if dependency.GetSelected() {
		t.Fatalf("unsupported workflow kind must not be selected")
	}
	if dependency.GetReasonCode() != "LOCAL_DEPENDENCY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected dependency reason code: %s", dependency.GetReasonCode())
	}
}

func TestLocalRuntimeApplyDependenciesShortCircuitsOnPreflight(t *testing.T) {
	svc := newTestService(t)
	result, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-preflight",
			ModId:  "world.nimi.preflight-fail",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.python-required",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_MODEL,
					Selected:     true,
					Required:     true,
					ModelId:      "local/python-model",
					Capability:   "chat",
					Engine:       "python-runtime",
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: false,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	if result.GetResult().GetReasonCode() != "LOCAL_DEPENDENCY_PYTHON_REQUIRED" {
		t.Fatalf("unexpected reason code: %s", result.GetResult().GetReasonCode())
	}
	if len(result.GetResult().GetInstalledModels()) != 0 || len(result.GetResult().GetServices()) != 0 {
		t.Fatalf("preflight failure should block install stage")
	}
}

func TestLocalRuntimeApplyDependenciesFailsWhenNodeUnresolved(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-node-missing",
			ModId:  "world.nimi.node-missing",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.node.chat",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE,
					Selected:     true,
					Required:     true,
					Capability:   "chat",
					NodeId:       "node_missing_chat",
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetStageResults()) == 0 || result.GetStageResults()[0].GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("preflight stage must expose node unresolved reason code")
	}
}

func TestLocalRuntimeApplyDependenciesPassesWhenNodeResolved(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-node-chat",
		Title:        "Node Chat Service",
		Engine:       "localai",
		Capabilities: []string{"chat"},
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-node-chat",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) == 0 {
		t.Fatalf("expected node catalog entry for installed service")
	}
	nodeID := nodesResp.GetNodes()[0].GetNodeId()

	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-node-ready",
			ModId:  "world.nimi.node-ready",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.node.chat",
					Kind:         runtimev1.LocalDependencyKind_LOCAL_DEPENDENCY_KIND_NODE,
					Selected:     true,
					Required:     true,
					Capability:   "chat",
					ServiceId:    "svc-node-chat",
					NodeId:       nodeID,
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetInstalledModels()) != 0 || len(result.GetServices()) != 0 {
		t.Fatalf("node-only apply must not install model/service artifacts")
	}
}

func TestLocalRuntimeApplyDependenciesRejectsUnsupportedKindInPreflight(t *testing.T) {
	svc := newTestService(t)
	resp, err := svc.ApplyDependencies(context.Background(), &runtimev1.ApplyDependenciesRequest{
		Plan: &runtimev1.LocalDependencyResolutionPlan{
			PlanId: "dep-plan-unsupported-kind",
			ModId:  "world.nimi.unsupported-kind",
			Dependencies: []*runtimev1.LocalDependencyDescriptor{
				{
					DependencyId: "dep.unsupported.kind",
					Kind:         runtimev1.LocalDependencyKind(99),
					Selected:     true,
					Required:     true,
				},
			},
			DeviceProfile: &runtimev1.LocalDeviceProfile{
				Os:   "darwin",
				Arch: "arm64",
				Python: &runtimev1.LocalPythonProfile{
					Available: true,
				},
			},
		},
	})
	if err != nil {
		t.Fatalf("apply dependencies: %v", err)
	}
	result := resp.GetResult()
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if result.GetRollbackApplied() {
		t.Fatalf("preflight rejection must not apply rollback")
	}
}

func TestLocalRuntimeStateRestoresAfterRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	svc := New(logger, nil, statePath)
	installedModel, err := svc.InstallLocalModel(context.Background(), &runtimev1.InstallLocalModelRequest{
		ModelId:      "local/persisted-model",
		Capabilities: []string{"chat"},
		Engine:       "localai",
	})
	if err != nil {
		t.Fatalf("install model: %v", err)
	}
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-persisted",
		Title:        "svc-persisted",
		Capabilities: []string{"chat"},
		LocalModelId: installedModel.GetModel().GetLocalModelId(),
	}); err != nil {
		t.Fatalf("install service: %v", err)
	}

	restarted := New(logger, nil, statePath)
	modelsResp, err := restarted.ListLocalModels(context.Background(), &runtimev1.ListLocalModelsRequest{})
	if err != nil {
		t.Fatalf("list models after restart: %v", err)
	}
	if len(modelsResp.GetModels()) == 0 {
		t.Fatalf("expected restored models from persisted state")
	}
	servicesResp, err := restarted.ListLocalServices(context.Background(), &runtimev1.ListLocalServicesRequest{})
	if err != nil {
		t.Fatalf("list services after restart: %v", err)
	}
	if len(servicesResp.GetServices()) == 0 {
		t.Fatalf("expected restored services from persisted state")
	}
}
