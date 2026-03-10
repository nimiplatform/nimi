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
	"google.golang.org/grpc/status"
)

func executeFishAudioVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	if strings.ToLower(strings.TrimSpace(req.WorkflowType)) != "tts_v2v" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}

	baseURL := resolveVoiceWorkflowBaseURL("fish_audio", cfg, req.ExtPayload)
	if baseURL == "" {
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	audioBytes, audioMIME, err := resolveFishAudioReferenceAudio(ctx, req.Payload)
	if err != nil {
		return VoiceWorkflowResult{}, err
	}
	title := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["name"]),
		ValueAsString(req.Payload["voice_name"]),
		ValueAsString(req.Payload["preferred_name"]),
		ValueAsString(MapField(req.Payload["input"], "preferred_name")),
		"nimi_voice",
	))
	visibility := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["visibility"]),
		ValueAsString(MapField(req.Payload["input"], "visibility")),
	))
	trainMode := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(req.Payload["train_mode"]),
		ValueAsString(MapField(req.Payload["input"], "train_mode")),
	))

	body := &bytes.Buffer{}
	writer := multipart.NewWriter(body)
	if err := writer.WriteField("title", title); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if visibility != "" {
		if err := writer.WriteField("visibility", visibility); err != nil {
			return VoiceWorkflowResult{}, MapProviderRequestError(err)
		}
	}
	if trainMode != "" {
		if err := writer.WriteField("train_mode", trainMode); err != nil {
			return VoiceWorkflowResult{}, MapProviderRequestError(err)
		}
	}
	fileWriter, err := writer.CreateFormFile("voices", fishAudioReferenceAudioFilename(audioMIME))
	if err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if _, err := fileWriter.Write(audioBytes); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}
	if err := writer.Close(); err != nil {
		return VoiceWorkflowResult{}, MapProviderRequestError(err)
	}

	paths := resolveVoiceEndpointPaths(req.WorkflowType, req.ExtPayload, []string{"/model"})
	var lastErr error
	for _, path := range paths {
		response := map[string]any{}
		err := doFishAudioMultipartJSONRequest(
			ctx,
			JoinURL(baseURL, path),
			cfg.APIKey,
			body.Bytes(),
			writer.FormDataContentType(),
			&response,
		)
		if err != nil {
			lastErr = err
			if status.Code(err) == codes.NotFound {
				continue
			}
			return VoiceWorkflowResult{}, err
		}
		providerVoiceRef := extractFishAudioModelID(response)
		if providerVoiceRef == "" {
			lastErr = grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
			continue
		}
		return VoiceWorkflowResult{
			ProviderVoiceRef: providerVoiceRef,
			Metadata: map[string]any{
				"provider":          "fish_audio",
				"workflow_type":     strings.TrimSpace(req.WorkflowType),
				"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
				"adapter":           "nimillm_voice_adapter_fish_audio",
				"endpoint":          strings.TrimSpace(path),
				"visibility":        visibility,
				"train_mode":        trainMode,
			},
		}, nil
	}
	if lastErr != nil {
		return VoiceWorkflowResult{}, lastErr
	}
	return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
}

func resolveFishAudioReferenceAudio(ctx context.Context, payload map[string]any) ([]byte, string, error) {
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

func fishAudioReferenceAudioFilename(audioMIME string) string {
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

func extractFishAudioModelID(payload map[string]any) string {
	return strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["_id"]),
		ValueAsString(payload["id"]),
		ValueAsString(MapField(payload["data"], "_id")),
		ValueAsString(MapField(payload["data"], "id")),
		ValueAsString(MapField(payload["result"], "_id")),
		ValueAsString(MapField(payload["result"], "id")),
	))
}

func doFishAudioMultipartJSONRequest(
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
