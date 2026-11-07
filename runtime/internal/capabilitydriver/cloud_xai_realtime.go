package capabilitydriver

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

const XAIVoice3Model = "grok-voice-3.0"

type xaiRealtimeDriver struct{}
type xaiRealtimeMapper struct{}

// @nimi-authority: rule.nimi.runtime.ai-provider.r114
func (xaiRealtimeDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudRealtimeTarget, error) {
	invalid := func() (CloudRealtimeTarget, error) {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("xAI Realtime target is not admitted"))
	}
	if identity.ImplementationID != "cloud.realtime.interact.xai" || identity.DriverID != "nimi.runtime.driver.xai" || identity.DriverDialect != "xai/realtime/v1" || raw == nil {
		return invalid()
	}
	for key := range raw.GetFields() {
		if key != "provider" && key != "providerModelId" && key != "remoteModelCatalogId" {
			return invalid()
		}
	}
	provider, pOK := exactCloudTargetText(raw, "provider")
	model, mOK := exactCloudTargetText(raw, "providerModelId")
	catalog, cOK := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !pOK || provider != "xai" || !mOK || model != XAIVoice3Model || !cOK {
		return invalid()
	}
	return CloudRealtimeTarget{provider: provider, providerModelID: model, remoteModelCatalogID: catalog}, nil
}

func (xaiRealtimeDriver) NegotiateInputAudio(proposed *runtimev1.AiRealtimeAudioFormat) (*runtimev1.AiRealtimeAudioFormat, error) {
	return realtimeInputAudioAtRate(proposed, 24000)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r113
func (xaiRealtimeDriver) NewSession(target CloudRealtimeTarget, open CloudRealtimeOpen) (CloudRealtimeProtocol, error) {
	if target.provider != "xai" || target.providerModelID != XAIVoice3Model || open.InteractionMode == runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS || open.SelfIntention || !open.AudioOutput || open.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Grok Voice3 requires manual owner-controlled turns and audio output, without Agent tools or automatic VAD"))
	}
	if open.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || open.InputAudio.GetSampleRateHz() != 24000 || open.InputAudio.GetChannelCount() != 1 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: 24000}
	}
	return newRealtimeWireSession(xaiRealtimeMapper{}, target, open), nil
}

func (xaiRealtimeMapper) Transport() CloudRealtimeTransport {
	return CloudRealtimeTransport{BasePaths: []string{"/v1"}, Path: "/v1/realtime", ModelQuery: true}
}
func (xaiRealtimeMapper) MapOpen(id string, target CloudRealtimeTarget, open CloudRealtimeOpen) ([]byte, error) {
	session := map[string]any{
		"model": target.providerModelID, "voice": "eve", "instructions": open.InitialInstruction,
		"turn_detection": map[string]any{"type": nil}, "resumption": map[string]any{"enabled": false}, "tools": []any{},
		"audio": map[string]any{
			"input":  map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "transport": "json"},
			"output": map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "transport": "json"},
		},
	}
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": session})
}

func (xaiRealtimeMapper) MapInput(id string, req *runtimev1.AppendRealtimeInputRequest) ([]byte, error) {
	if req != nil {
		switch input := req.GetInput().(type) {
		case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
			if len(input.AudioFrame.GetFrame()) > 0 && len(input.AudioFrame.GetFrame())%2 == 0 {
				return json.Marshal(map[string]any{"event_id": id, "type": "input_audio_buffer.append", "audio": base64.StdEncoding.EncodeToString(input.AudioFrame.GetFrame())})
			}
		case *runtimev1.AppendRealtimeInputRequest_Text:
			if strings.TrimSpace(input.Text.GetText()) != "" {
				return cloudRealtimeConversationText(id, "user", input.Text.GetText())
			}
		case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
			if input.OwnerContext.GetKind() != runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_UNSPECIFIED && strings.TrimSpace(input.OwnerContext.GetText()) != "" {
				return cloudRealtimeConversationText(id, "system", input.OwnerContext.GetText())
			}
		}
	}
	return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("xAI Realtime input is invalid"))
}
func (xaiRealtimeMapper) MapOwnerControl(id string, req *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error) {
	if req != nil {
		switch req.GetControl() {
		case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT:
			return json.Marshal(map[string]any{"event_id": id, "type": "input_audio_buffer.commit"})
		case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE:
			return json.Marshal(map[string]any{"event_id": id, "type": "response.create", "response": map[string]any{"modalities": []string{"text", "audio"}}})
		}
	}
	return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("xAI Realtime owner control is unsupported"))
}
func (xaiRealtimeMapper) MapInterrupt(id, key string) ([]byte, error) {
	if key == "" {
		return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("xAI response identity is required"))
	}
	return json.Marshal(map[string]any{"event_id": id, "type": "response.cancel", "response_id": key})
}
func (xaiRealtimeMapper) SelfIntentionTools(bool) []any { return nil }
func (xaiRealtimeMapper) SelfIntentionToolsUpdate(string, bool, runtimev1.AiRealtimeTurnDetectionMode) ([]byte, error) {
	return nil, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("xAI Agent self-intention is not admitted"))
}

