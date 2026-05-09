package localservice

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/authn"
	"google.golang.org/grpc/metadata"
)

func TestLocalResolveAndApplyExecutionPlan(t *testing.T) {
	svc := newTestService(t)

	plan := resolveExecutionPlan(&executionResolveRequest{
		modID:      "world.nimi.user-math-quiz",
		capability: "chat",
		entries: &runtimev1.LocalExecutionDeclarationDescriptor{
			Required: []*runtimev1.LocalExecutionOptionDescriptor{
				{
					EntryId:    "dep.chat.model",
					Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_MODEL,
					Capability: "chat",
					ModelId:    "local/chat-default",
					Engine:     "llama",
				},
				{
					EntryId:    "dep.chat.service",
					Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_SERVICE,
					Capability: "chat",
					ModelId:    "local/chat-default",
					ServiceId:  "svc-chat",
					Engine:     "llama",
				},
			},
		},
	})
	if plan.GetPlanId() == "" {
		t.Fatalf("plan id must not be empty")
	}
	if len(plan.GetEntries()) != 2 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=2", len(plan.GetEntries()))
	}

	result := svc.applyExecutionPlanStrict(context.Background(), plan)
	if result.GetPlanId() != plan.GetPlanId() {
		t.Fatalf("applied plan mismatch: got=%q want=%q", result.GetPlanId(), plan.GetPlanId())
	}
	if len(result.GetInstalledAssets()) != 1 {
		t.Fatalf("installed model count mismatch: got=%d want=1", len(result.GetInstalledAssets()))
	}
	if len(result.GetServices()) != 1 {
		t.Fatalf("installed service count mismatch: got=%d want=1", len(result.GetServices()))
	}
	if len(result.GetCapabilities()) != 1 || result.GetCapabilities()[0] != "chat" {
		t.Fatalf("applied capabilities mismatch: %#v", result.GetCapabilities())
	}
	gotStages := make([]string, 0, len(result.GetStageResults()))
	for _, stage := range result.GetStageResults() {
		gotStages = append(gotStages, stage.GetStage())
		if !stage.GetOk() {
			t.Fatalf("unexpected failed stage in happy path: %s (%s)", stage.GetStage(), stage.GetReasonCode())
		}
	}
	wantStages := []string{applyStagePreflight, applyStageInstall, applyStageBootstrap, applyStageHealth}
	if strings.Join(gotStages, ",") != strings.Join(wantStages, ",") {
		t.Fatalf("unexpected stage order: got=%v want=%v", gotStages, wantStages)
	}
	if result.GetRollbackApplied() {
		t.Fatalf("happy path apply must not set rollback_applied")
	}
}

func TestLocalResolveProfileSeparatesDependencyAndArtifactEntries(t *testing.T) {
	svc := newTestService(t)
	required := true
	optional := false

	resp, err := svc.ResolveProfile(context.Background(), &runtimev1.ResolveProfileRequest{
		ModId: "world.nimi.user-image-studio",
		Profile: &runtimev1.LocalProfileDescriptor{
			Id:                  "quality-best",
			Title:               "Quality Best",
			Recommended:         true,
			ConsumeCapabilities: []string{"image"},
			Entries: []*runtimev1.LocalProfileEntryDescriptor{
				{
					EntryId:    "profile.image.model",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image",
					Required:   &required,
					AssetId:    "local/image-best",
					Engine:     "llama",
				},
				{
					EntryId:    "profile.image.vae",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image",
					Required:   &required,
					TemplateId: "verified.asset.z_image.vae",
					AssetId:    "local/z_image_ae",
					AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
					Engine:     "media",
				},
				{
					EntryId:    "profile.image.helper",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "chat",
					Required:   &optional,
					AssetId:    "local/helper-chat",
					Engine:     "llama",
				},
			},
		},
		Capability: "image",
	})
	if err != nil {
		t.Fatalf("resolve profile: %v", err)
	}

	plan := resp.GetPlan()
	if plan.GetPlanId() == "" {
		t.Fatalf("profile plan id must not be empty")
	}
	if plan.GetProfileId() != "quality-best" {
		t.Fatalf("profile id mismatch: got=%q", plan.GetProfileId())
	}
	if plan.GetExecutionPlan() == nil {
		t.Fatalf("execution plan must be present")
	}
	if plan.GetExecutionPlan().GetPlanId() != plan.GetPlanId() {
		t.Fatalf("execution plan should share profile plan id: got=%q want=%q", plan.GetExecutionPlan().GetPlanId(), plan.GetPlanId())
	}
	// The main image asset is resolved through the execution resolver, while the
	// passive slot asset is appended directly to the execution plan. The
	// chat-capability helper is filtered out, leaving 2 entries total.
	if len(plan.GetExecutionPlan().GetEntries()) != 2 {
		t.Fatalf("expected image model + passive VAE entries after capability filter, got=%d", len(plan.GetExecutionPlan().GetEntries()))
	}
}

