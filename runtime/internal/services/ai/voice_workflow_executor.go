package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
)

// voiceWorkflowExecutionResult captures the output from a voice workflow adapter.
type voiceWorkflowExecutionResult struct {
	ProviderJobID    string
	ProviderVoiceRef string
	Metadata         map[string]any
	Usage            *runtimev1.UsageStats
}

const maxVoiceWorkflowReferenceAudioBytes = 20 * 1024 * 1024

func workflowTypeFromScenarioType(scenarioType runtimev1.ScenarioType) string {
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		return "tts_v2v"
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		return "tts_t2v"
	default:
		return ""
	}
}

func validateVoiceWorkflowSpec(scenarioType runtimev1.ScenarioType, spec *runtimev1.ScenarioSpec) error {
	if spec == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	switch scenarioType {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		clone := spec.GetVoiceClone()
		if clone == nil || clone.GetInput() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		input := clone.GetInput()
		hasBytes := len(input.GetReferenceAudioBytes()) > 0
		hasURI := strings.TrimSpace(input.GetReferenceAudioUri()) != ""
		if hasBytes == hasURI {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if hasBytes {
			if len(input.GetReferenceAudioBytes()) > maxVoiceWorkflowReferenceAudioBytes {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
			if strings.TrimSpace(input.GetReferenceAudioMime()) == "" {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
			}
		}
		if strings.TrimSpace(clone.GetTargetModelId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
		}
		return nil
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		design := spec.GetVoiceDesign()
		if design == nil || design.GetInput() == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		input := design.GetInput()
		if strings.TrimSpace(input.GetInstructionText()) == "" && strings.TrimSpace(input.GetPreviewText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if strings.TrimSpace(design.GetTargetModelId()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

func (s *Service) resolveVoiceWorkflow(ctx context.Context, providerType string, modelResolved string, workflowType string) (catalog.ResolveVoiceWorkflowResult, error) {
	if s == nil || s.speechCatalog == nil {
		return catalog.ResolveVoiceWorkflowResult{}, catalog.ErrVoiceWorkflowUnsupported
	}
	provider := strings.TrimSpace(strings.ToLower(providerType))
	if provider == "" {
		provider = inferVoiceAssetProvider(modelResolved)
	}
	if provider == "" {
		provider = inferScenarioProviderType(modelResolved, nil, nil, runtimev1.Modal_MODAL_UNSPECIFIED)
	}
	return s.speechCatalog.ResolveVoiceWorkflowForSubject(catalogSubjectUserIDFromContext(ctx), provider, modelResolved, workflowType)
}

func voiceWorkflowCatalogProviderType(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	providerType := inferScenarioProviderType(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_TTS)
	if remoteTarget == nil && selected != nil && selected.Route() == runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL && localrouting.IsKnownProvider(providerType) {
		return "local"
	}
	return providerType
}

func (s *Service) executeVoiceWorkflowJob(
	ctx context.Context,
	jobID string,
	voiceAssetID string,
	resolution catalog.ResolveVoiceWorkflowResult,
	req *runtimev1.SubmitScenarioJobRequest,
	cfg nimillm.MediaAdapterConfig,
) {
	if s == nil || s.voiceAssets == nil {
		return
	}
	if !s.voiceAssets.queueJob(jobID) {
		return
	}
	if !s.voiceAssets.runJob(jobID) {
		return
	}

	provider := strings.TrimSpace(strings.ToLower(resolution.Provider))

	if provider == "local" {
		localCfg := s.resolveLocalVoiceWorkflowAdapterConfig(req, resolution)
		if strings.TrimSpace(localCfg.BaseURL) != "" && strings.EqualFold(strings.TrimSpace(resolution.WorkflowFamily), "voxcpm") {
			result, err := executeVoiceWorkflowViaLocalSpeechHost(ctx, req, resolution, localCfg)
			if err == nil {
				if result.Metadata == nil {
					result.Metadata = map[string]any{}
				}
				result.Metadata["voice_asset_id"] = voiceAssetID
				result.Metadata["workflow_model_id"] = resolution.WorkflowModelID
				result.Metadata["workflow_type"] = resolution.WorkflowType
				result.Metadata["workflow_family"] = strings.TrimSpace(resolution.WorkflowFamily)
				if strings.TrimSpace(resolution.HandlePolicyID) != "" {
					result.Metadata["voice_handle_policy_id"] = strings.TrimSpace(resolution.HandlePolicyID)
				}
				if strings.TrimSpace(resolution.HandlePolicyPersistence) != "" {
					result.Metadata["voice_handle_policy_persistence"] = strings.TrimSpace(resolution.HandlePolicyPersistence)
				}
				if strings.TrimSpace(resolution.HandlePolicyScope) != "" {
					result.Metadata["voice_handle_policy_scope"] = strings.TrimSpace(resolution.HandlePolicyScope)
				}
				if strings.TrimSpace(resolution.HandlePolicyDefaultTTL) != "" {
					result.Metadata["voice_handle_policy_default_ttl"] = strings.TrimSpace(resolution.HandlePolicyDefaultTTL)
				}
				if strings.TrimSpace(resolution.HandlePolicyDeleteSemantics) != "" {
					result.Metadata["voice_handle_policy_delete_semantics"] = strings.TrimSpace(resolution.HandlePolicyDeleteSemantics)
				}
				if resolution.RuntimeReconciliationRequired {
					result.Metadata["voice_handle_policy_runtime_reconciliation_required"] = true
				}
				s.voiceAssets.completeJob(jobID, result.ProviderJobID, result.ProviderVoiceRef, result.Metadata, result.Usage)
				return
			}
			reasonCode := reasonCodeFromMediaError(err)
			if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
				reasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
			}
			s.voiceAssets.failJob(jobID, reasonCode, sanitizeScenarioJobReasonDetail(err, reasonCode))
			return
		}
		detail := "local voice workflow engine not available"
		if family := strings.TrimSpace(resolution.WorkflowFamily); family != "" {
			detail = "local voice workflow family admitted in control plane but execution plane not materialized: " + family
		}
		s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED, detail)
		return
	}

	if !nimillm.SupportsVoiceWorkflowProvider(provider) {
		s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED, "voice workflow adapter unavailable for provider: "+provider)
		return
	}

	// Build the nimillm request from the scenario request.
	result, err := executeVoiceWorkflowViaNimillm(ctx, provider, req, resolution, cfg)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			s.voiceAssets.timeoutJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "voice workflow timeout")
			return
		}
		if errors.Is(err, context.Canceled) {
			s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, "voice workflow canceled")
			return
		}
		reasonCode := reasonCodeFromMediaError(err)
		if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
		s.voiceAssets.failJob(jobID, reasonCode, sanitizeScenarioJobReasonDetail(err, reasonCode))
		return
	}
	if strings.TrimSpace(result.ProviderVoiceRef) == "" {
		s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_OUTPUT_INVALID, "adapter returned empty provider_voice_ref")
		return
	}
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	result.Metadata["voice_asset_id"] = voiceAssetID
	result.Metadata["workflow_model_id"] = resolution.WorkflowModelID
	result.Metadata["workflow_type"] = resolution.WorkflowType
	if strings.TrimSpace(resolution.WorkflowFamily) != "" {
		result.Metadata["workflow_family"] = strings.TrimSpace(resolution.WorkflowFamily)
	}
	if strings.TrimSpace(resolution.HandlePolicyID) != "" {
		result.Metadata["voice_handle_policy_id"] = strings.TrimSpace(resolution.HandlePolicyID)
	}
	if strings.TrimSpace(resolution.HandlePolicyPersistence) != "" {
		result.Metadata["voice_handle_policy_persistence"] = strings.TrimSpace(resolution.HandlePolicyPersistence)
	}
	if strings.TrimSpace(resolution.HandlePolicyScope) != "" {
		result.Metadata["voice_handle_policy_scope"] = strings.TrimSpace(resolution.HandlePolicyScope)
	}
	if strings.TrimSpace(resolution.HandlePolicyDefaultTTL) != "" {
		result.Metadata["voice_handle_policy_default_ttl"] = strings.TrimSpace(resolution.HandlePolicyDefaultTTL)
	}
	if strings.TrimSpace(resolution.HandlePolicyDeleteSemantics) != "" {
		result.Metadata["voice_handle_policy_delete_semantics"] = strings.TrimSpace(resolution.HandlePolicyDeleteSemantics)
	}
	if resolution.RuntimeReconciliationRequired {
		result.Metadata["voice_handle_policy_runtime_reconciliation_required"] = true
	}

	s.voiceAssets.completeJob(jobID, result.ProviderJobID, result.ProviderVoiceRef, result.Metadata, result.Usage)
}