func validXAIRealtimeReady(raw []byte, expected CloudRealtimeOpen) bool {
	type audioFormat struct {
		Format struct {
			Type string `json:"type"`
			Rate uint32 `json:"rate"`
		} `json:"format"`
		Transport string `json:"transport"`
	}
	var event struct {
		Session struct {
			Model         string `json:"model"`
			Voice         string `json:"voice"`
			Instructions  string `json:"instructions"`
			TurnDetection *struct {
				Type        json.RawMessage `json:"type"`
				IdleTimeout *int64          `json:"idle_timeout_ms"`
			} `json:"turn_detection"`
			Audio *struct {
				Input  audioFormat `json:"input"`
				Output audioFormat `json:"output"`
			} `json:"audio"`
			Tools      []json.RawMessage `json:"tools"`
			Resumption *struct {
				Enabled bool `json:"enabled"`
			} `json:"resumption"`
		} `json:"session"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return false
	}
	s := event.Session
	if s.Audio != nil {
		for _, f := range []audioFormat{s.Audio.Input, s.Audio.Output} {
			if f.Format.Type != "audio/pcm" || f.Format.Rate != 24000 || f.Transport != "" && f.Transport != "json" {
				return false
			}
		}
	}
	return s.Model == XAIVoice3Model && strings.EqualFold(s.Voice, "eve") && s.Instructions == expected.InitialInstruction && s.TurnDetection != nil && bytes.Equal(bytes.TrimSpace(s.TurnDetection.Type), []byte("null")) && s.TurnDetection.IdleTimeout == nil && len(s.Tools) == 0 && (s.Resumption == nil || !s.Resumption.Enabled)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r116
func (xaiRealtimeMapper) NormalizeEvent(raw []byte, expected CloudRealtimeOpen) ([]CloudRealtimeEvent, error) {
	invalid := func() ([]CloudRealtimeEvent, error) {
		return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("xAI Realtime event is invalid"))
	}
	var event cloudRealtimeServerEvent
	if len(raw) == 0 || json.Unmarshal(raw, &event) != nil || event.Type == "" {
		return invalid()
	}
	out := CloudRealtimeEvent{ProviderResponseID: firstExact(event.ResponseID, event.Response.ID), ProviderItemID: event.ItemID}
	switch event.Type {
	case "session.created", "conversation.created", "conversation.item.added", "conversation.item.deleted", "conversation.item.truncated", "input_audio_buffer.cleared", "response.output_item.added", "response.output_item.done", "response.content_part.added", "response.content_part.done":
		return nil, nil
	case "session.updated":
		if !validXAIRealtimeReady(raw, expected) {
			return invalid()
		}
		out.Kind = CloudRealtimeEventReady
	case "input_audio_buffer.committed":
		out.Kind = CloudRealtimeEventInputCommitted
	case "conversation.item.input_audio_transcription.updated":
		out.Kind, out.Text = CloudRealtimeEventTranscriptPartial, event.Transcript
	case "conversation.item.input_audio_transcription.completed":
		out.Kind, out.Text = CloudRealtimeEventTranscriptFinal, event.Transcript
	case "response.created":
		if event.Response.Status != "in_progress" {
			return invalid()
		}
		out.Kind = CloudRealtimeEventOutputStarted
	case "response.output_audio_transcript.delta", "response.text.delta", "response.output_text.delta":
		out.Kind, out.Text = CloudRealtimeEventTextDelta, event.Delta
	case "response.output_audio_transcript.done":
		out.Kind, out.Text = CloudRealtimeEventTextFinal, event.Transcript
	case "response.output_audio.delta":
		audio, err := base64.StdEncoding.Strict().DecodeString(event.Delta)
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
		case "incomplete":
			out.ResponseStatus = CloudRealtimeResponseStatusFailed
		default:
			return invalid()
		}
		if u := event.Response.Usage; u != nil {
			if u.InputTokens == nil || u.OutputTokens == nil || *u.InputTokens < 0 || *u.OutputTokens < 0 {
				return invalid()
			}
			out.Usage = &runtimev1.UsageStats{InputTokens: *u.InputTokens, OutputTokens: *u.OutputTokens}
		}
	case "error":
		out.Kind, out.ErrorCode = CloudRealtimeEventFailed, event.Error.Code
	default:
		// Automatic VAD, unsolicited tools and unreviewed wire variants cannot
		// silently acquire control of this manual owner-controlled session.
		return invalid()
	}
	if out.Kind >= CloudRealtimeEventOutputStarted && out.Kind <= CloudRealtimeEventResponseDone && out.ProviderResponseID == "" {
		return invalid()
	}
	if out.Kind >= CloudRealtimeEventSpeechStarted && out.Kind <= CloudRealtimeEventInputTranscriptionFailed && out.ProviderItemID == "" {
		return invalid()
	}
	return []CloudRealtimeEvent{out}, nil
}