func TestLocalApplyProfileInstallsPassiveAssets(t *testing.T) {
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{"local/image-best"},
		}
	})
	modelsRoot := filepath.Join(t.TempDir(), "models")
	svc.SetManagedLlamaRegistrationConfig(modelsRoot, "", false)
	svc.SetEngineManager(&mockEngineManager{})
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	required := true

	payload := []byte("verified-vae")
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/black-forest-labs/FLUX.1-schnell/resolve/main/ae.safetensors" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()

	svc.hfDownloadBaseURL = server.URL
	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		{
			TemplateId: "verified.asset.z_image.vae",
			Title:      "Z-Image AE",
			AssetId:    "local/z_image_ae",
			Kind:       runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
			Engine:     "media",
			Entry:      "ae.safetensors",
			Files:      []string{"ae.safetensors"},
			License:    "apache-2.0",
			Repo:       "black-forest-labs/FLUX.1-schnell",
			Revision:   "main",
			Hashes: map[string]string{
				"ae.safetensors": fmt.Sprintf("sha256:%x", sum),
			},
		},
	}

	resolveResp, err := svc.ResolveProfile(context.Background(), &runtimev1.ResolveProfileRequest{
		ModId: "world.nimi.user-image-studio",
		Profile: &runtimev1.LocalProfileDescriptor{
			Id:                  "quality-best",
			Title:               "Quality Best",
			Recommended:         true,
			ConsumeCapabilities: []string{"image"},
			Entries: []*runtimev1.LocalProfileEntryDescriptor{
				{
					EntryId:    "profile.image.model",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image",
					Required:   &required,
					AssetId:    "local/image-best",
					Engine:     "media",
				},
				{
					EntryId:    "profile.image.vae",
					Kind:       runtimev1.LocalProfileEntryKind_LOCAL_PROFILE_ENTRY_KIND_ASSET,
					Capability: "image",
					Required:   &required,
					TemplateId: "verified.asset.z_image.vae",
					AssetId:    "local/z_image_ae",
					AssetKind:  runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VAE,
					EngineSlot: "vae_path",
					Engine:     "media",
				},
			},
		},
		Capability: "image",
		DeviceProfile: &runtimev1.LocalDeviceProfile{
			Os:   "windows",
			Arch: "amd64",
			Gpu: &runtimev1.LocalGpuProfile{
				Available: true,
				Vendor:    "nvidia",
			},
			Python: &runtimev1.LocalPythonProfile{
				Available: true,
			},
		},
	})
	if err != nil {
		t.Fatalf("resolve profile: %v", err)
	}

	applyResp, err := svc.ApplyProfile(context.Background(), &runtimev1.ApplyProfileRequest{
		Plan: resolveResp.GetPlan(),
	})
	if err != nil {
		t.Fatalf("apply profile: %v", err)
	}
	result := applyResp.GetResult()
	if result.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("profile apply reason mismatch: got=%q", result.GetReasonCode())
	}
	if result.GetExecutionResult() == nil {
		t.Fatalf("execution result must be present")
	}
	// Execution result now contains both the runnable model and the passive VAE.
	if len(result.GetExecutionResult().GetInstalledAssets()) != 2 {
		t.Fatalf("expected runnable model + passive VAE in execution result, got=%d", len(result.GetExecutionResult().GetInstalledAssets()))
	}
	if len(result.GetInstalledAssets()) != 1 {
		t.Fatalf("expected one installed passive asset, got=%d", len(result.GetInstalledAssets()))
	}
	if result.GetInstalledAssets()[0].GetAssetId() != "local/z_image_ae" {
		t.Fatalf("asset id mismatch: got=%q", result.GetInstalledAssets()[0].GetAssetId())
	}
}

