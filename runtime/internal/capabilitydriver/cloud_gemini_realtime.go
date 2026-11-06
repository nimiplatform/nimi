package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"mime"
	"strings"
	"sync"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-live-owner-controls
type geminiRealtimeDriver struct{}

func (geminiRealtimeDriver) ValidateTarget(identity Identity, raw *structpb.Struct) (CloudRealtimeTarget, error) {
	invalid := func() (CloudRealtimeTarget, error) {
		return CloudRealtimeTarget{}, cloudInvocationError(CloudInvocationFailureTarget, fmt.Errorf("Gemini Live target is not admitted"))
	}
	if identity.ImplementationID != "cloud.realtime.interact.gemini" || identity.DriverID != "nimi.runtime.driver.gemini" || identity.DriverDialect != "gemini/realtime/v1" || raw == nil {
		return invalid()
	}
	for k := range raw.GetFields() {
		if k != "provider" && k != "providerModelId" && k != "remoteModelCatalogId" {
			return invalid()
		}
	}
	p, ok := exactCloudTargetText(raw, "provider")
	m, mok := exactCloudTargetText(raw, "providerModelId")
	id, iok := exactCloudTargetText(raw, "remoteModelCatalogId")
	if !ok || !mok || !iok || p != "gemini" || m != "gemini-3.8-live" {
		return invalid()
	}
	return CloudRealtimeTarget{provider: p, providerModelID: m, remoteModelCatalogID: id}, nil
}

func (geminiRealtimeDriver) NewSession(target CloudRealtimeTarget, open CloudRealtimeOpen) (CloudRealtimeProtocol, error) {
	if open.InputAudio == nil || open.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || open.InputAudio.GetSampleRateHz() != 16000 || open.InputAudio.GetChannelCount() != 1 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: 16000}
	}
	if open.InteractionMode != runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS || open.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_UNSPECIFIED || !open.AudioOutput || open.SelfIntention {
		return nil, continuousRealtimeUnsupported()
	}
	return &geminiRealtimeSession{target: target, open: open}, nil
}

type geminiRealtimeSession struct {
	mu                   sync.Mutex
	target               CloudRealtimeTarget
	open                 CloudRealtimeOpen
	ready, muted, closed bool
}

func realtimeJSON(value any) []byte { out, _ := json.Marshal(value); return out }
func geminiRealtimeOutputError(message string) error {
	return cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("%s", message))
}

func (s *geminiRealtimeSession) Transport() CloudRealtimeTransport {
	return CloudRealtimeTransport{BasePaths: []string{"/v1beta/openai", "/v1beta"}, Path: "/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent", APIKeyHeader: "x-goog-api-key"}
}
func (s *geminiRealtimeSession) OpenWire(string) ([]byte, error) {
	setup := map[string]any{
		"model":                   "models/" + s.target.providerModelID,
		"generationConfig":        map[string]any{"responseModalities": []string{"AUDIO"}},
		"realtimeInputConfig":     map[string]any{"automaticActivityDetection": map[string]any{"disabled": false}, "activityHandling": "START_OF_ACTIVITY_INTERRUPTS"},
		"inputAudioTranscription": map[string]any{}, "outputAudioTranscription": map[string]any{},
	}
	if s.open.InitialInstruction != "" {
		setup["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": s.open.InitialInstruction}}}
	}
	return realtimeJSON(map[string]any{"setup": setup}), nil
}

