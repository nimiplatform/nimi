package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	catalog "github.com/nimiplatform/nimi/runtime/internal/aicatalog"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/providerregistry"
)

func executeProviderRawReplay(timeout time.Duration, fixture *aiGoldFixture) (*aiReplayPayload, error) {
	payload := &aiReplayPayload{
		FixtureID:           fixture.FixtureID,
		Capability:          fixture.Capability,
		Layer:               "L0_PROVIDER_RAW",
		RequestDigest:       fixture.requestDigest(),
		ResolvedProvider:    strings.TrimSpace(fixture.Provider),
		ResolvedModel:       strings.TrimSpace(fixture.ModelID),
		ResolvedTargetModel: strings.TrimSpace(fixture.TargetModelID),
		RoutePolicy:         "token-api",
		FallbackPolicy:      "deny",
		TraceID:             "provider-raw-" + fixture.requestDigest()[:12],
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	record, ok := providerregistry.Lookup(strings.TrimSpace(fixture.Provider))
	if !ok {
		return nil, fmt.Errorf("unknown provider %q", fixture.Provider)
	}
	baseURL := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + providerEnvToken(record.ID) + "_BASE_URL"))
	if baseURL == "" {
		baseURL = strings.TrimSpace(record.DefaultEndpoint)
	}
	apiKey := strings.TrimSpace(os.Getenv("NIMI_LIVE_" + providerEnvToken(record.ID) + "_API_KEY"))
	if apiKey == "" {
		return nil, fmt.Errorf("missing NIMI_LIVE_%s_API_KEY", providerEnvToken(record.ID))
	}
	backend := nimillm.NewBackend("gold-"+record.ID, baseURL, apiKey, timeout)
	if backend == nil {
		return nil, fmt.Errorf("provider backend unavailable for %s", record.ID)
	}
	configValue := nimillm.MediaAdapterConfig{BaseURL: baseURL, APIKey: apiKey}
	switch strings.TrimSpace(strings.ToLower(fixture.Capability)) {
	case "text.generate":
		text, usage, finishReason, err := backend.GenerateText(ctx, strings.TrimSpace(fixture.ModelID), []*runtimev1.ChatMessage{{
			Role:    "user",
			Content: strings.TrimSpace(fixture.Request.Prompt),
		}}, strings.TrimSpace(fixture.Request.SystemPrompt), 0, 0, 0)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.ArtifactSummary = map[string]any{
			"textLength":    len(strings.TrimSpace(text)),
			"finishReason":  finishReason.String(),
			"inputTokens":   safeUsageInputTokens(usage),
			"outputTokens":  safeUsageOutputTokens(usage),
			"computeMs":     safeUsageComputeMs(usage),
			"textPreview":   trimPreview(text),
			"artifactCount": 0,
		}
	case "text.embed":
		vectors, usage, err := backend.Embed(ctx, strings.TrimSpace(fixture.ModelID), fixture.Request.Inputs)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.ArtifactSummary = map[string]any{
			"vectorCount":  len(vectors),
			"inputTokens":  safeUsageInputTokens(usage),
			"outputTokens": safeUsageOutputTokens(usage),
			"computeMs":    safeUsageComputeMs(usage),
		}
	case "image.generate", "audio.synthesize":
		req, err := fixture.buildSubmitScenarioJobRequest(aiReplayAppID, "")
		if err != nil {
			return nil, err
		}
		artifacts, usage, providerJobID, err := nimillm.ExecuteAlibabaNative(ctx, configValue, noopGoldJobUpdater{}, "gold-provider-raw", req, strings.TrimSpace(fixture.ModelID))
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(providerJobID)
		payload.ArtifactSummary = summarizeScenarioArtifacts(artifacts)
		payload.ArtifactSummary["inputTokens"] = safeUsageInputTokens(usage)
		payload.ArtifactSummary["outputTokens"] = safeUsageOutputTokens(usage)
		payload.ArtifactSummary["computeMs"] = safeUsageComputeMs(usage)
	case "audio.transcribe":
		req, err := fixture.buildSubmitScenarioJobRequest(aiReplayAppID, "")
		if err != nil {
			return nil, err
		}
		artifacts, usage, providerJobID, err := nimillm.ExecuteDashScopeTranscribe(ctx, configValue, req, strings.TrimSpace(fixture.ModelID))
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(providerJobID)
		payload.ArtifactSummary = summarizeScenarioArtifacts(artifacts)
		payload.ArtifactSummary["inputTokens"] = safeUsageInputTokens(usage)
		payload.ArtifactSummary["outputTokens"] = safeUsageOutputTokens(usage)
		payload.ArtifactSummary["computeMs"] = safeUsageComputeMs(usage)
	case "voice.clone", "voice.design":
		workflowType := "tts_v2v"
		providerPayload := map[string]any{}
		if strings.EqualFold(strings.TrimSpace(fixture.Capability), "voice.design") {
			workflowType = "tts_t2v"
			providerPayload["text"] = strings.TrimSpace(fixture.Request.InstructionText)
			providerPayload["instruction_text"] = strings.TrimSpace(fixture.Request.InstructionText)
		} else {
			audioURI, audioBytes, audioMime, audioErr := fixture.resolveAudioInput()
			if audioErr != nil {
				return withReplayFailure(payload, audioErr), nil
			}
			if strings.TrimSpace(audioURI) != "" {
				providerPayload["reference_audio_uri"] = strings.TrimSpace(audioURI)
			}
			if len(audioBytes) > 0 {
				providerPayload["reference_audio_base64"] = base64.StdEncoding.EncodeToString(audioBytes)
				providerPayload["reference_audio_mime"] = strings.TrimSpace(audioMime)
			}
		}
		workflowModelID, targetModelID, resolveErr := resolveProviderRawVoiceWorkflow(fixture, workflowType)
		if resolveErr != nil {
			return withReplayFailure(payload, resolveErr), nil
		}
		result, err := nimillm.ExecuteVoiceWorkflow(ctx, nimillm.VoiceWorkflowRequest{
			Provider:        strings.TrimSpace(fixture.Provider),
			WorkflowType:    workflowType,
			WorkflowModelID: workflowModelID,
			ModelID:         targetModelID,
			Payload:         providerPayload,
			ExtPayload:      map[string]any{},
		}, configValue)
		if err != nil {
			return withReplayFailure(payload, err), nil
		}
		payload.Status = "passed"
		payload.JobID = strings.TrimSpace(result.ProviderJobID)
		payload.ArtifactSummary = map[string]any{
			"voiceAssetId":     strings.TrimSpace(result.ProviderVoiceRef),
			"providerMetadata": result.Metadata,
			"artifactCount":    0,
			"providerJobID":    strings.TrimSpace(result.ProviderJobID),
			"providerVoiceRef": strings.TrimSpace(result.ProviderVoiceRef),
		}
	case "video.generate":
		payload.Status = "skipped"
		payload.ReasonCode = "L0_MODALITY_NOT_SUPPORTED"
		payload.ActionHint = "video_generate_not_supported_in_gold_path_l0"
		return payload, nil
	default:
		return nil, fmt.Errorf("unsupported capability %q", fixture.Capability)
	}
	return payload, nil
}

