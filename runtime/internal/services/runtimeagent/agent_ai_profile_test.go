package runtimeagent

import (
	"context"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	localservice "github.com/nimiplatform/nimi/runtime/internal/services/localservice"
	"google.golang.org/protobuf/proto"
)

type runtimeAgentAIProfileDescriptorPreparerStub struct {
	result *localservice.ProfileRuntimeDescriptorPrepareResult
	err    error
}

func (s runtimeAgentAIProfileDescriptorPreparerStub) PrepareProfileRuntimeDescriptorForAIConfig(
	_ context.Context,
	_ []byte,
) (*localservice.ProfileRuntimeDescriptorPrepareResult, error) {
	if s.result == nil {
		return nil, s.err
	}
	out := *s.result
	out.RequirementIDs = append([]string(nil), s.result.RequirementIDs...)
	out.SliceResults = append([]localservice.ProfileRuntimeDescriptorPrepareSliceResult(nil), s.result.SliceResults...)
	for index := range out.SliceResults {
		out.SliceResults[index].ReasonCodes = append([]string(nil), out.SliceResults[index].ReasonCodes...)
		if out.SliceResults[index].TargetRef != nil {
			out.SliceResults[index].TargetRef = proto.Clone(out.SliceResults[index].TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef)
		}
		out.SliceResults[index].SelectedComponents = append(
			[]localservice.ProfileRuntimeDescriptorPreparedComponentSelection(nil),
			s.result.SliceResults[index].SelectedComponents...,
		)
		for componentIndex := range out.SliceResults[index].SelectedComponents {
			component := &out.SliceResults[index].SelectedComponents[componentIndex]
			if component.TargetRef != nil {
				component.TargetRef = proto.Clone(component.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef)
			}
			if component.Options != nil {
				component.Options = map[string]any{}
				for key, value := range s.result.SliceResults[index].SelectedComponents[componentIndex].Options {
					component.Options[key] = value
				}
			}
		}
	}
	return &out, s.err
}

func setRuntimeAgentAIProfileDescriptorPreparer(
	svc *Service,
	preparer runtimeAgentAIProfileDescriptorPreparerStub,
) {
	svc.localAppRouteOptionsMu.Lock()
	svc.profileDescriptorPreparer = preparer
	svc.localAppRouteOptionsMu.Unlock()
}

func readyRuntimeAgentAIProfileDescriptorResult() *localservice.ProfileRuntimeDescriptorPrepareResult {
	localSlice := func(
		sliceID string,
		capability string,
		modelID string,
		targetID string,
	) localservice.ProfileRuntimeDescriptorPrepareSliceResult {
		result := localservice.ProfileRuntimeDescriptorPrepareSliceResult{
			SliceID:         sliceID,
			Capability:      capability,
			Outcome:         "ready",
			ExecutionMode:   "local",
			ReadinessPolicy: "required",
			LogicalModelID:  modelID,
		}
		if targetID != "" {
			result.TargetRef = proto.Clone(
				runtimeAgentAIConfigTestLocalTarget(targetID).GetLocalRuntime(),
			).(*runtimev1.RuntimeDurableLocalTargetRef)
		}
		return result
	}
	image := localSlice("slice:image-generate", runtimeAgentAIConfigCapabilityImageGenerate, "local/z-image-turbo", "z-image-turbo")
	image.SelectedComponents = []localservice.ProfileRuntimeDescriptorPreparedComponentSelection{
		{
			OccurrenceID:   "image-text-encoder",
			Order:          0,
			Role:           "text_encoder",
			ComponentKind:  "llm",
			LogicalModelID: "local/qwen3-4b-q4_k_m",
			TargetRef: proto.Clone(
				runtimeAgentAIConfigTestLocalTarget("qwen3-4b-q4_k_m").GetLocalRuntime(),
			).(*runtimev1.RuntimeDurableLocalTargetRef),
			Required: true,
		},
		{
			OccurrenceID:   "image-vae",
			Order:          1,
			Role:           "vae",
			ComponentKind:  "vae",
			LogicalModelID: "nimi/component/vae/sha256-" + strings.Repeat("a", 64),
			TargetRef: proto.Clone(
				runtimeAgentAIConfigTestLocalTarget("z-image-vae").GetLocalRuntime(),
			).(*runtimev1.RuntimeDurableLocalTargetRef),
			Required: true,
		},
	}
	return &localservice.ProfileRuntimeDescriptorPrepareResult{
		DescriptorID: "descriptor-local-agent-z-image",
		ProfileID:    "profile-local-agent-z-image",
		SliceResults: []localservice.ProfileRuntimeDescriptorPrepareSliceResult{
			localSlice("slice:text-generate", runtimeAgentAIConfigCapabilityTextGenerate, "local/default", "default-text"),
			localSlice("slice:text-embed", runtimeAgentAIConfigCapabilityTextEmbed, runtimeAgentAIConfigTestEmbedModel, "default-embed"),
			image,
		},
		RequirementIDs: []string{"requirement:local-agent"},
	}
}

