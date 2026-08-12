package ai

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/oklog/ulid/v2"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"
)

// voiceWorkflowExecutionResult captures the output from a voice workflow adapter.
type voiceWorkflowExecutionResult struct {
	ProviderJobID    string
	ProviderVoiceRef string
	Metadata         map[string]any
	Usage            *runtimev1.UsageStats
}

func voiceWorkflowFailureMetadata(err error, reasonCode runtimev1.ReasonCode, contextValues map[string]any) *structpb.Struct {
	values := map[string]any{
		"failure_stage": "voice_workflow_execution",
	}
	if metadata := scenarioJobReasonMetadata(err, reasonCode); metadata != nil {
		for key, value := range metadata.AsMap() {
			values[key] = value
		}
	}
	for key, value := range contextValues {
		values[key] = value
	}
	return structFromMap(values)
}

const maxVoiceWorkflowReferenceAudioBytes = 20 * 1024 * 1024

func workflowTypeFromScenarioSpec(spec *runtimev1.ScenarioSpec) string {
	if spec == nil || spec.GetVoiceCreate() == nil {
		return ""
	}
	switch spec.GetVoiceCreate().GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		return "reference_audio"
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		return "text_description"
	default:
		return ""
	}
}

func validateVoiceWorkflowSpec(scenarioType runtimev1.ScenarioType, spec *runtimev1.ScenarioSpec) error {
	if scenarioType != runtimev1.ScenarioType_SCENARIO_TYPE_VOICE_CREATE || spec == nil || spec.GetVoiceCreate() == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
	creation := spec.GetVoiceCreate()
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		if input == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		hasBytes := len(input.GetReferenceAudioBytes()) > 0
		hasURI := strings.TrimSpace(input.GetReferenceAudioUri()) != ""
		if hasBytes == hasURI {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if hasBytes && (len(input.GetReferenceAudioBytes()) > maxVoiceWorkflowReferenceAudioBytes || strings.TrimSpace(input.GetReferenceAudioMime()) == "") {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		return nil
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		if input == nil || (strings.TrimSpace(input.GetInstructionText()) == "" && strings.TrimSpace(input.GetPreviewText()) == "") {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
}

func (s *Service) resolveVoiceWorkflow(ctx context.Context, providerType string, modelResolved string, workflowType string) (catalog.ResolveVoiceWorkflowResult, error) {
	if s == nil || s.speechCatalog == nil {
		return catalog.ResolveVoiceWorkflowResult{}, catalog.ErrVoiceWorkflowUnsupported
	}
	provider := strings.TrimSpace(strings.ToLower(providerType))
	if provider == "" {
		return catalog.ResolveVoiceWorkflowResult{}, catalog.ErrVoiceWorkflowUnsupported
	}
	return s.speechCatalog.ResolveVoiceWorkflowForSubject(catalogSubjectUserIDFromContext(ctx), provider, modelResolved, workflowType)
}

func voiceWorkflowCatalogProviderType(modelResolved string, remoteTarget *nimillm.RemoteTarget, selected provider) string {
	return scenarioProviderTypeFromTarget(modelResolved, remoteTarget, selected, runtimev1.Modal_MODAL_TTS)
}

func (s *Service) executeCapturedVoiceWorkflowJob(
	ctx context.Context,
	jobID string,
	voiceAssetID string,
	effective *cloudVoiceWorkflowEffectiveInputs,
) {
	if s == nil || s.voiceAssets == nil || effective == nil || !s.voiceAssets.startJobExecution(jobID) {
		return
	}
	defer s.voiceAssets.finishJobExecution(jobID)
	if !s.voiceAssets.queueJob(jobID) {
		return
	}
	release, err := s.acquireAsyncScenarioJobLease(ctx, effective.appID, "scenario_job_voice_workflow")
	if err != nil {
		if errors.Is(ctx.Err(), context.DeadlineExceeded) {
			s.voiceAssets.timeoutJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, stableScenarioJobReasonDetail(runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT), voiceWorkflowFailureMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, nil))
		} else if !errors.Is(ctx.Err(), context.Canceled) {
			reasonCode := runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE
			s.voiceAssets.failJob(jobID, reasonCode, sanitizeScenarioJobReasonDetail(err, reasonCode), voiceWorkflowFailureMetadata(err, reasonCode, nil))
		}
		return
	}
	defer release()
	if !s.voiceAssets.runJob(jobID) {
		return
	}
	result, err := s.executeCapturedCloudVoiceWorkflow(ctx, effective)
	if err != nil {
		if errors.Is(err, context.DeadlineExceeded) {
			s.voiceAssets.timeoutJob(jobID, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, stableScenarioJobReasonDetail(runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT), voiceWorkflowFailureMetadata(err, runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT, nil))
			return
		}
		if errors.Is(err, context.Canceled) {
			// Explicit cancellation already committed the public terminal state.
			return
		}
		reasonCode := reasonCodeFromMediaError(err)
		if reasonCode == runtimev1.ReasonCode_REASON_CODE_UNSPECIFIED {
			reasonCode = runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		}
		s.voiceAssets.failJob(jobID, reasonCode, sanitizeScenarioJobReasonDetail(err, reasonCode), voiceWorkflowFailureMetadata(err, reasonCode, nil))
		return
	}
	resolution := effective.resolution
	if result.Metadata == nil {
		result.Metadata = map[string]any{}
	}
	result.Metadata["voice_asset_id"] = voiceAssetID
	result.Metadata["workflow_model_id"] = resolution.WorkflowModelID
	result.Metadata["creation_source"] = resolution.WorkflowType
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
	// Provider polling identities remain private to Remote Host. The public
	// workflow state machine is keyed only by the Runtime voice job id.
	s.voiceAssets.completeJob(jobID, result.ProviderVoiceRef, result.Metadata, result.Usage)
}

// buildVoiceWorkflowPayload builds a provider-agnostic payload from the scenario request.
func buildVoiceWorkflowPayload(
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
	extPayload map[string]any,
) map[string]any {
	payload := map[string]any{
		"workflow_model_id": strings.TrimSpace(resolution.WorkflowModelID),
		"creation_source":   strings.TrimSpace(resolution.WorkflowType),
	}
	if len(extPayload) > 0 {
		payload["extensions"] = extPayload
	}
	creation := req.GetSpec().GetVoiceCreate()
	if creation == nil {
		return payload
	}
	payload["target_model_id"] = normalizeVoiceWorkflowTargetModelID(creation.GetTargetModelId(), resolution)
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		inputPayload := map[string]any{
			"reference_audio_uri":  strings.TrimSpace(input.GetReferenceAudioUri()),
			"reference_audio_mime": strings.TrimSpace(input.GetReferenceAudioMime()),
			"language_hints":       append([]string(nil), input.GetLanguageHints()...),
			"preferred_name":       resolveVoiceWorkflowPreferredName(req),
			"text":                 strings.TrimSpace(input.GetText()),
		}
		if len(input.GetReferenceAudioBytes()) > 0 {
			inputPayload["reference_audio_base64"] = base64.StdEncoding.EncodeToString(input.GetReferenceAudioBytes())
		}
		payload["input"] = inputPayload
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		preferredName := strings.TrimSpace(input.GetPreferredName())
		if preferredName == "" {
			preferredName = resolveVoiceWorkflowPreferredName(req)
		}
		payload["input"] = map[string]any{
			"instruction_text": strings.TrimSpace(input.GetInstructionText()),
			"preview_text":     strings.TrimSpace(input.GetPreviewText()),
			"language":         strings.TrimSpace(input.GetLanguage()),
			"preferred_name":   preferredName,
		}
	}
	return payload
}

