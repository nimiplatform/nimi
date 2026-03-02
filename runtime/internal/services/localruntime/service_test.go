package localruntime

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	statePath := filepath.Join(t.TempDir(), "local-runtime-state.json")
	return New(slog.New(slog.NewTextHandler(io.Discard, nil)), nil, statePath, 0)
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
	if node.GetAdapter() != "localai_native_adapter" {
		t.Fatalf("localai image adapter mismatch: %s", node.GetAdapter())
	}
	if !node.GetAvailable() {
		t.Fatalf("node must be available before removal")
	}
	if node.GetProviderHints() == nil || node.GetProviderHints().GetLocalai() == nil {
		t.Fatalf("localai image node must include provider hints")
	}
	if node.GetProviderHints().GetLocalai().GetPreferredAdapter() != "localai_native_adapter" {
		t.Fatalf("localai image preferred adapter mismatch: %s", node.GetProviderHints().GetLocalai().GetPreferredAdapter())
	}
	if node.GetProviderHints().GetLocalai().GetStablediffusionPipeline() == "" {
		t.Fatalf("localai image provider hints should include stablediffusion pipeline")
	}
	if node.GetProviderHints().GetExtra()["service_id"] != "svc-vision" {
		t.Fatalf("provider hints extra.service_id mismatch: %s", node.GetProviderHints().GetExtra()["service_id"])
	}

	chatNodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "chat",
		Provider:   "localai",
	})
	if err != nil {
		t.Fatalf("list chat node catalog: %v", err)
	}
	if len(chatNodesResp.GetNodes()) != 1 {
		t.Fatalf("chat node count mismatch: got=%d want=1", len(chatNodesResp.GetNodes()))
	}
	chatNode := chatNodesResp.GetNodes()[0]
	if chatNode.GetAdapter() != "openai_compat_adapter" {
		t.Fatalf("localai chat adapter mismatch: %s", chatNode.GetAdapter())
	}
	if chatNode.GetProviderHints() == nil || chatNode.GetProviderHints().GetLocalai() == nil {
		t.Fatalf("localai chat node must include provider hints")
	}
	if chatNode.GetProviderHints().GetLocalai().GetPreferredAdapter() != "openai_compat_adapter" {
		t.Fatalf("localai chat preferred adapter mismatch: %s", chatNode.GetProviderHints().GetLocalai().GetPreferredAdapter())
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

func TestLocalRuntimeNodeCatalogNexaVideoFailClose(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-nexa",
		Title:        "Nexa Service",
		Engine:       "nexa",
		Capabilities: []string{"video", "chat"},
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Provider: "nexa",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 2 {
		t.Fatalf("node count mismatch: got=%d want=2", len(nodesResp.GetNodes()))
	}

	var videoNode *runtimev1.LocalNodeDescriptor
	var chatNode *runtimev1.LocalNodeDescriptor
	for _, item := range nodesResp.GetNodes() {
		if len(item.GetCapabilities()) == 0 {
			continue
		}
		switch item.GetCapabilities()[0] {
		case "video":
			videoNode = item
		case "chat":
			chatNode = item
		}
	}
	if videoNode == nil || chatNode == nil {
		t.Fatalf("expected both video/chat nodes in catalog")
	}
	if videoNode.GetAdapter() != "nexa_native_adapter" {
		t.Fatalf("video adapter mismatch: %s", videoNode.GetAdapter())
	}
	if videoNode.GetAvailable() {
		t.Fatalf("nexa video node must be fail-close unavailable")
	}
	if videoNode.GetReasonCode() != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String() {
		t.Fatalf("nexa video reason code mismatch: %s", videoNode.GetReasonCode())
	}
	if videoNode.GetPolicyGate() == "" {
		t.Fatalf("nexa video policy gate should be set")
	}
	if videoNode.GetProviderHints() == nil || videoNode.GetProviderHints().GetNexa() == nil {
		t.Fatalf("nexa video node should include provider hints")
	}
	videoHints := videoNode.GetProviderHints().GetNexa()
	if videoHints.GetPreferredAdapter() != "nexa_native_adapter" {
		t.Fatalf("nexa video preferred adapter mismatch: %s", videoHints.GetPreferredAdapter())
	}
	if videoHints.GetPolicyGate() != videoNode.GetPolicyGate() {
		t.Fatalf("nexa video policy gate mismatch: node=%s hints=%s", videoNode.GetPolicyGate(), videoHints.GetPolicyGate())
	}
	if videoHints.GetNpuMode() == "" {
		t.Fatalf("nexa video npu mode must not be empty")
	}
	if videoHints.GetPolicyGate() != "" && videoHints.GetPolicyGateAllowsNpu() {
		t.Fatalf("nexa video policy gate should disable policyGateAllowsNpu")
	}
	if videoHints.GetPolicyGate() != "" && videoHints.GetNpuUsable() {
		t.Fatalf("nexa video policy gate should disable npuUsable")
	}
	if !chatNode.GetAvailable() {
		t.Fatalf("nexa chat node should remain available")
	}
	if chatNode.GetProviderHints() == nil || chatNode.GetProviderHints().GetNexa() == nil {
		t.Fatalf("nexa chat node should include provider hints")
	}
	chatHints := chatNode.GetProviderHints().GetNexa()
	if chatHints.GetPreferredAdapter() != "nexa_native_adapter" {
		t.Fatalf("nexa chat preferred adapter mismatch: %s", chatHints.GetPreferredAdapter())
	}
	if !chatHints.GetHostNpuReady() && chatHints.GetNpuUsable() {
		t.Fatalf("nexa chat npuUsable cannot be true when host_npu_ready=false")
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

	svc := New(logger, nil, statePath, 0)
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

	restarted := New(logger, nil, statePath, 0)
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

// --- Engine RPC tests ---

func TestEngineRPCsReturnFailedPreconditionWithoutManager(t *testing.T) {
	svc := newTestService(t)
	ctx := context.Background()

	// ListEngines
	_, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	assertGRPCCode(t, err, "ListEngines", codes.FailedPrecondition)

	// EnsureEngine
	_, err = svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "EnsureEngine", codes.FailedPrecondition)

	// StartEngine
	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StartEngine", codes.FailedPrecondition)

	// StopEngine
	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "StopEngine", codes.FailedPrecondition)

	// GetEngineStatus
	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "localai"})
	assertGRPCCode(t, err, "GetEngineStatus", codes.FailedPrecondition)
}

