package nimillm

import (
	"context"
	"encoding/base64"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func executeMimoVoiceWorkflow(ctx context.Context, req VoiceWorkflowRequest, cfg MediaAdapterConfig) (VoiceWorkflowResult, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	workflow := strings.ToLower(strings.TrimSpace(req.WorkflowType))
	switch workflow {
	case "voice_clone":
		dataURI, err := resolveMimoWorkflowReferenceAudioDataURI(ctx, req.Payload)
		if err != nil {
			return VoiceWorkflowResult{}, err
		}
		return VoiceWorkflowResult{
			ProviderVoiceRef: encodeMimoProviderVoiceRef("voice_clone", dataURI),
			Metadata: map[string]any{
				"provider":          "mimo",
				"workflow_type":     "voice_clone",
				"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
				"adapter":           "nimillm_voice_adapter_mimo",
				"persistence":       "session_ephemeral",
			},
		}, nil
	case "voice_design":
		prompt := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(req.Payload["instruction_text"]),
			ValueAsString(req.Payload["description"]),
			ValueAsString(MapField(req.Payload["input"], "instruction_text")),
			ValueAsString(MapField(req.Payload["input"], "description")),
		))
		if prompt == "" {
			return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		return VoiceWorkflowResult{
			ProviderVoiceRef: encodeMimoProviderVoiceRef("voice_design", prompt),
			Metadata: map[string]any{
				"provider":          "mimo",
				"workflow_type":     "voice_design",
				"workflow_model_id": strings.TrimSpace(req.WorkflowModelID),
				"adapter":           "nimillm_voice_adapter_mimo",
				"persistence":       "session_ephemeral",
			},
		}, nil
	default:
		return VoiceWorkflowResult{}, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_WORKFLOW_UNSUPPORTED)
	}
}

func resolveMimoWorkflowReferenceAudioDataURI(ctx context.Context, payload map[string]any) (string, error) {
	base64Audio := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["reference_audio_base64"]),
		ValueAsString(MapField(payload["input"], "reference_audio_base64")),
	))
	if base64Audio != "" {
		audioMIME := strings.TrimSpace(FirstNonEmpty(
			ValueAsString(payload["reference_audio_mime"]),
			ValueAsString(MapField(payload["input"], "reference_audio_mime")),
			"audio/wav",
		))
		if err := validateMimoVoiceReferenceMIME(audioMIME); err != nil {
			return "", err
		}
		if decoded, err := base64.StdEncoding.DecodeString(base64Audio); err != nil || len(decoded) == 0 {
			return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
		}
		return "data:" + audioMIME + ";base64," + base64Audio, nil
	}

	audioURI := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["reference_audio_uri"]),
		ValueAsString(payload["audio_url"]),
		ValueAsString(MapField(payload["input"], "reference_audio_uri")),
		ValueAsString(MapField(payload["input"], "audio_url")),
	))
	if audioURI == "" {
		return "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_VOICE_INPUT_INVALID)
	}
	audioBytes, detectedMIME, err := FetchAudioFromURI(ctx, audioURI)
	if err != nil {
		return "", err
	}
	audioMIME := strings.TrimSpace(FirstNonEmpty(
		ValueAsString(payload["reference_audio_mime"]),
		ValueAsString(MapField(payload["input"], "reference_audio_mime")),
		detectedMIME,
		"audio/wav",
	))
	if err := validateMimoVoiceReferenceMIME(audioMIME); err != nil {
		return "", err
	}
	return "data:" + audioMIME + ";base64," + base64.StdEncoding.EncodeToString(audioBytes), nil
}

func validateMimoVoiceReferenceMIME(mimeType string) error {
	normalized := strings.ToLower(strings.TrimSpace(mimeType))
	switch normalized {
	case "audio/wav", "audio/x-wav", "audio/wave", "audio/mpeg", "audio/mp3":
		return nil
	default:
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
	}
}
