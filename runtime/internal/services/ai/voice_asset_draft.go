package ai

import (
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/timestamppb"
)

type voiceWorkflowSubmitInput struct {
	Head              *runtimev1.ScenarioRequestHead
	ScenarioType      runtimev1.ScenarioType
	Spec              *runtimev1.ScenarioSpec
	ModelResolved     string
	Provider          string
	WorkflowModelID   string
	WorkflowFamily    string
	OutputPersistence string
	HandlePolicyID    string
	HandlePersistence string
	HandleScope       string
	HandleDefaultTTL  string
	HandleDeleteSem   string
	RuntimeReconcile  bool
}

func newVoiceAssetDraft(input *voiceWorkflowSubmitInput, assetID string, now *timestamppb.Timestamp) *runtimev1.VoiceAsset {
	if input == nil || input.Head == nil || input.Spec == nil || strings.TrimSpace(assetID) == "" || now == nil {
		return nil
	}
	creationSource := runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_UNSPECIFIED
	targetModelID := ""
	if input.ScenarioType == runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE && input.Spec.GetVoiceCreate() != nil {
		creation := input.Spec.GetVoiceCreate()
		targetModelID = strings.TrimSpace(creation.GetTargetModelId())
		switch creation.GetSource().(type) {
		case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
			creationSource = runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_REFERENCE_AUDIO
		case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
			creationSource = runtimev1.VoiceCreationSource_VOICE_CREATION_SOURCE_TEXT_DESCRIPTION
		}
	}
	persistence := runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_SESSION_EPHEMERAL
	if strings.EqualFold(strings.TrimSpace(input.OutputPersistence), "provider_persistent") {
		persistence = runtimev1.VoiceAssetPersistence_VOICE_ASSET_PERSISTENCE_PROVIDER_PERSISTENT
	}
	asset := &runtimev1.VoiceAsset{
		VoiceAssetId: assetID, AppId: input.Head.GetAppId(), SubjectUserId: input.Head.GetSubjectUserId(),
		CreationSource: creationSource, Provider: strings.TrimSpace(input.Provider), ModelId: strings.TrimSpace(input.ModelResolved),
		TargetModelId: targetModelID, Persistence: persistence, Status: runtimev1.VoiceAssetStatus_VOICE_ASSET_STATUS_UNSPECIFIED,
		CreatedAt: now, UpdatedAt: now,
	}
	workflowFamily := strings.TrimSpace(input.WorkflowFamily)
	if strings.TrimSpace(input.WorkflowModelID) != "" || workflowFamily != "" || strings.TrimSpace(input.ModelResolved) != "" ||
		strings.TrimSpace(input.HandlePolicyID) != "" || strings.TrimSpace(input.HandlePersistence) != "" ||
		strings.TrimSpace(input.HandleScope) != "" || strings.TrimSpace(input.HandleDefaultTTL) != "" ||
		strings.TrimSpace(input.HandleDeleteSem) != "" || input.RuntimeReconcile {
		metadata := map[string]any{"workflow_model_id": strings.TrimSpace(input.WorkflowModelID), "model_resolved": strings.TrimSpace(input.ModelResolved)}
		if workflowFamily != "" {
			metadata["workflow_family"] = workflowFamily
		}
		if value := strings.TrimSpace(input.HandlePolicyID); value != "" {
			metadata["voice_handle_policy_id"] = value
		}
		if value := strings.TrimSpace(input.HandlePersistence); value != "" {
			metadata["voice_handle_policy_persistence"] = value
		}
		if value := strings.TrimSpace(input.HandleScope); value != "" {
			metadata["voice_handle_policy_scope"] = value
		}
		if value := strings.TrimSpace(input.HandleDefaultTTL); value != "" {
			metadata["voice_handle_policy_default_ttl"] = value
		}
		if value := strings.TrimSpace(input.HandleDeleteSem); value != "" {
			metadata["voice_handle_policy_delete_semantics"] = value
		}
		if input.RuntimeReconcile {
			metadata["voice_handle_policy_runtime_reconciliation_required"] = true
		}
		asset.Metadata = structFromMap(metadata)
	}
	return asset
}