func TestEngineRPCsWithMockManager(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// ListEngines should return the mock engines.
	resp, err := svc.ListEngines(ctx, &runtimev1.ListEnginesRequest{})
	if err != nil {
		t.Fatalf("ListEngines: %v", err)
	}
	if len(resp.GetEngines()) != 1 {
		t.Fatalf("expected 1 engine, got %d", len(resp.GetEngines()))
	}
	if resp.GetEngines()[0].GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", resp.GetEngines()[0].GetEngine())
	}

	// GetEngineStatus should return the mock engine status.
	statusResp, err := svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("GetEngineStatus: %v", err)
	}
	if statusResp.GetEngine().GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY {
		t.Errorf("expected healthy status, got %s", statusResp.GetEngine().GetStatus())
	}
}

func TestEngineRPCsRequireEngineName(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	ctx := context.Background()

	// Empty engine name should return INVALID_ARGUMENT.
	_, err := svc.EnsureEngine(ctx, &runtimev1.EnsureEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "EnsureEngine(empty)", codes.InvalidArgument)

	_, err = svc.StartEngine(ctx, &runtimev1.StartEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StartEngine(empty)", codes.InvalidArgument)

	_, err = svc.StopEngine(ctx, &runtimev1.StopEngineRequest{Engine: ""})
	assertGRPCCode(t, err, "StopEngine(empty)", codes.InvalidArgument)

	_, err = svc.GetEngineStatus(ctx, &runtimev1.GetEngineStatusRequest{Engine: ""})
	assertGRPCCode(t, err, "GetEngineStatus(empty)", codes.InvalidArgument)
}

// mockEngineManager implements EngineManager for testing with configurable errors.
type mockEngineManager struct {
	ensureErr error
	startErr  error
	stopErr   error
	statusErr error
}

func (m *mockEngineManager) ListEngines() []EngineInfo {
	return []EngineInfo{
		{Engine: "localai", Version: "3.12.1", Status: "healthy", Port: 1234, Endpoint: "http://127.0.0.1:1234"},
	}
}

func (m *mockEngineManager) EnsureEngine(_ context.Context, _ string, _ string) error {
	return m.ensureErr
}

func (m *mockEngineManager) StartEngine(_ context.Context, _ string, _ int, _ string) error {
	return m.startErr
}

func (m *mockEngineManager) StopEngine(_ string) error {
	return m.stopErr
}

func (m *mockEngineManager) EngineStatus(engine string) (EngineInfo, error) {
	if m.statusErr != nil {
		return EngineInfo{}, m.statusErr
	}
	return EngineInfo{
		Engine:   engine,
		Version:  "3.12.1",
		Status:   "healthy",
		Port:     1234,
		Endpoint: "http://127.0.0.1:1234",
	}, nil
}

func assertGRPCCode(t *testing.T, err error, rpc string, wantCode codes.Code) {
	t.Helper()
	if err == nil {
		t.Fatalf("%s: expected error, got nil", rpc)
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("%s: expected gRPC status error, got %T: %v", rpc, err, err)
	}
	if st.Code() != wantCode {
		t.Errorf("%s: expected code %s, got %s (msg: %s)", rpc, wantCode, st.Code(), st.Message())
	}
}

// --- Engine RPC success/error tests ---

func TestEngineRPCEnsureEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("EnsureEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", desc.GetEngine())
	}
	if desc.GetVersion() != "3.12.1" {
		t.Errorf("expected version 3.12.1, got %s", desc.GetVersion())
	}
}

func TestEngineRPCStartEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartEngine(context.Background(), &runtimev1.StartEngineRequest{
		Engine: "localai",
		Port:   5000,
	})
	if err != nil {
		t.Fatalf("StartEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetEngine() != "localai" {
		t.Errorf("expected engine localai, got %s", desc.GetEngine())
	}
}

func TestEngineRPCStopEngineSuccess(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StopEngine(context.Background(), &runtimev1.StopEngineRequest{Engine: "localai"})
	if err != nil {
		t.Fatalf("StopEngine: %v", err)
	}
	desc := resp.GetEngine()
	if desc.GetStatus() != runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED {
		t.Errorf("expected STOPPED status, got %s", desc.GetStatus())
	}
}

func TestEngineRPCGetEngineStatusNotFound(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		statusErr: fmt.Errorf("engine missing not started"),
	})

	_, err := svc.GetEngineStatus(context.Background(), &runtimev1.GetEngineStatusRequest{Engine: "missing"})
	assertGRPCCode(t, err, "GetEngineStatus(not_found)", codes.NotFound)
}

func TestEngineRPCEnsureEngineError(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		ensureErr: fmt.Errorf("download failed"),
	})

	_, err := svc.EnsureEngine(context.Background(), &runtimev1.EnsureEngineRequest{Engine: "localai"})
	assertGRPCCode(t, err, "EnsureEngine(error)", codes.Internal)
}

// --- Enum mapping test ---

func TestEngineStatusToProtoMapping(t *testing.T) {
	tests := []struct {
		input string
		want  runtimev1.LocalEngineStatus
	}{
		{"stopped", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STOPPED},
		{"starting", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_STARTING},
		{"healthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_HEALTHY},
		{"unhealthy", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNHEALTHY},
		{"unknown", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
		{"", runtimev1.LocalEngineStatus_LOCAL_ENGINE_STATUS_UNSPECIFIED},
	}
	for _, tt := range tests {
		got := engineStatusToProto(tt.input)
		if got != tt.want {
			t.Errorf("engineStatusToProto(%q) = %s, want %s", tt.input, got, tt.want)
		}
	}
}
