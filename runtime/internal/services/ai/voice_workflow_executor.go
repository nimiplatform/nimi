package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
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

	// local voice workflow: fail-close (no real local engine implementation).
	if provider == "local" {
		s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED, "local voice workflow engine not available")
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
	if ctx.Err() != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			s.voiceAssets.timeoutJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, "voice workflow timeout")
			return
		}
		s.voiceAssets.failJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_INTERNAL, ctx.Err().Error())
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

	s.voiceAssets.completeJob(jobID, result.ProviderJobID, result.ProviderVoiceRef, result.Metadata, result.Usage)
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
		explicitPreferredName := strings.TrimSpace(input.GetPreferredName())
		resolvedPreferredName := resolveVoiceWorkflowPreferredName(req)
		payload["model"] = targetModelID
		payload["target_model_id"] = targetModelID
		payload["name"] = resolvedPreferredName
		payload["voice_name"] = resolvedPreferredName
		if explicitPreferredName != "" {
			payload["preferred_name"] = explicitPreferredName
		}

		inputPayload := map[string]any{
			"reference_audio_uri":  strings.TrimSpace(input.GetReferenceAudioUri()),
			"reference_audio_mime": strings.TrimSpace(input.GetReferenceAudioMime()),
			"language_hints":       append([]string(nil), input.GetLanguageHints()...),
			"preferred_name":       strings.TrimSpace(input.GetPreferredName()),
			"text":                 strings.TrimSpace(input.GetText()),
		}
		if len(input.GetReferenceAudioBytes()) > 0 {
			encoded := base64.StdEncoding.EncodeToString(input.GetReferenceAudioBytes())
			inputPayload["reference_audio_base64"] = encoded
			payload["reference_audio_base64"] = encoded
		}
		if uri := strings.TrimSpace(input.GetReferenceAudioUri()); uri != "" {
			payload["reference_audio_uri"] = uri
			payload["audio_url"] = uri
		}
		if mime := strings.TrimSpace(input.GetReferenceAudioMime()); mime != "" {
			payload["reference_audio_mime"] = mime
		}
		if text := strings.TrimSpace(input.GetText()); text != "" {
			payload["text"] = text
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
		explicitPreferredName := preferredName
		if preferredName == "" {
			preferredName = resolveVoiceWorkflowPreferredName(req)
		}
		payload["model"] = targetModelID
		payload["model_id"] = targetModelID
		payload["target_model_id"] = targetModelID
		payload["name"] = preferredName
		payload["voice_name"] = preferredName
		payload["instruction_text"] = instruction
		payload["description"] = instruction
		payload["preview_text"] = previewText
		payload["text"] = nimillm.FirstNonEmpty(previewText, instruction)
		if explicitPreferredName != "" {
			payload["preferred_name"] = explicitPreferredName
		}
		if language != "" {
			payload["language"] = language
		}
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

func firstNonEmptyStringSlice(values ...[]string) []string {
	for _, group := range values {
		if len(group) == 0 {
			continue
		}
		for _, item := range group {
			if strings.TrimSpace(item) != "" {
				return group
			}
		}
	}
	return nil
}

func valueAsTrimmedStringSlice(value any) []string {
	items := make([]string, 0)
	switch typed := value.(type) {
	case []string:
		for _, item := range typed {
			if trimmed := strings.TrimSpace(item); trimmed != "" {
				items = append(items, trimmed)
			}
		}
	case []any:
		for _, item := range typed {
			if trimmed := strings.TrimSpace(nimillm.ValueAsString(item)); trimmed != "" {
				items = append(items, trimmed)
			}
		}
	}
	if len(items) == 0 {
		return nil
	}
	return items
}