func runtimeAgentAIProfileTestRouteInventory(
	result *localservice.ProfileRuntimeDescriptorPrepareResult,
) localAppRouteOptionInventoryStub {
	inventory := runtimeAgentAIConfigTestRouteInventory()
	inventory.imageComponents = map[string][]localservice.DurableLocalComponentSelection{}
	inventory.componentKinds = map[string]string{}
	inventory.componentPublicIdentities = map[string]string{}
	for _, slice := range result.SliceResults {
		if slice.Capability != runtimeAgentAIConfigCapabilityImageGenerate || slice.TargetRef == nil {
			continue
		}
		components := make([]localservice.DurableLocalComponentSelection, 0, len(slice.SelectedComponents))
		for _, component := range slice.SelectedComponents {
			localAssetID := "private-" + component.OccurrenceID
			wireLogicalModelID := component.LogicalModelID
			if component.ComponentKind == "vae" {
				wireLogicalModelID = ""
				inventory.componentPublicIdentities[localAssetID] = component.LogicalModelID
			}
			inventory.componentKinds[localAssetID] = component.ComponentKind
			inventory.assets = append(inventory.assets, &runtimev1.LocalAssetRecord{
				LocalAssetId:        localAssetID,
				AssetId:             "private-asset-" + component.OccurrenceID,
				LogicalModelId:      wireLogicalModelID,
				DisplayName:         component.LogicalModelID,
				Status:              runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				DurableTargetStatus: runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE,
				DurableTargetRef:    proto.Clone(component.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
			})
			components = append(components, localservice.DurableLocalComponentSelection{
				OccurrenceID:   component.OccurrenceID,
				Order:          component.Order,
				Role:           component.Role,
				ComponentKind:  component.ComponentKind,
				LogicalModelID: component.LogicalModelID,
				TargetRef:      proto.Clone(component.TargetRef).(*runtimev1.RuntimeDurableLocalTargetRef),
				Required:       component.Required,
				Weight:         component.Weight,
				Options:        component.Options,
			})
		}
		inventory.imageComponents[slice.TargetRef.GetProfileBindingId()] = components
	}
	return inventory
}

func runtimeAgentAIProfileJSON(imageLogicalModelID string) []byte {
	return []byte(`{
		"profileId": "profile-local-agent-z-image",
		"title": "Z Image Turbo Local Agent",
		"capabilities": {
			"text.generate": {
				"logicalModelId": "local/default",
				"targetRef": {
					"kind": "profile-slice",
					"sourceProfileId": "profile-local-agent-z-image",
					"sliceId": "slice:text-generate"
				},
				"readinessPolicy": "required",
				"contractState": "declared",
				"params": {"temperature": 0.7}
			},
			"text.embed": {
				"logicalModelId": "` + runtimeAgentAIConfigTestEmbedModel + `",
				"targetRef": {
					"kind": "profile-slice",
					"sourceProfileId": "profile-local-agent-z-image",
					"sliceId": "slice:text-embed"
				},
				"readinessPolicy": "required",
				"contractState": "declared"
			},
			"image.generate": {
				"logicalModelId": "` + imageLogicalModelID + `",
				"targetRef": {
					"kind": "profile-slice",
					"sourceProfileId": "profile-local-agent-z-image",
					"sliceId": "slice:image-generate"
				},
				"readinessPolicy": "required",
				"contractState": "declared",
				"params": {
					"width": 1024,
					"height": 1024,
					"steps": 9,
					"cfgScale": 1
				}
			}
		}
	}`)
}

func TestRuntimeAgentAIProfilePreviewThenApplyMaterializesInstalledImageTargetsAndCommitsOnce(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	prepared := readyRuntimeAgentAIProfileDescriptorResult()
	inventory := runtimeAgentAIProfileTestRouteInventory(prepared)
	for _, asset := range inventory.assets {
		if asset == nil {
			continue
		}
		if localAppAssetSupportsCapability(asset, runtimeAgentAIConfigCapabilityImageGenerate) ||
			strings.HasPrefix(strings.TrimSpace(asset.GetLocalAssetId()), "private-image-") ||
			strings.HasPrefix(strings.TrimSpace(asset.GetLogicalModelId()), "local/z-image-") ||
			strings.TrimSpace(asset.GetLogicalModelId()) == "local/qwen3-4b-q4_k_m" {
			asset.Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
			asset.DurableTargetStatus = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED
		}
	}
	svc.SetLocalAppRouteOptionInventory(inventory)
	setRuntimeAgentAIProfileDescriptorPreparer(svc, runtimeAgentAIProfileDescriptorPreparerStub{
		result: prepared,
	})
	requestContext := agentAIConfigTestContext("nimi.desktop")

	preview, err := svc.PreviewRuntimeAgentAIProfile(context.Background(), &runtimev1.PreviewRuntimeAgentAIProfileRequest{
		Context:               requestContext,
		ProfileJson:           runtimeAgentAIProfileJSON("local/z-image-turbo"),
		RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
	})
	if err != nil {
		t.Fatalf("PreviewRuntimeAgentAIProfile: %v", err)
	}
	if preview.GetOutcome() != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY {
		t.Fatalf("preview outcome = %s, reasons = %v", preview.GetOutcome(), preview.GetReasonCodes())
	}
	if preview.GetBaseRevision() != 1 || preview.GetBefore().GetRevision() != 1 || preview.GetAfter().GetRevision() != 2 {
		t.Fatalf("unexpected preview revisions: base=%d before=%d after=%d", preview.GetBaseRevision(), preview.GetBefore().GetRevision(), preview.GetAfter().GetRevision())
	}
	imagePreview := requireAgentAIConfigIntent(t, preview.GetAfter(), runtimeAgentAIConfigCapabilityImageGenerate)
	if imagePreview.GetModelId() != "local/z-image-turbo" ||
		!proto.Equal(imagePreview.GetTargetRef(), runtimeAgentAIConfigTestLocalTarget("z-image-turbo")) {
		t.Fatalf("preview did not use descriptor exact image target: %+v", imagePreview)
	}
	if imagePreview.GetSelectedParams().GetFields()["steps"].GetNumberValue() != 9 {
		t.Fatalf("preview image params were not materialized: %+v", imagePreview.GetSelectedParams())
	}
	if len(imagePreview.GetSelectedComponents()) != 2 ||
		imagePreview.GetSelectedComponents()[0].GetOccurrenceId() != "image-text-encoder" ||
		imagePreview.GetSelectedComponents()[0].GetOrder() != 0 ||
		imagePreview.GetSelectedComponents()[0].GetLogicalModelId() != "local/qwen3-4b-q4_k_m" ||
		imagePreview.GetSelectedComponents()[1].GetOccurrenceId() != "image-vae" ||
		imagePreview.GetSelectedComponents()[1].GetOrder() != 1 ||
		imagePreview.GetSelectedComponents()[1].GetLogicalModelId() != "nimi/component/vae/sha256-"+strings.Repeat("a", 64) {
		t.Fatalf("preview image components were not materialized into AIConfig: %+v", imagePreview.GetSelectedComponents())
	}
	textPreview := requireAgentAIConfigIntent(t, preview.GetAfter(), runtimeAgentAIConfigCapabilityTextGenerate)
	if textPreview.GetModelId() != "local/default" ||
		!proto.Equal(textPreview.GetTargetRef(), runtimeAgentAIConfigTestLocalTarget("default-text")) {
		t.Fatalf("text profile slice did not materialize its exact target: %+v", textPreview)
	}
	embedPreview := requireAgentAIConfigIntent(t, preview.GetAfter(), runtimeAgentAIConfigCapabilityTextEmbed)
	if embedPreview.GetModelId() != runtimeAgentAIConfigTestEmbedModel ||
		!proto.Equal(embedPreview.GetTargetRef(), runtimeAgentAIConfigTestLocalTarget("default-embed")) {
		t.Fatalf("embedding profile slice did not materialize its exact target: %+v", embedPreview)
	}
	uncommitted, err := svc.committedRuntimeAgentAIConfigForContext(requestContext)
	if err != nil {
		t.Fatalf("committed config after preview: %v", err)
	}
	if uncommitted.GetRevision() != 1 {
		t.Fatalf("preview committed live config: revision=%d", uncommitted.GetRevision())
	}

	applied, err := svc.ApplyRuntimeAgentAIProfile(context.Background(), &runtimev1.ApplyRuntimeAgentAIProfileRequest{
		Context:               requestContext,
		ExpectedRevision:      preview.GetBaseRevision(),
		ProfileJson:           runtimeAgentAIProfileJSON("local/z-image-turbo"),
		RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
	})
	if err != nil {
		t.Fatalf("ApplyRuntimeAgentAIProfile: %v", err)
	}
	if applied.GetOutcome() != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_READY_TO_APPLY {
		t.Fatalf("apply outcome = %s, reasons = %v", applied.GetOutcome(), applied.GetReasonCodes())
	}
	if applied.GetConfig().GetRevision() != 2 {
		t.Fatalf("applied revision = %d, want 2", applied.GetConfig().GetRevision())
	}
	if applied.GetConfig().GetProfileOrigin().GetProfileId() != "profile-local-agent-z-image" {
		t.Fatalf("profile origin missing: %+v", applied.GetConfig().GetProfileOrigin())
	}
	appliedImage := requireAgentAIConfigIntent(t, applied.GetConfig(), runtimeAgentAIConfigCapabilityImageGenerate)
	if appliedImage.GetTargetRef().GetLocalRuntime().GetProfileBindingId() == "" ||
		len(appliedImage.GetSelectedComponents()) != 2 {
		t.Fatalf("apply did not commit exact image composition: %+v", appliedImage)
	}
	imageReadiness := requireExecutionCapabilityReadiness(
		t,
		agentAIConfigReadinessSnapshot(t, svc),
		runtimeAgentAIConfigCapabilityImageGenerate,
	)
	if imageReadiness.GetState() != runtimev1.RuntimeAgentAIConfigReadinessState_RUNTIME_AGENT_AI_CONFIG_READINESS_STATE_CONFIGURED_UNVERIFIED ||
		imageReadiness.GetReasonCode() != agentAIConfigReadinessReasonImageConfiguredUnverified ||
		imageReadiness.GetProbedAt() != nil {
		t.Fatalf("installed image readiness = %+v", imageReadiness)
	}

	stale, err := svc.ApplyRuntimeAgentAIProfile(context.Background(), &runtimev1.ApplyRuntimeAgentAIProfileRequest{
		Context:               requestContext,
		ExpectedRevision:      1,
		ProfileJson:           runtimeAgentAIProfileJSON("local/z-image-turbo"),
		RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
	})
	if err != nil {
		t.Fatalf("stale ApplyRuntimeAgentAIProfile: %v", err)
	}
	if stale.GetOutcome() != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_STALE_BASE {
		t.Fatalf("stale outcome = %s", stale.GetOutcome())
	}
	committed, err := svc.committedRuntimeAgentAIConfigForContext(requestContext)
	if err != nil {
		t.Fatalf("committed config after stale apply: %v", err)
	}
	if committed.GetRevision() != 2 {
		t.Fatalf("stale apply advanced revision: %d", committed.GetRevision())
	}
}

func TestRuntimeAgentAIProfileRejectsLogicalModelExactTargetMismatchWithoutFallback(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	setRuntimeAgentAIProfileDescriptorPreparer(svc, runtimeAgentAIProfileDescriptorPreparerStub{
		result: readyRuntimeAgentAIProfileDescriptorResult(),
	})

	preview, err := svc.PreviewRuntimeAgentAIProfile(context.Background(), &runtimev1.PreviewRuntimeAgentAIProfileRequest{
		Context:               agentAIConfigTestContext("nimi.desktop"),
		ProfileJson:           runtimeAgentAIProfileJSON("local/image"),
		RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
	})
	if err != nil {
		t.Fatalf("PreviewRuntimeAgentAIProfile: %v", err)
	}
	if preview.GetOutcome() != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_INVALID_PROFILE {
		t.Fatalf("outcome = %s, want INVALID_PROFILE", preview.GetOutcome())
	}
	if len(preview.GetReasonCodes()) != 1 || preview.GetReasonCodes()[0] != "profile_model_target_mismatch" {
		t.Fatalf("reason codes = %v", preview.GetReasonCodes())
	}
	if preview.GetAfter() != nil {
		t.Fatalf("mismatched profile produced live candidate: %+v", preview.GetAfter())
	}
	committed, err := svc.committedRuntimeAgentAIConfigForContext(agentAIConfigTestContext("nimi.desktop"))
	if err != nil {
		t.Fatalf("committed config: %v", err)
	}
	if committed.GetRevision() != 1 {
		t.Fatalf("mismatched profile changed revision: %d", committed.GetRevision())
	}
}

func TestRuntimeAgentAIProfileSetupRequiredDoesNotProduceOrCommitLiveConfig(t *testing.T) {
	t.Parallel()
	svc := newAgentAIConfigTestService(t)
	result := readyRuntimeAgentAIProfileDescriptorResult()
	result.SliceResults[2].Outcome = "setup_required_no_live_config"
	result.SliceResults[2].ReasonCodes = []string{"required_companion_missing"}
	result.SliceResults[2].TargetRef = nil
	setRuntimeAgentAIProfileDescriptorPreparer(svc, runtimeAgentAIProfileDescriptorPreparerStub{result: result})

	applied, err := svc.ApplyRuntimeAgentAIProfile(context.Background(), &runtimev1.ApplyRuntimeAgentAIProfileRequest{
		Context:               agentAIConfigTestContext("nimi.desktop"),
		ExpectedRevision:      1,
		ProfileJson:           runtimeAgentAIProfileJSON("local/z-image-turbo"),
		RuntimeDescriptorJson: []byte(`{"descriptor_id":"descriptor-local-agent-z-image"}`),
	})
	if err != nil {
		t.Fatalf("ApplyRuntimeAgentAIProfile: %v", err)
	}
	if applied.GetOutcome() != runtimev1.RuntimeAgentAIProfileApplyOutcome_RUNTIME_AGENT_AI_PROFILE_APPLY_OUTCOME_SETUP_REQUIRED_NO_LIVE_CONFIG {
		t.Fatalf("outcome = %s, reasons = %v", applied.GetOutcome(), applied.GetReasonCodes())
	}
	if applied.GetConfig() != nil {
		t.Fatalf("setup-required profile committed config: %+v", applied.GetConfig())
	}
	committed, err := svc.committedRuntimeAgentAIConfigForContext(agentAIConfigTestContext("nimi.desktop"))
	if err != nil {
		t.Fatalf("committed config: %v", err)
	}
	if committed.GetRevision() != 1 {
		t.Fatalf("setup-required apply changed revision: %d", committed.GetRevision())
	}
}