func TestLocalAuditFilterByModID(t *testing.T) {
	svc := newTestService(t)

	if _, err := svc.AppendInferenceAudit(context.Background(), &runtimev1.AppendInferenceAuditRequest{
		EventType: "inference_invoked",
		ModId:     "world.nimi.user-math-quiz",
		Source:    "local",
		Provider:  "llama",
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
		ModId:    "world.nimi.user-math-quiz",
		PageSize: 10,
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

func TestLocalAuditContextEnvelopeAndFilters(t *testing.T) {
	svc := newTestService(t)

	ctx := authn.WithIdentity(context.Background(), &authn.Identity{SubjectUserID: "subject-ctx"})
	ctx = metadata.NewIncomingContext(ctx, metadata.Pairs(
		"x-nimi-trace-id", "trace-local-audit-ctx",
		"x-nimi-app-id", "app.ctx",
		"x-nimi-domain", "runtime.local_runtime",
	))

	if _, err := svc.AppendInferenceAudit(ctx, &runtimev1.AppendInferenceAuditRequest{
		EventType: "ctx_audit",
		Source:    "local",
		Model:     "local/ctx-model",
	}); err != nil {
		t.Fatalf("append inference audit: %v", err)
	}

	filtered, err := svc.ListLocalAudits(context.Background(), &runtimev1.ListLocalAuditsRequest{
		EventType:     "ctx_audit",
		AppId:         "app.ctx",
		SubjectUserId: "subject-ctx",
		PageSize:      10,
	})
	if err != nil {
		t.Fatalf("list local audits with app/subject filter: %v", err)
	}
	if len(filtered.GetEvents()) != 1 {
		t.Fatalf("expected exactly one filtered event, got %d", len(filtered.GetEvents()))
	}
	event := filtered.GetEvents()[0]
	if event.GetTraceId() != "trace-local-audit-ctx" {
		t.Fatalf("unexpected trace_id: %s", event.GetTraceId())
	}
	if event.GetAppId() != "app.ctx" {
		t.Fatalf("unexpected app_id: %s", event.GetAppId())
	}
	if event.GetDomain() != "runtime.local_runtime" {
		t.Fatalf("unexpected domain: %s", event.GetDomain())
	}
	if event.GetOperation() != "append_inference_audit" {
		t.Fatalf("unexpected operation: %s", event.GetOperation())
	}
	if event.GetSubjectUserId() != "subject-ctx" {
		t.Fatalf("unexpected subject_user_id: %s", event.GetSubjectUserId())
	}
}

func TestLocalNodeCatalogFiltersByCapabilityAndProvider(t *testing.T) {
	svc := newTestService(t)

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/vision-chat-model",
		capabilities: []string{"image.understand", "chat"},
		engine:       "llama",
	})

	installed, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-vision",
		Title:        "Vision Service",
		Engine:       "llama",
		Capabilities: []string{"image.understand", "chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
		Endpoint:     managedDefaultEndpointForEngine("llama"),
	})
	if err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if installed.GetService().GetServiceId() != "svc-vision" {
		t.Fatalf("service id mismatch: %s", installed.GetService().GetServiceId())
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-vision",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "image.understand",
		Provider:   "llama",
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
	if !strings.HasPrefix(node.GetNodeId(), "svc-vision:") {
		t.Fatalf("node id should use <service_id>:<capability>, got: %s", node.GetNodeId())
	}
	if node.GetAdapter() != "llama_native_adapter" {
		t.Fatalf("llama image adapter mismatch: %s", node.GetAdapter())
	}
	if !node.GetAvailable() {
		t.Fatalf("node must be available before removal")
	}
	if node.GetProviderHints() == nil || node.GetProviderHints().GetLlama() == nil {
		t.Fatalf("llama image node must include provider hints")
	}
	if node.GetProviderHints().GetLlama().GetPreferredAdapter() != "llama_native_adapter" {
		t.Fatalf("llama image preferred adapter mismatch: %s", node.GetProviderHints().GetLlama().GetPreferredAdapter())
	}
	if node.GetProviderHints().GetLlama().GetBackend() != "llama" {
		t.Fatalf("llama image provider hints should carry backend=llama")
	}
	if node.GetProviderHints().GetExtra()["service_id"] != "svc-vision" {
		t.Fatalf("provider hints extra.service_id mismatch: %s", node.GetProviderHints().GetExtra()["service_id"])
	}

	chatNodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		Capability: "chat",
		Provider:   "llama",
	})
	if err != nil {
		t.Fatalf("list chat node catalog: %v", err)
	}
	if len(chatNodesResp.GetNodes()) != 1 {
		t.Fatalf("chat node count mismatch: got=%d want=1", len(chatNodesResp.GetNodes()))
	}
	chatNode := chatNodesResp.GetNodes()[0]
	if chatNode.GetAdapter() != "llama_native_adapter" {
		t.Fatalf("llama chat adapter mismatch: %s", chatNode.GetAdapter())
	}
	if chatNode.GetProviderHints() == nil || chatNode.GetProviderHints().GetLlama() == nil {
		t.Fatalf("llama chat node must include provider hints")
	}
	if chatNode.GetProviderHints().GetLlama().GetPreferredAdapter() != "llama_native_adapter" {
		t.Fatalf("llama chat preferred adapter mismatch: %s", chatNode.GetProviderHints().GetLlama().GetPreferredAdapter())
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
	if len(nodesAfterRemove.GetNodes()) != 0 {
		t.Fatalf("removed/inactive services must not appear in node catalog")
	}
}