func (s *Service) resolveLocalVoiceWorkflowAdapterConfig(req *runtimev1.SubmitScenarioJobRequest, resolution catalog.ResolveVoiceWorkflowResult) nimillm.MediaAdapterConfig {
	if s == nil || s.selector == nil || req == nil {
		return nimillm.MediaAdapterConfig{}
	}
	local, ok := s.selector.local.(*localProvider)
	if !ok || local == nil {
		return nimillm.MediaAdapterConfig{}
	}
	modelResolved := strings.TrimSpace(resolution.ModelID)
	if modelResolved == "" {
		modelResolved = strings.TrimSpace(req.GetHead().GetModelId())
	}
	backend, _, providerType := local.resolveMediaBackendForModal(modelResolved, runtimev1.Modal_MODAL_TTS)
	if backend == nil || !strings.EqualFold(strings.TrimSpace(providerType), "speech") {
		return nimillm.MediaAdapterConfig{}
	}
	return nimillm.MediaAdapterConfig{BaseURL: strings.TrimSpace(backend.Endpoint())}
}

func executeVoiceWorkflowViaLocalSpeechHost(
	ctx context.Context,
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
	cfg nimillm.MediaAdapterConfig,
) (voiceWorkflowExecutionResult, error) {
	baseURL := strings.TrimSpace(cfg.BaseURL)
	if baseURL == "" {
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	path := ""
	switch strings.TrimSpace(resolution.WorkflowType) {
	case "tts_v2v":
		path = "/v1/voice/clone"
	case "tts_t2v":
		path = "/v1/voice/design"
	default:
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	extPayload, err := resolveVoiceWorkflowExtensionPayload(req, "local")
	if err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	payload := buildVoiceWorkflowPayload(req, resolution, extPayload)
	response := map[string]any{}
	if err := nimillm.DoJSONRequestWithHeaders(ctx, http.MethodPost, nimillm.JoinURL(baseURL, path), "", payload, &response, nil); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	providerVoiceRef := strings.TrimSpace(nimillm.FirstNonEmpty(
		nimillm.ValueAsString(response["voice_ref"]),
		nimillm.ValueAsString(response["voice_id"]),
	))
	if providerVoiceRef == "" {
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	metadata := map[string]any{
		"provider":          "local",
		"workflow_type":     strings.TrimSpace(resolution.WorkflowType),
		"workflow_model_id": strings.TrimSpace(resolution.WorkflowModelID),
		"adapter":           "local_speech_workflow_host",
		"endpoint":          strings.TrimSpace(path),
	}
	if hostMeta, ok := response["metadata"].(map[string]any); ok {
		for key, value := range hostMeta {
			metadata[key] = value
		}
	}
	return voiceWorkflowExecutionResult{
		ProviderJobID:    strings.TrimSpace(nimillm.ValueAsString(response["job_id"])),
		ProviderVoiceRef: providerVoiceRef,
		Metadata:         metadata,
		Usage:            estimateVoiceWorkflowUsage(req),
	}, nil
}

// executeVoiceWorkflowViaNimillm builds the nimillm voice workflow request
// from the scenario proto and delegates to nimillm.ExecuteVoiceWorkflow.
func executeVoiceWorkflowViaNimillm(
	ctx context.Context,
	provider string,
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
	cfg nimillm.MediaAdapterConfig,
) (voiceWorkflowExecutionResult, error) {
	if req == nil || req.GetSpec() == nil {
		return voiceWorkflowExecutionResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	if err := validateVoiceWorkflowSpec(req.GetScenarioType(), req.GetSpec()); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return voiceWorkflowExecutionResult{}, err
	}

	extPayload, err := resolveVoiceWorkflowExtensionPayload(req, provider)
	if err != nil {
		return voiceWorkflowExecutionResult{}, err
	}
	payload := buildVoiceWorkflowPayload(req, resolution, extPayload)

	nimillmReq := nimillm.VoiceWorkflowRequest{
		Provider:        provider,
		WorkflowType:    strings.TrimSpace(resolution.WorkflowType),
		WorkflowModelID: strings.TrimSpace(resolution.WorkflowModelID),
		ModelID:         strings.TrimSpace(resolution.ModelID),
		Payload:         payload,
		ExtPayload:      extPayload,
	}

	nimillmResult, err := nimillm.ExecuteVoiceWorkflow(ctx, nimillmReq, cfg)
	if err != nil {
		return voiceWorkflowExecutionResult{}, err
	}

	return voiceWorkflowExecutionResult{
		ProviderJobID:    nimillmResult.ProviderJobID,
		ProviderVoiceRef: nimillmResult.ProviderVoiceRef,
		Metadata:         nimillmResult.Metadata,
		Usage:            estimateVoiceWorkflowUsage(req),
	}, nil
}

// buildVoiceWorkflowPayload builds a provider-agnostic payload from the scenario request.
func buildVoiceWorkflowPayload(
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
	extPayload map[string]any,
) map[string]any {
	payload := map[string]any{
		"workflow_model_id": strings.TrimSpace(resolution.WorkflowModelID),
		"workflow_type":     strings.TrimSpace(resolution.WorkflowType),
	}
	if len(extPayload) > 0 {
		payload["extensions"] = extPayload
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		clone := req.GetSpec().GetVoiceClone()
		input := clone.GetInput()
		targetModelID := strings.TrimSpace(clone.GetTargetModelId())
		if targetModelID == "" {
			targetModelID = strings.TrimSpace(resolution.ModelID)
		}
		resolvedPreferredName := resolveVoiceWorkflowPreferredName(req)
		payload["target_model_id"] = targetModelID

		inputPayload := map[string]any{
			"reference_audio_uri":  strings.TrimSpace(input.GetReferenceAudioUri()),
			"reference_audio_mime": strings.TrimSpace(input.GetReferenceAudioMime()),
			"language_hints":       append([]string(nil), input.GetLanguageHints()...),
			"preferred_name":       resolvedPreferredName,
			"text":                 strings.TrimSpace(input.GetText()),
		}
		if len(input.GetReferenceAudioBytes()) > 0 {
			inputPayload["reference_audio_base64"] = base64.StdEncoding.EncodeToString(input.GetReferenceAudioBytes())
		}
		payload["input"] = inputPayload
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		design := req.GetSpec().GetVoiceDesign()
		input := design.GetInput()
		targetModelID := strings.TrimSpace(design.GetTargetModelId())
		if targetModelID == "" {
			targetModelID = strings.TrimSpace(resolution.ModelID)
		}
		instruction := strings.TrimSpace(input.GetInstructionText())
		previewText := strings.TrimSpace(input.GetPreviewText())
		language := strings.TrimSpace(input.GetLanguage())
		preferredName := strings.TrimSpace(input.GetPreferredName())
		if preferredName == "" {
			preferredName = resolveVoiceWorkflowPreferredName(req)
		}
		payload["target_model_id"] = targetModelID
		payload["input"] = map[string]any{
			"instruction_text": instruction,
			"preview_text":     previewText,
			"language":         language,
			"preferred_name":   preferredName,
		}
	}
	return payload
}

func estimateVoiceWorkflowUsage(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.UsageStats {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	inputTokens := int64(0)
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		clone := req.GetSpec().GetVoiceClone()
		if clone != nil && clone.GetInput() != nil {
			input := clone.GetInput()
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetReferenceAudioUri()))
			inputTokens += int64(len(input.GetReferenceAudioBytes()) / 256)
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetText()))
			for _, hint := range input.GetLanguageHints() {
				inputTokens += nimillm.EstimateTokens(strings.TrimSpace(hint))
			}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		design := req.GetSpec().GetVoiceDesign()
		if design != nil && design.GetInput() != nil {
			input := design.GetInput()
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetInstructionText()))
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetPreviewText()))
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetLanguage()))
		}
	}
	if inputTokens <= 0 {
		inputTokens = 1
	}
	computeMs := int64(50)
	if inputTokens < 25 {
		computeMs += inputTokens
	} else {
		computeMs += 25
	}
	return &runtimev1.UsageStats{
		InputTokens:  inputTokens,
		OutputTokens: 1,
		ComputeMs:    computeMs,
	}
}

