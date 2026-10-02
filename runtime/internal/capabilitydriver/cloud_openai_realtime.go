package capabilitydriver

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r113
// @nimi-authority: rule.nimi.runtime.ai-provider.r114
// OpenAI GA Realtime has its own wire dialect. Neither the beta protocol nor
// the ordinary speech endpoint is an alternative execution path.
type openAIRealtimeDriver struct{}

func (openAIRealtimeDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudRealtimeTarget, error) {
	invalid := func() (CloudRealtimeTarget, error) {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("OpenAI Realtime target is not admitted"))
	}
	if identity.ImplementationID != "cloud.realtime.interact.openai" || identity.DriverID != "nimi.runtime.driver.openai" || identity.DriverDialect != "openai/realtime/v1" || raw == nil {
		return invalid()
	}
	for key := range raw.GetFields() {
		if key != "provider" && key != "providerModelId" && key != "remoteModelCatalogId" {
			return invalid()
		}
	}
	provider, providerOK := exactCloudTargetText(raw, "provider")
	model, modelOK := exactCloudTargetText(raw, "providerModelId")
	catalogID, catalogOK := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !providerOK || provider != "openai" || !modelOK || model != "gpt-realtime-2.1" || !catalogOK {
		return invalid()
	}
	return CloudRealtimeTarget{provider: provider, providerModelID: model, remoteModelCatalogID: catalogID}, nil
}

func (openAIRealtimeDriver) Endpoint(CloudRealtimeTarget) string {
	return "wss://api.openai.com/v1/realtime"
}

func (openAIRealtimeDriver) MapOpen(eventID string, target CloudRealtimeTarget, input CloudRealtimeOpen) ([]byte, error) {
	if target.provider != "openai" || target.providerModelID != "gpt-realtime-2.1" || input.InputAudio == nil ||
		input.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE ||
		input.InputAudio.GetSampleRateHz() != 24000 || input.InputAudio.GetChannelCount() != 1 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: 24000}
	}
	var turnDetection any
	switch input.TurnDetection {
	case runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL:
	case runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD:
		// Turn signals never autonomously respond or interrupt owner work.
		turnDetection = map[string]any{"type": "server_vad", "create_response": false, "interrupt_response": false}
	default:
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("OpenAI Realtime turn detection mode is unsupported"))
	}
	modalities := []string{"text"}
	if input.AudioOutput {
		modalities = []string{"audio"}
	}
	session := map[string]any{
		"type": "realtime", "model": target.providerModelID, "output_modalities": modalities,
		"tools": []any{}, "truncation": "disabled",
		"audio": map[string]any{
			"input": map[string]any{
				"format":         map[string]any{"type": "audio/pcm", "rate": 24000},
				"turn_detection": turnDetection, "transcription": map[string]any{"model": "gpt-transcribe"},
			},
			"output": map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "voice": "marin"},
		},
	}
	if input.InitialInstruction != "" {
		session["instructions"] = input.InitialInstruction
	}
	return json.Marshal(map[string]any{"event_id": eventID, "type": "session.update", "session": session})
}

func (openAIRealtimeDriver) MapInput(eventID string, req *runtimev1.AppendRealtimeInputRequest) ([]byte, error) {
	if req == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime input is required"))
	}
	switch input := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		if input.AudioFrame != nil && len(input.AudioFrame.GetFrame()) > 0 && len(input.AudioFrame.GetFrame())%2 == 0 {
			return json.Marshal(map[string]any{"event_id": eventID, "type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(input.AudioFrame.GetFrame())})
		}
	case *runtimev1.AppendRealtimeInputRequest_Text:
		if input.Text != nil && strings.TrimSpace(input.Text.GetText()) != "" {
			return cloudRealtimeConversationText(eventID, "user", input.Text.GetText())
		}
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		if input.OwnerContext != nil && strings.TrimSpace(input.OwnerContext.GetText()) != "" && input.OwnerContext.GetKind() != runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_UNSPECIFIED {
			return cloudRealtimeConversationText(eventID, "system", input.OwnerContext.GetText())
		}
	}
	return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime input variant is invalid"))
}

func (openAIRealtimeDriver) MapOwnerControl(eventID string, req *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error) {
	if req == nil {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime owner control is required"))
	}
	var eventType string
	switch req.GetControl() {
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT:
		eventType = "input_audio_buffer.commit"
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE:
		eventType = "response.create"
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_PAUSE_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE:
		eventType = "response.cancel"
	default:
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime owner control is unsupported"))
	}
	return json.Marshal(map[string]any{"event_id": eventID, "type": eventType})
}

func (openAIRealtimeDriver) MapInterrupt(eventID string, responseID string) ([]byte, error) {
	if strings.TrimSpace(responseID) == "" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime output track is required"))
	}
	return json.Marshal(map[string]any{"event_id": eventID, "type": "response.cancel", "response_id": responseID})
}