func TestLocalNodeCatalogSortsByNodeIDWithinSameAdapter(t *testing.T) {
	svc := newTestService(t)

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/sort-catalog-model",
		capabilities: []string{"chat", "image.understand"},
		engine:       "llama",
	})
	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-sort",
		Title:        "Sort Service",
		Engine:       "llama",
		Capabilities: []string{"chat", "image.understand"},
		LocalModelId: modelResp.GetLocalAssetId(),
		Endpoint:     managedDefaultEndpointForEngine("llama"),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-sort",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	resp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-sort",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(resp.GetNodes()) != 2 {
		t.Fatalf("expected 2 nodes, got %d", len(resp.GetNodes()))
	}

	first := resp.GetNodes()[0]
	second := resp.GetNodes()[1]
	if first.GetAdapter() != "llama_native_adapter" || second.GetAdapter() != "llama_native_adapter" {
		t.Fatalf("node catalog should keep llama-native adapters together, got adapters: %s, %s", first.GetAdapter(), second.GetAdapter())
	}
	if len(first.GetCapabilities()) == 0 || first.GetCapabilities()[0] != "chat" {
		t.Fatalf("expected chat node first when adapter names match, got capabilities: %#v", first.GetCapabilities())
	}
	if len(second.GetCapabilities()) == 0 || second.GetCapabilities()[0] != "image.understand" {
		t.Fatalf("expected image node second when adapter names match, got capabilities: %#v", second.GetCapabilities())
	}
}

func TestLocalNodeCatalogCustomMissingProfileIsUnavailable(t *testing.T) {
	svc := newTestService(t)

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "custom-node-model",
		engine:       "llama",
		capabilities: []string{"custom"},
	})

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-custom",
		Title:        "Custom Service",
		Engine:       "llama",
		Capabilities: []string{"custom"},
		LocalModelId: modelResp.GetLocalAssetId(),
		Endpoint:     managedDefaultEndpointForEngine("llama"),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-custom",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-custom",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) != 1 {
		t.Fatalf("node count mismatch: got=%d want=1", len(nodesResp.GetNodes()))
	}
	node := nodesResp.GetNodes()[0]
	if node.GetAvailable() {
		t.Fatalf("custom node without local_invoke_profile_id must be unavailable")
	}
	if node.GetReasonCode() != runtimev1.ReasonCode_AI_LOCAL_MODEL_PROFILE_MISSING.String() {
		t.Fatalf("unexpected reason code: %s", node.GetReasonCode())
	}
	if node.GetPolicyGate() != "custom.invoke_profile.missing" {
		t.Fatalf("unexpected policy gate: %s", node.GetPolicyGate())
	}
}