func (s *geminiRealtimeSession) Input(_ string, request *runtimev1.AppendRealtimeInputRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || request == nil {
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	switch input := request.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		f := input.AudioFrame
		if s.muted || f == nil || f.GetUtteranceId() != "" || len(f.GetFrame()) == 0 || len(f.GetFrame())%2 != 0 || len(f.GetFrame()) > int(s.open.InputAudio.GetMaximumFrameBytes()) {
			return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
		}
		return CloudRealtimeEffect{Wires: [][]byte{realtimeJSON(map[string]any{"realtimeInput": map[string]any{"audio": map[string]string{"mimeType": "audio/pcm;rate=16000", "data": base64.StdEncoding.EncodeToString(f.GetFrame())}}})}}, nil
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		c := input.OwnerContext
		if c == nil || c.GetContextRequestId() != "" || strings.TrimSpace(c.GetText()) == "" || len(c.GetText()) > 32*1024 || (c.GetKind() != runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT && c.GetKind() != runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT) {
			return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
		}
		return CloudRealtimeEffect{Wires: [][]byte{realtimeJSON(map[string]any{"clientContent": map[string]any{"turns": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": c.GetText()}}}}, "turnComplete": false}})}}, nil
	default:
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
}

func (s *geminiRealtimeSession) OwnerControl(_ string, request *runtimev1.SubmitRealtimeOwnerControlRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || request == nil {
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	switch request.GetControl() {
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_MUTE_INPUT:
		s.muted = true
		return CloudRealtimeEffect{Wires: [][]byte{realtimeJSON(map[string]any{"realtimeInput": map[string]any{"audioStreamEnd": true}})}}, nil
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_UNMUTE_INPUT:
		s.muted = false
		return CloudRealtimeEffect{}, nil
	default:
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
}
func (s *geminiRealtimeSession) Interrupt(string, string) (CloudRealtimeEffect, error) {
	return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
}
func (s *geminiRealtimeSession) WaitNativeStop(context.Context, string) (CloudRealtimeStopResult, error) {
	return CloudRealtimeStopResult{}, continuousRealtimeUnsupported()
}
func (s *geminiRealtimeSession) CurrentResponseKey() string    { return "" }
func (s *geminiRealtimeSession) CloseByTransportRelease() bool { return true }
func (s *geminiRealtimeSession) Close()                        { s.mu.Lock(); defer s.mu.Unlock(); s.closed = true }

func (s *geminiRealtimeSession) Normalize(raw []byte) ([]CloudRealtimeEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, nil
	}
	var message struct {
		Setup   *struct{} `json:"setupComplete"`
		Content *struct {
			ModelTurn *struct {
				Parts []struct {
					Text    string `json:"text"`
					Thought bool   `json:"thought"`
					Inline  *struct {
						Data string `json:"data"`
						MIME string `json:"mimeType"`
					} `json:"inlineData"`
				} `json:"parts"`
			} `json:"modelTurn"`
			Input *struct {
				Text string `json:"text"`
			} `json:"inputTranscription"`
			Output *struct {
				Text string `json:"text"`
			} `json:"outputTranscription"`
			Interrupted  bool `json:"interrupted"`
			TurnComplete bool `json:"turnComplete"`
		} `json:"serverContent"`
		Tool             json.RawMessage `json:"toolCall"`
		ToolCancellation json.RawMessage `json:"toolCallCancellation"`
		GoAway           json.RawMessage `json:"goAway"`
		Error            json.RawMessage `json:"error"`
	}
	if len(raw) == 0 || len(raw) > 4<<20 || !utf8.Valid(raw) || json.Unmarshal(raw, &message) != nil {
		return nil, geminiRealtimeOutputError("invalid native Live message")
	}
	if len(message.Error) > 0 || len(message.GoAway) > 0 {
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventFailed, ErrorCode: "gemini_session_ended", FailureReason: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE}}, nil
	}
	if len(message.Tool) > 0 || len(message.ToolCancellation) > 0 {
		return nil, geminiRealtimeOutputError("unrequested native tool action")
	}
	if message.Setup != nil {
		if s.ready || message.Content != nil {
			return nil, geminiRealtimeOutputError("duplicate or combined setup completion")
		}
		s.ready = true
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventReady}}, nil
	}
	if !s.ready {
		return nil, geminiRealtimeOutputError("content before setup completion")
	}
	c := message.Content
	if c == nil {
		return nil, nil
	}
	var events []CloudRealtimeEvent
	transcript := func(text string, direction runtimev1.AiRealtimeTranscriptDirection) error {
		if len(text) > 32*1024 {
			return geminiRealtimeOutputError("oversized native transcript")
		}
		if text != "" {
			events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventContinuousTranscript, TranscriptDirection: direction, Text: text})
		}
		return nil
	}
	if c.Input != nil {
		if err := transcript(c.Input.Text, runtimev1.AiRealtimeTranscriptDirection_AI_REALTIME_TRANSCRIPT_DIRECTION_INPUT); err != nil {
			return nil, err
		}
	}
	if c.Output != nil {
		if err := transcript(c.Output.Text, runtimev1.AiRealtimeTranscriptDirection_AI_REALTIME_TRANSCRIPT_DIRECTION_OUTPUT); err != nil {
			return nil, err
		}
	}
	if c.ModelTurn != nil && !c.Interrupted {
		for _, part := range c.ModelTurn.Parts {
			if part.Thought {
				continue
			}
			if part.Text != "" {
				return nil, geminiRealtimeOutputError("unexpected non-transcription text")
			}
			if part.Inline == nil {
				continue
			}
			mediaType, params, err := mime.ParseMediaType(part.Inline.MIME)
			if err != nil || mediaType != "audio/pcm" || len(params) != 1 || params["rate"] != "24000" || len(part.Inline.Data) > base64.StdEncoding.EncodedLen(256<<10) {
				return nil, geminiRealtimeOutputError("native output audio format or limit")
			}
			audio, err := base64.StdEncoding.Strict().DecodeString(part.Inline.Data)
			if err != nil || len(audio) == 0 || len(audio)%2 != 0 {
				return nil, geminiRealtimeOutputError("native output audio bytes")
			}
			events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventAudioDelta, Audio: audio})
		}
	}
	if c.Interrupted {
		events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventContinuousInterruption})
	}
	if c.TurnComplete {
		events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventAudioDone})
	}
	return events, nil
}
