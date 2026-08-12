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

func executeElevenLabsVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	switch workflow {
	case "reference_audio":
		return executeElevenLabsInstantVoiceClone(ctx, req, cfg)
	case "text_description":
		return executeElevenLabsTwoPhaseDesign(ctx, req, cfg)
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

func executeElevenLabsTwoPhaseDesign(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	headers := voiceWorkflowHeaders("elevenlabs", cfg)
	name := FirstNonEmpty(
		ValueAsString(req.Payload["name"]),
		ValueAsString(req.Payload["voice_name"]),
		ValueAsString(req.Payload["preferred_name"]),
		ValueAsString(MapField(req.Payload["input"], "preferred_name")),
		"nimi_voice",
	)
	description := FirstNonEmpty(
		ValueAsString(req.Payload["instruction_text"]),
		ValueAsString(req.Payload["description"]),
		ValueAsString(MapField(req.Payload["input"], "instruction_text")),
	)
	previewText := FirstNonEmpty(
		ValueAsString(req.Payload["preview_text"]),
		ValueAsString(req.Payload["text"]),
		ValueAsString(MapField(req.Payload["input"], "preview_text")),
		description,
	)

	// Phase 1: Create preview.
	previewPayload := map[string]any{
		"voice_description": strings.TrimSpace(description),
		"text":              strings.TrimSpace(previewText),
	}
	if len(req.ExtPayload) > 0 {
		previewPayload["extensions"] = req.ExtPayload
	}

	const previewPath = "/v1/text-to-voice/design"
	previewResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, previewPath), "", previewPayload, &previewResp, headers); err != nil {
		return VoiceWorkflowResult{}, err
	}

	previewID := extractPreviewIDFromVoiceWorkflowResponse(previewResp)
	if previewID == "" {
		// If the preview response already contains a voice_ref, return it directly.
		if voiceRef := extractVoiceWorkflowVoiceRef(previewResp); voiceRef != "" {
			return VoiceWorkflowResult{
				ProviderJobID:    ExtractTaskIDFromAdapterPayload("voice:elevenlabs", previewResp),
				ProviderVoiceRef: voiceRef,
				Metadata: map[string]any{
					"provider":          "elevenlabs",
					"creation_source":   strings.TrimSpace(req.WorkflowType),
					"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
					"adapter":           "nimillm_voice_adapter_elevenlabs",
					"endpoint":          "/v1/text-to-voice/design",
				},
			}, nil
		}
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}

	// Phase 2: Create voice from preview.
	createPayload := map[string]any{
		"generated_voice_id": previewID,
		"voice_name":         strings.TrimSpace(name),
		"voice_description":  strings.TrimSpace(description),
	}
	if len(req.ExtPayload) > 0 {
		createPayload["extensions"] = req.ExtPayload
	}

	const createPath = "/v1/text-to-voice"
	createResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(ctx, http.MethodPost, JoinURL(baseURL, createPath), "", createPayload, &createResp, headers); err != nil {
		return VoiceWorkflowResult{}, err
	}
	providerVoiceRef := extractVoiceWorkflowVoiceRef(createResp)
	if providerVoiceRef == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return VoiceWorkflowResult{
		ProviderJobID:    ExtractTaskIDFromAdapterPayload("voice:elevenlabs", createResp),
		ProviderVoiceRef: providerVoiceRef,
		Metadata: map[string]any{
			"provider":           "elevenlabs",
			"creation_source":    strings.TrimSpace(req.WorkflowType),
			"workflow_model_id":  strings.TrimSpace(req.WorkflowModelID),
			"adapter":            "nimillm_voice_adapter_elevenlabs",
			"endpoint":           createPath,
			"generated_voice_id": previewID,
		},
	}, nil
}

func executeElevenLabsInstantVoiceClone(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := resolveVoiceWorkflowBaseURL("elevenlabs", cfg)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	audioBytes, audioMIME, err := resolveElevenLabsReferenceAudio(ctx, req.Payload)
	if err != nil {
		return VoiceWorkflowResult{}, err
	}
	name := FirstNonEmpty(
		ValueAsString(req.Payload["name"]),
		ValueAsString(req.Payload["voice_name"]),
		ValueAsString(req.Payload["preferred_name"]),
		ValueAsString(MapField(req.Payload["input"], "preferred_name")),
		"nimi_voice",
	)
	headers := voiceWorkflowHeaders("elevenlabs", cfg)
	const path = "/v1/voices/add"

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("name", strings.TrimSpace(name)); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if err := writer.WriteField("remove_background_noise", "false"); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	fileWriter, err := writer.CreateFormFile("files", elevenLabsReferenceAudioFilename(audioMIME))
	if err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audioBytes); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}

	response := map[string]any{}
	if err := doElevenLabsMultipartJSONRequest(ctx, JoinURL(baseURL, path), body.Bytes(), writer.FormDataContentType(), headers, &response); err != nil {
		return VoiceWorkflowResult{}, err
	}
	providerVoiceRef := extractVoiceWorkflowVoiceRef(response)
	if providerVoiceRef == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return VoiceWorkflowResult{
		ProviderJobID:    ExtractTaskIDFromAdapterPayload("voice:elevenlabs", response),
		ProviderVoiceRef: providerVoiceRef,
		Metadata: map[string]any{
			"provider":          "elevenlabs",
			"creation_source":   strings.TrimSpace(req.WorkflowType),
			"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
			"adapter":           "nimillm_voice_adapter_elevenlabs",
			"endpoint":          path,
		},
	}, nil
}

func resolveElevenLabsReferenceAudio(ctx context.Context, payload map[string]any) ([]byte, string, error) {
	base64Audio := FirstNonEmpty(
		ValueAsString(payload["reference_audio_base64"]),
		ValueAsString(MapField(payload["input"], "reference_audio_base64")),
	)
	if strings.TrimSpace(base64Audio) != "" {
		audioBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(base64Audio))
		if err != nil {
			return nil, "", grpcerr.WrapWithReasonCode(
				codes.InvalidArgument,
				runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID,
				err,
				grpcerr.ReasonOptions{Message: "voice reference audio could not be decoded"},
			)
		}
		if len(audioBytes) == 0 {
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

func elevenLabsReferenceAudioFilename(audioMIME string) string {
	switch strings.ToLower(strings.TrimSpace(audioMIME)) {
	case "audio/mpeg", "audio/mp3":
		return "reference.mp3"
	case "audio/ogg":
		return "reference.ogg"
	case "audio/flac":
		return "reference.flac"
	case "audio/mp4", "audio/m4a":
		return "reference.m4a"
	default:
		return "reference.wav"
	}
}

func doElevenLabsMultipartJSONRequest(
	ctx context.Context,
	targetURL string,
	body []byte,
	contentType string,
	headers map[string]string,
	target *map[string]any,
) error {
	client, request, err := newSecuredHTTPRequest(ctx, http.MethodPost, targetURL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", contentType)
	for key, value := range headers {
		headerName := strings.TrimSpace(key)
		headerValue := strings.TrimSpace(value)
		if headerName == "" || headerValue == "" {
			continue
		}
		request.Header.Set(headerName, headerValue)
	}

	response, err := client.Do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(response.Body).Decode(&payload)
		return MapProviderHTTPError(response.StatusCode, payload)
	}
	if target == nil {
		return nil
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		return providerResponseDecodeError(err)
	}
	return nil
}