func TestLocalCollectDeviceProfileUsesRealProbe(t *testing.T) {
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

func TestLocalResolveExecutionPlanFailsOnInvalidRequired(t *testing.T) {
	newTestService(t)
	plan := resolveExecutionPlan(&executionResolveRequest{
		modID:      "world.nimi.invalid-required",
		capability: "chat",
		entries: &runtimev1.LocalExecutionDeclarationDescriptor{
			Required: []*runtimev1.LocalExecutionOptionDescriptor{
				{
					EntryId:    "dep.invalid.service",
					Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_SERVICE,
					Capability: "chat",
					Engine:     "media",
				},
			},
		},
	})
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetEntries()) != 1 || plan.GetEntries()[0].GetSelected() {
		t.Fatalf("required dependency should be rejected: %#v", plan.GetEntries())
	}
}

func TestLocalResolveExecutionPlanRejectsImplicitCapabilityDefault(t *testing.T) {
	newTestService(t)
	plan := resolveExecutionPlan(&executionResolveRequest{
		modID:      "world.nimi.implicit-default",
		capability: "chat",
		entries:    &runtimev1.LocalExecutionDeclarationDescriptor{},
	})
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_DESCRIPTOR_REQUIRED" {
		t.Fatalf("unexpected reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetEntries()) != 0 {
		t.Fatalf("implicit default dependency must not be synthesized: %#v", plan.GetEntries())
	}
	if len(plan.GetWarnings()) == 0 || !strings.Contains(plan.GetWarnings()[0], "dependency descriptor is required") {
		t.Fatalf("expected descriptor-required warning, got %#v", plan.GetWarnings())
	}
}

func TestLocalResolveExecutionPlanRejectsWorkflowKind(t *testing.T) {
	newTestService(t)
	plan := resolveExecutionPlan(&executionResolveRequest{
		modID:      "world.nimi.invalid-workflow-kind",
		capability: "chat",
		entries: &runtimev1.LocalExecutionDeclarationDescriptor{
			Required: []*runtimev1.LocalExecutionOptionDescriptor{
				{
					EntryId:    "dep.invalid.workflow",
					Kind:       runtimev1.LocalExecutionEntryKind(4),
					Capability: "chat",
				},
			},
		},
	})
	if plan.GetReasonCode() != "LOCAL_DEPENDENCY_REQUIRED_UNSATISFIED" {
		t.Fatalf("unexpected plan reason code: %s", plan.GetReasonCode())
	}
	if len(plan.GetEntries()) != 1 {
		t.Fatalf("resolved dependency count mismatch: got=%d want=1", len(plan.GetEntries()))
	}
	dependency := plan.GetEntries()[0]
	if dependency.GetSelected() {
		t.Fatalf("unsupported workflow kind must not be selected")
	}
	if dependency.GetReasonCode() != "LOCAL_EXECUTION_ENTRY_KIND_UNSUPPORTED" {
		t.Fatalf("unexpected dependency reason code: %s", dependency.GetReasonCode())
	}
}

func TestLocalApplyExecutionPlanShortCircuitsOnPreflight(t *testing.T) {
	svc := newTestService(t)
	result := svc.applyExecutionPlanStrict(context.Background(), &runtimev1.LocalExecutionPlan{
		PlanId: "dep-plan-preflight",
		ModId:  "world.nimi.preflight-fail",
		Entries: []*runtimev1.LocalExecutionEntryDescriptor{
			{
				EntryId:    "dep.python-required",
				Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_MODEL,
				Selected:   true,
				Required:   true,
				ModelId:    "local/python-model",
				Capability: "chat",
				Engine:     "python-runtime",
			},
		},
		DeviceProfile: &runtimev1.LocalDeviceProfile{
			Os:   "darwin",
			Arch: "arm64",
			Python: &runtimev1.LocalPythonProfile{
				Available: false,
			},
		},
	})
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_PYTHON_REQUIRED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetInstalledAssets()) != 0 || len(result.GetServices()) != 0 {
		t.Fatalf("preflight failure should block install stage")
	}
}