func (openAIRealtimeDriver) NormalizeEvent(raw []byte, expected CloudRealtimeOpen) ([]CloudRealtimeEvent, error) {
	var event cloudRealtimeServerEvent
	invalid := func() ([]CloudRealtimeEvent, error) {
		return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("OpenAI Realtime event is invalid"))
	}
	if len(raw) == 0 || json.Unmarshal(raw, &event) != nil || event.Type == "" {
		return invalid()
	}
	out := CloudRealtimeEvent{ProviderResponseID: firstExact(event.ResponseID, event.Response.ID), ProviderItemID: event.ItemID}
	switch event.Type {
	case "session.created":
		return nil, nil
	case "session.updated":
		if !validOpenAIRealtimeReady(raw, expected) {
			return invalid()
		}
		out.Kind = CloudRealtimeEventReady
	case "input_audio_buffer.committed":
		out.Kind = CloudRealtimeEventInputCommitted
	case "input_audio_buffer.speech_started":
		out.Kind = CloudRealtimeEventSpeechStarted
	case "input_audio_buffer.speech_stopped":
		out.Kind = CloudRealtimeEventSpeechStopped
	case "conversation.item.input_audio_transcription.delta":
		out.Kind, out.Text, out.TranscriptTextDelta = CloudRealtimeEventTranscriptPartial, event.Delta, true
	case "conversation.item.input_audio_transcription.completed":
		out.Kind, out.Text = CloudRealtimeEventTranscriptFinal, event.Transcript
	case "conversation.item.input_audio_transcription.failed":
		out.Kind, out.ErrorCode = CloudRealtimeEventInputTranscriptionFailed, event.Error.Code
	case "response.created":
		out.Kind = CloudRealtimeEventOutputStarted
	case "response.output_text.delta", "response.output_audio_transcript.delta":
		out.Kind, out.Text = CloudRealtimeEventTextDelta, event.Delta
	case "response.output_text.done":
		out.Kind, out.Text = CloudRealtimeEventTextFinal, event.Text
	case "response.output_audio_transcript.done":
		out.Kind, out.Text = CloudRealtimeEventTextFinal, event.Transcript
	case "response.output_audio.delta":
		audio, err := base64.StdEncoding.DecodeString(event.Delta)
		if err != nil || len(audio) == 0 || len(audio)%2 != 0 {
			return invalid()
		}
		out.Kind, out.Audio = CloudRealtimeEventAudioDelta, audio
	case "response.output_audio.done":
		out.Kind = CloudRealtimeEventAudioDone
	case "response.done":
		out.Kind = CloudRealtimeEventResponseDone
		switch event.Response.Status {
		case "completed":
			out.ResponseStatus = CloudRealtimeResponseStatusCompleted
		case "cancelled":
			out.ResponseStatus = CloudRealtimeResponseStatusCancelled
		case "failed", "incomplete":
			out.ResponseStatus = CloudRealtimeResponseStatusFailed
		default:
			return invalid()
		}
		if event.Response.Usage != nil {
			if event.Response.Usage.InputTokens == nil || event.Response.Usage.OutputTokens == nil || *event.Response.Usage.InputTokens < 0 || *event.Response.Usage.OutputTokens < 0 {
				return invalid()
			}
			out.Usage = &runtimev1.UsageStats{InputTokens: *event.Response.Usage.InputTokens, OutputTokens: *event.Response.Usage.OutputTokens}
		}
	case "error":
		out.Kind, out.ErrorCode = CloudRealtimeEventFailed, event.Error.Code
	default:
		return nil, nil
	}
	if out.Kind >= CloudRealtimeEventOutputStarted && out.Kind <= CloudRealtimeEventResponseDone && out.ProviderResponseID == "" {
		return invalid()
	}
	if out.Kind >= CloudRealtimeEventSpeechStarted && out.Kind <= CloudRealtimeEventInputTranscriptionFailed && out.ProviderItemID == "" {
		return invalid()
	}
	return []CloudRealtimeEvent{out}, nil
}

func (openAIRealtimeDriver) NormalizeReason(err error) error { return err }

func validOpenAIRealtimeReady(raw []byte, expected CloudRealtimeOpen) bool {
	var event struct {
		Session struct {
			Type             string          `json:"type"`
			Model            string          `json:"model"`
			Truncation       string          `json:"truncation"`
			OutputModalities []string        `json:"output_modalities"`
			Tools            json.RawMessage `json:"tools"`
			Audio            struct {
				Input struct {
					Format struct {
						Type string `json:"type"`
						Rate uint32 `json:"rate"`
					} `json:"format"`
					TurnDetection json.RawMessage `json:"turn_detection"`
				} `json:"input"`
				Output struct {
					Format struct {
						Type string `json:"type"`
						Rate uint32 `json:"rate"`
					} `json:"format"`
				} `json:"output"`
			} `json:"audio"`
		} `json:"session"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return false
	}
	s := event.Session
	if s.Type != "realtime" || s.Model != "gpt-realtime-2.1" || s.Truncation != "disabled" || len(s.OutputModalities) != 1 ||
		(s.OutputModalities[0] != "text" && s.OutputModalities[0] != "audio") ||
		s.Audio.Input.Format.Type != "audio/pcm" || s.Audio.Input.Format.Rate != 24000 ||
		s.Audio.Output.Format.Type != "audio/pcm" || s.Audio.Output.Format.Rate != 24000 {
		return false
	}
	var tools []json.RawMessage
	if len(s.Tools) == 0 || json.Unmarshal(s.Tools, &tools) != nil || tools == nil || len(tools) != 0 {
		return false
	}
	if expected.InputAudio == nil || expected.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || expected.InputAudio.GetSampleRateHz() != 24000 || expected.InputAudio.GetChannelCount() != 1 {
		return false
	}
	modality := "text"
	if expected.AudioOutput {
		modality = "audio"
	}
	if s.OutputModalities[0] != modality {
		return false
	}
	if string(s.Audio.Input.TurnDetection) == "null" {
		return expected.TurnDetection == runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL
	}
	if expected.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD {
		return false
	}
	var vad struct {
		Type              string `json:"type"`
		CreateResponse    *bool  `json:"create_response"`
		InterruptResponse *bool  `json:"interrupt_response"`
	}
	return json.Unmarshal(s.Audio.Input.TurnDetection, &vad) == nil && vad.Type == "server_vad" &&
		vad.CreateResponse != nil && !*vad.CreateResponse && vad.InterruptResponse != nil && !*vad.InterruptResponse
}