func voiceWorkflowInputSummary(req *runtimev1.SubmitScenarioJobRequest) string {
	if req == nil || req.GetSpec() == nil {
		return ""
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		clone := req.GetSpec().GetVoiceClone()
		if clone == nil || clone.GetInput() == nil {
			return ""
		}
		input := clone.GetInput()
		return strings.Join([]string{
			strings.TrimSpace(clone.GetTargetModelId()),
			strings.TrimSpace(input.GetReferenceAudioUri()),
			fmt.Sprintf("%d", len(input.GetReferenceAudioBytes())),
			strings.TrimSpace(input.GetText()),
			strings.Join(input.GetLanguageHints(), ","),
			strings.TrimSpace(input.GetPreferredName()),
		}, "|")
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		design := req.GetSpec().GetVoiceDesign()
		if design == nil || design.GetInput() == nil {
			return ""
		}
		input := design.GetInput()
		return strings.Join([]string{
			strings.TrimSpace(design.GetTargetModelId()),
			strings.TrimSpace(input.GetInstructionText()),
			strings.TrimSpace(input.GetPreviewText()),
			strings.TrimSpace(input.GetLanguage()),
			strings.TrimSpace(input.GetPreferredName()),
		}, "|")
	default:
		return ""
	}
}

func resolveVoiceWorkflowPreferredName(req *runtimev1.SubmitScenarioJobRequest) string {
	if req == nil || req.GetSpec() == nil {
		return "nimi-voice-" + strings.ToLower(ulid.Make().String())
	}
	switch req.GetScenarioType() {
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CLONE:
		if clone := req.GetSpec().GetVoiceClone(); clone != nil && clone.GetInput() != nil {
			if name := strings.TrimSpace(clone.GetInput().GetPreferredName()); name != "" {
				return name
			}
		}
	case runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_DESIGN:
		if design := req.GetSpec().GetVoiceDesign(); design != nil && design.GetInput() != nil {
			if name := strings.TrimSpace(design.GetInput().GetPreferredName()); name != "" {
				return name
			}
		}
	}
	return "nimi-voice-" + strings.ToLower(ulid.Make().String())
}