func providerEnvToken(providerID string) string {
	token := strings.TrimSpace(strings.ToUpper(providerID))
	token = strings.ReplaceAll(token, "-", "_")
	token = strings.ReplaceAll(token, ".", "_")
	token = strings.ReplaceAll(token, " ", "_")
	for strings.Contains(token, "__") {
		token = strings.ReplaceAll(token, "__", "_")
	}
	return strings.Trim(token, "_")
}

func resolveProviderRawVoiceWorkflow(fixture *aiGoldFixture, workflowType string) (string, string, error) {
	if fixture == nil {
		return "", "", fmt.Errorf("fixture is required")
	}
	targetModelID := strings.TrimSpace(fixture.TargetModelID)
	if targetModelID == "" {
		targetModelID = strings.TrimSpace(fixture.ModelID)
	}
	resolver, err := catalog.NewResolver(catalog.ResolverConfig{})
	if err != nil {
		return "", "", fmt.Errorf("load voice workflow catalog: %w", err)
	}
	resolution, err := resolver.ResolveVoiceWorkflow(strings.TrimSpace(fixture.Provider), strings.TrimSpace(fixture.ModelID), workflowType)
	if err != nil {
		if err == catalog.ErrModelNotFound {
			return "", "", fmt.Errorf("%s", runtimev1.ReasonCode_AI_MODEL_NOT_FOUND.String())
		}
		if err == catalog.ErrVoiceWorkflowUnsupported {
			return "", "", fmt.Errorf("%s", runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED.String())
		}
		return "", "", fmt.Errorf("resolve voice workflow: %w", err)
	}
	return strings.TrimSpace(resolution.WorkflowModelID), targetModelID, nil
}