func TestLocalApplyExecutionPlanFailsWhenNodeUnresolved(t *testing.T) {
	svc := newTestService(t)
	result := svc.applyExecutionPlanStrict(context.Background(), &runtimev1.LocalExecutionPlan{
		PlanId: "dep-plan-node-missing",
		ModId:  "world.nimi.node-missing",
		Entries: []*runtimev1.LocalExecutionEntryDescriptor{
			{
				EntryId:    "dep.node.chat",
				Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_NODE,
				Selected:   true,
				Required:   true,
				Capability: "chat",
				NodeId:     "node_missing_chat",
			},
		},
		DeviceProfile: &runtimev1.LocalDeviceProfile{
			Os:   "darwin",
			Arch: "arm64",
			Python: &runtimev1.LocalPythonProfile{
				Available: true,
			},
		},
	})
	if result.GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetStageResults()) == 0 || result.GetStageResults()[0].GetReasonCode() != "LOCAL_DEPENDENCY_NODE_UNRESOLVED" {
		t.Fatalf("preflight stage must expose node unresolved reason code")
	}
}

func TestLocalApplyExecutionPlanPassesWhenNodeResolved(t *testing.T) {
	svc := newTestService(t)

	modelResp := mustInstallAttachedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "local/node-chat-model",
		capabilities: []string{"chat"},
		engine:       "llama",
	})

	if _, err := svc.InstallLocalService(context.Background(), &runtimev1.InstallLocalServiceRequest{
		ServiceId:    "svc-node-chat",
		Title:        "Node Chat Service",
		Engine:       "llama",
		Capabilities: []string{"chat"},
		LocalModelId: modelResp.GetLocalAssetId(),
		Endpoint:     managedDefaultEndpointForEngine("llama"),
	}); err != nil {
		t.Fatalf("install local service: %v", err)
	}
	if _, err := svc.StartLocalService(context.Background(), &runtimev1.StartLocalServiceRequest{
		ServiceId: "svc-node-chat",
	}); err != nil {
		t.Fatalf("start local service: %v", err)
	}

	nodesResp, err := svc.ListNodeCatalog(context.Background(), &runtimev1.ListNodeCatalogRequest{
		ServiceId: "svc-node-chat",
	})
	if err != nil {
		t.Fatalf("list node catalog: %v", err)
	}
	if len(nodesResp.GetNodes()) == 0 {
		t.Fatalf("expected node catalog entry for active service")
	}
	nodeID := nodesResp.GetNodes()[0].GetNodeId()

	result := svc.applyExecutionPlanStrict(context.Background(), &runtimev1.LocalExecutionPlan{
		PlanId: "dep-plan-node-ready",
		ModId:  "world.nimi.node-ready",
		Entries: []*runtimev1.LocalExecutionEntryDescriptor{
			{
				EntryId:    "dep.node.chat",
				Kind:       runtimev1.LocalExecutionEntryKind_LOCAL_EXECUTION_ENTRY_KIND_NODE,
				Selected:   true,
				Required:   true,
				Capability: "chat",
				ServiceId:  "svc-node-chat",
				NodeId:     nodeID,
			},
		},
		DeviceProfile: &runtimev1.LocalDeviceProfile{
			Os:   "darwin",
			Arch: "arm64",
			Python: &runtimev1.LocalPythonProfile{
				Available: true,
			},
		},
	})
	if result.GetReasonCode() != "ACTION_EXECUTED" {
		t.Fatalf("unexpected reason code: %s", result.GetReasonCode())
	}
	if len(result.GetInstalledAssets()) != 0 || len(result.GetServices()) != 0 {
		t.Fatalf("node-only apply must not install model/service artifacts")
	}
}