func normalizeVoiceWorkflowTargetModelID(targetModelID string, resolution catalog.ResolveVoiceWorkflowResult) string {
	value := strings.TrimSpace(targetModelID)
	if value == "" {
		value = strings.TrimSpace(resolution.ModelID)
	}
	if value == "" {
		return ""
	}
	apiModelID := strings.TrimSpace(resolution.APIModelID)
	catalogModelID := strings.TrimSpace(resolution.ModelID)
	if apiModelID != "" && catalogModelID != "" && value == catalogModelID {
		return apiModelID
	}
	return value
}

func validateVoiceWorkflowRequestAgainstMetadata(
	req *runtimev1.SubmitScenarioJobRequest,
	resolution catalog.ResolveVoiceWorkflowResult,
) error {
	options := resolution.RequestOptions
	if options == nil {
		return nil
	}
	creation := req.GetSpec().GetVoiceCreate()
	if creation == nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		if input == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if len(input.GetReferenceAudioBytes()) > 0 {
			if options.ReferenceAudioBytesInput == nil || !*options.ReferenceAudioBytesInput {
				return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
			}
			if err := validateVoiceWorkflowReferenceAudioMIME(input.GetReferenceAudioMime(), options.AllowedReferenceAudioMimeTypes); err != nil {
				return err
			}
		}
		if strings.TrimSpace(input.GetReferenceAudioUri()) != "" && (options.ReferenceAudioURIInput == nil || !*options.ReferenceAudioURIInput) {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
		}
		if voiceWorkflowFieldModeRequired(options.TextPromptMode) && strings.TrimSpace(input.GetText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		if input == nil {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if voiceWorkflowFieldModeRequired(options.InstructionTextMode) && strings.TrimSpace(input.GetInstructionText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		if voiceWorkflowFieldModeRequired(options.PreviewTextMode) && strings.TrimSpace(input.GetPreviewText()) == "" {
			return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
	}
	return nil
}

func validateVoiceWorkflowReferenceAudioMIME(mimeType string, allowed []string) error {
	normalized := strings.ToLower(strings.TrimSpace(mimeType))
	if normalized == "" || len(allowed) == 0 {
		return nil
	}
	for _, item := range allowed {
		if normalized == strings.ToLower(strings.TrimSpace(item)) {
			return nil
		}
	}
	return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
}

func voiceWorkflowFieldModeRequired(mode string) bool {
	return strings.EqualFold(strings.TrimSpace(mode), "required")
}

func estimateVoiceWorkflowUsage(req *runtimev1.SubmitScenarioJobRequest) *runtimev1.UsageStats {
	if req == nil || req.GetSpec() == nil {
		return nil
	}
	inputTokens := int64(0)
	creation := req.GetSpec().GetVoiceCreate()
	if creation == nil {
		return nil
	}
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		if source.ReferenceAudio != nil {
			input := source.ReferenceAudio
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetReferenceAudioUri()))
			inputTokens += int64(len(input.GetReferenceAudioBytes()) / 256)
			inputTokens += nimillm.EstimateTokens(strings.TrimSpace(input.GetText()))
			for _, hint := range input.GetLanguageHints() {
				inputTokens += nimillm.EstimateTokens(strings.TrimSpace(hint))
			}
		}
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		if source.TextDescription != nil {
			input := source.TextDescription
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
	creation := req.GetSpec().GetVoiceCreate()
	if creation == nil {
		return ""
	}
	switch source := creation.GetSource().(type) {
	case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
		input := source.ReferenceAudio
		if input == nil {
			return ""
		}
		return strings.Join([]string{
			strings.TrimSpace(creation.GetTargetModelId()),
			strings.TrimSpace(input.GetReferenceAudioUri()),
			fmt.Sprintf("%d", len(input.GetReferenceAudioBytes())),
			strings.TrimSpace(input.GetText()),
			strings.Join(input.GetLanguageHints(), ","),
			strings.TrimSpace(input.GetPreferredName()),
		}, "|")
	case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
		input := source.TextDescription
		if input == nil {
			return ""
		}
		return strings.Join([]string{
			strings.TrimSpace(creation.GetTargetModelId()),
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
	creation := req.GetSpec().GetVoiceCreate()
	if creation != nil {
		switch source := creation.GetSource().(type) {
		case *runtimev1.VoiceCreateScenarioSpec_ReferenceAudio:
			if source.ReferenceAudio != nil {
				if name := strings.TrimSpace(source.ReferenceAudio.GetPreferredName()); name != "" {
					return name
				}
			}
		case *runtimev1.VoiceCreateScenarioSpec_TextDescription:
			if source.TextDescription != nil {
				if name := strings.TrimSpace(source.TextDescription.GetPreferredName()); name != "" {
					return name
				}
			}
		}
	}
	return "nimi-voice-" + strings.ToLower(ulid.Make().String())
}
