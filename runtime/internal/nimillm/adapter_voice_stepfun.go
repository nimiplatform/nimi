package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

func executeStepFunVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	if strings.ToLower(strings.TrimSpace(req.WorkflowType)) != "tts_v2v" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	baseURL := resolveVoiceWorkflowBaseURL("stepfun", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	modelID := strings.TrimSpace(StripProviderModelPrefix(FirstNonEmpty(
		ValueAsString(req.Payload["target_model_id"]),
		ValueAsString(req.Payload["model"]),
		req.ModelID,
	), "stepfun"))
	if modelID == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_TARGET_MODEL_MISMATCH)
	}
	text := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["text"]),
		ValueAsString(MapField(req.Payload["input"], "text")),
	))
	if text == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	audioBytes, audioMIME, err := resolveStepFunReferenceAudio(ctx, req.Payload)
	if err != nil {
		return VoiceWorkflowResult{}, err
	}

	fileID, err := uploadStepFunVoiceReferenceAudio(ctx, baseURL, strings.TrimSpace(cfg.APIKey), audioBytes, audioMIME)
	if err != nil {
		return VoiceWorkflowResult{}, err
	}

	createPayload := map[string]any{
		"model":   modelID,
		"text":    text,
		"file_id": fileID,
	}
	if sampleText := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["sample_text"]),
		ValueAsString(MapField(req.Payload["input"], "sample_text")),
	)); sampleText != "" {
		createPayload["sample_text"] = sampleText
	}

	response := map[string]any{}
	if err := DoJSONRequest(ctx, http.MethodPost, JoinURL(baseURL, "/audio/voices"), cfg.APIKey, createPayload, &response); err != nil {
		return VoiceWorkflowResult{}, err
	}
	providerVoiceRef := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(response["id"]),
		ValueAsString(response["voice_id"]),
		ValueAsString(MapField(response["data"], "id")),
		ValueAsString(MapField(response["result"], "id")),
	))
	if providerVoiceRef == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	return VoiceWorkflowResult{
		ProviderVoiceRef: providerVoiceRef,
		Metadata: map[string]any{
			"provider":          "stepfun",
			"workflow_type":     strings.TrimSpace(req.WorkflowType),
			"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
			"adapter":           "nimillm_voice_adapter_stepfun",
			"endpoint":          "/audio/voices",
			"file_id":           fileID,
			"model":             modelID,
		},
	}, nil
}

func resolveStepFunReferenceAudio(ctx context.Context, payload map[string]any) ([]byte, string, error) {
	base64Audio := FirstNonEmpty(
		ValueAsString(payload["reference_audio_base64"]),
		ValueAsString(MapField(payload["input"], "reference_audio_base64")),
	)
	if strings.TrimSpace(base64Audio) != "" {
		audioBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(base64Audio))
		if err != nil || len(audioBytes) == 0 {
			return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		audioMIME := FirstNonEmpty(
			ValueAsString(payload["reference_audio_mime"]),
			ValueAsString(MapField(payload["input"], "reference_audio_mime")),
			"audio/wav",
		)
		return audioBytes, audioMIME, nil
	}

	audioURI := FirstNonEmpty(
		ValueAsString(payload["reference_audio_uri"]),
		ValueAsString(payload["audio_url"]),
		ValueAsString(MapField(payload["input"], "reference_audio_uri")),
	)
	if strings.TrimSpace(audioURI) == "" {
		return nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}

	audioBytes, detectedMIME, err := FetchAudioFromURI(ctx, audioURI)
	if err != nil {
		return nil, "", err
	}
	audioMIME := FirstNonEmpty(
		ValueAsString(payload["reference_audio_mime"]),
		ValueAsString(MapField(payload["input"], "reference_audio_mime")),
		detectedMIME,
		"audio/wav",
	)
	return audioBytes, audioMIME, nil
}

func uploadStepFunVoiceReferenceAudio(ctx context.Context, baseURL string, apiKey string, audioBytes []byte, audioMIME string) (string, error) {
	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("purpose", "storage"); err != nil {
		return "", MapProviderRequestError(err)
	}
	fileWriter, err := writer.CreateFormFile("file", stepFunReferenceAudioFilename(audioMIME))
	if err != nil {
		return "", MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audioBytes); err != nil {
		return "", MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return "", MapProviderRequestError(err)
	}

	response := map[string]any{}
	if err := doStepFunMultipartJSONRequest(ctx, JoinURL(baseURL, "/files"), apiKey, body.Bytes(), writer.FormDataContentType(), &response); err != nil {
		return "", err
	}
	fileID := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(response["id"]),
		ValueAsString(MapField(response["data"], "id")),
		ValueAsString(MapField(response["result"], "id")),
	))
	if fileID == "" {
		return "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return fileID, nil
}

func stepFunReferenceAudioFilename(audioMIME string) string {
	switch strings.ToLower(strings.TrimSpace(audioMIME)) {
	case "audio/mpeg", "audio/mp3":
		return "reference.mp3"
	default:
		return "reference.wav"
	}
}

func doStepFunMultipartJSONRequest(
	ctx context.Context,
	targetURL string,
	apiKey string,
	body []byte,
	contentType string,
	target *map[string]any,
) error {
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", contentType)
	if strings.TrimSpace(apiKey) != "" {
		request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}

	response, err := client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}
