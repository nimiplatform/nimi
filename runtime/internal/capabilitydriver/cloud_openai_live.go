package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"sync"
	"time"
	"unicode"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

const OpenAILiveModel = "gpt-live-1"

func continuousRealtimeUnsupported() error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED, grpcerr.ReasonOptions{Message: "The selected Realtime target does not support this interaction mode or control", ActionHint: "choose_supported_realtime_mode"})
}

type openAILiveSession struct {
	mu                       sync.Mutex
	open                     CloudRealtimeOpen
	startEventID             string
	nativeSessionID          string
	ready, closed, closeSent bool
	usage                    *float64
}

type openAILiveResource struct {
	ID        string `json:"id"`
	Model     string `json:"model"`
	Status    string `json:"status"`
	ExpiresAt int64  `json:"expires_at"`
	Store     *bool  `json:"store"`
	Audio     struct {
		Format struct {
			Type string `json:"type"`
			Rate int    `json:"rate"`
		} `json:"format"`
		Output struct {
			Voice string `json:"voice"`
		} `json:"output"`
	} `json:"audio"`
	Delegation struct {
		Type string `json:"type"`
	} `json:"delegation"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.gpt-live-continuous
func newOpenAILiveSession(target CloudRealtimeTarget, open CloudRealtimeOpen) (CloudRealtimeProtocol, error) {
	if target.Provider() != "openai" || target.ProviderModelID() != OpenAILiveModel || open.InteractionMode != runtimev1.AiRealtimeInteractionMode_AI_REALTIME_INTERACTION_MODE_CONTINUOUS || open.SelfIntention || !open.AudioOutput || open.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_UNSPECIFIED {
		return nil, continuousRealtimeUnsupported()
	}
	if open.InputAudio == nil || open.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || open.InputAudio.GetSampleRateHz() != 24000 || open.InputAudio.GetChannelCount() != 1 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: 24000}
	}
	return &openAILiveSession{open: open}, nil
}

func (s *openAILiveSession) Transport() CloudRealtimeTransport {
	return CloudRealtimeTransport{BasePath: "/v1", Path: "/v1/live/sessions"}
}

func (s *openAILiveSession) OpenWire(id string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.startEventID != "" || !liveOpaqueID(id) {
		return nil, continuousRealtimeUnsupported()
	}
	s.startEventID = id
	return json.Marshal(map[string]any{"type": "session.start", "event_id": id, "session": map[string]any{
		"model": OpenAILiveModel, "instructions": s.open.InitialInstruction, "store": false,
		"audio":      map[string]any{"format": map[string]any{"type": "audio/pcm", "rate": 24000}, "output": map[string]any{"voice": "marin"}},
		"delegation": map[string]any{"type": "client"},
	}})
}

func (s *openAILiveSession) Input(id string, request *runtimev1.AppendRealtimeInputRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.closeSent || request == nil {
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	var payload map[string]any
	switch input := request.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		if input.AudioFrame == nil || len(input.AudioFrame.GetFrame()) == 0 || len(input.AudioFrame.GetFrame())%2 != 0 {
			return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
		}
		payload = map[string]any{"type": "session.input_audio.append", "event_id": id, "audio": base64.StdEncoding.EncodeToString(input.AudioFrame.GetFrame())}
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		if input.OwnerContext != nil && len(input.OwnerContext.GetText()) > 500 {
			return CloudRealtimeEffect{}, grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_LIMIT_EXCEEDED, grpcerr.ReasonOptions{Message: "Continuous context exceeds 500 UTF-8 bytes", ActionHint: "shorten_realtime_owner_context"})
		}
		if input.OwnerContext == nil || strings.TrimSpace(input.OwnerContext.GetText()) == "" {
			return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
		}
		kind := ""
		switch input.OwnerContext.GetKind() {
		case runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_INSTRUCTION:
			kind = "session.instructions.append"
		case runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT:
			kind = "session.thinking.append"
		case runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_SANITIZED_RESULT:
			kind = "session.commentary.append"
		default:
			return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
		}
		var delegation any
		// The Service replaces a validated Runtime context ID with its captured
		// native handle on a private request copy before this protocol mapping.
		if native := input.OwnerContext.GetContextRequestId(); native != "" {
			if !liveOpaqueID(native) {
				return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
			}
			delegation = native
		}
		payload = map[string]any{"type": kind, "event_id": id, "content": input.OwnerContext.GetText(), "delegation_id": delegation}
	default:
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	wire, err := json.Marshal(payload)
	return realtimeWireEffect(wire, err)
}

func (s *openAILiveSession) OwnerControl(id string, request *runtimev1.SubmitRealtimeOwnerControlRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.closeSent || request == nil {
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	kind := ""
	switch request.GetControl() {
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_MUTE_INPUT:
		kind = "session.input_audio.mute"
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_UNMUTE_INPUT:
		kind = "session.input_audio.unmute"
	default:
		return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
	}
	wire, err := json.Marshal(map[string]any{"type": kind, "event_id": id})
	return realtimeWireEffect(wire, err)
}

func (s *openAILiveSession) Interrupt(string, string) (CloudRealtimeEffect, error) {
	return CloudRealtimeEffect{}, continuousRealtimeUnsupported()
}
func (s *openAILiveSession) CurrentResponseKey() string { return "" }
func (s *openAILiveSession) WaitNativeStop(context.Context, string) (CloudRealtimeStopResult, error) {
	return CloudRealtimeStopResult{}, continuousRealtimeUnsupported()
}

func (s *openAILiveSession) CloseWire(id string) ([]byte, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready || s.closed || s.closeSent {
		return nil, continuousRealtimeUnsupported()
	}
	s.closeSent = true
	return json.Marshal(map[string]any{"type": "session.close", "event_id": id})
}

func liveOpaqueID(id string) bool {
	return id != "" && len(id) <= 512 && strings.TrimSpace(id) == id && !strings.ContainsFunc(id, unicode.IsControl)
}

func (s *openAILiveSession) validResource(resource *openAILiveResource, opening bool) bool {
	return resource != nil && liveOpaqueID(resource.ID) && resource.Model == OpenAILiveModel &&
		(!opening || resource.Status == "active" && resource.ExpiresAt > time.Now().Unix()) &&
		(resource.Store == nil || !*resource.Store) && resource.Audio.Format.Type == "audio/pcm" && resource.Audio.Format.Rate == 24000 && resource.Audio.Output.Voice == "marin" && resource.Delegation.Type == "client" &&
		(s.nativeSessionID == "" || s.nativeSessionID == resource.ID)
}

func (s *openAILiveSession) Normalize(raw []byte) ([]CloudRealtimeEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	invalid := func() ([]CloudRealtimeEvent, error) {
		return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("OpenAI Live event does not match the captured continuous session"))
	}
	if s.closed {
		return nil, nil
	}
	var event struct {
		Type          string              `json:"type"`
		ClientEventID string              `json:"client_event_id"`
		Session       *openAILiveResource `json:"session"`
		Delta         *string             `json:"delta"`
		StartMS       *int64              `json:"start_ms"`
		EndMS         *int64              `json:"end_ms"`
		OffsetMS      *int64              `json:"offset_ms"`
		Delegation    *struct {
			ID         string `json:"id"`
			Target     string `json:"target"`
			Type       string `json:"type"`
			ResponseID string `json:"response_id"`
		} `json:"delegation"`
		Usage *struct {
			Seconds *float64 `json:"seconds"`
		} `json:"usage"`
		Reason string `json:"reason"`
	}
	if len(raw) > 1<<20 || json.Unmarshal(raw, &event) != nil {
		return invalid()
	}
	if event.Type == "session.started" {
		if !s.validResource(event.Session, true) || (event.ClientEventID != "" && event.ClientEventID != s.startEventID) {
			return invalid()
		}
		if s.ready {
			return nil, nil
		}
		s.nativeSessionID = event.Session.ID
		s.ready = true
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventReady, ProviderSessionID: s.nativeSessionID}}, nil
	}
	if !s.ready {
		return invalid()
	}
	switch event.Type {
	case "session.updated":
		if !s.validResource(event.Session, false) {
			return invalid()
		}
		return nil, nil
	case "session.input_audio.muted", "session.input_audio.unmuted", "session.instructions.appended", "session.thinking.appended", "session.commentary.appended", "info":
		return nil, nil
	case "session.output_audio.delta":
		if event.Delta == nil || len(*event.Delta) > base64.StdEncoding.EncodedLen(256<<10) || event.StartMS != nil || event.EndMS != nil {
			return invalid()
		}
		data, err := base64.StdEncoding.DecodeString(*event.Delta)
		if err != nil || len(data)%2 != 0 {
			return invalid()
		}
		if len(data) == 0 {
			return nil, nil
		}
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventAudioDelta, Audio: data}}, nil
	case "session.input_transcript.delta", "session.output_transcript.delta":
		if event.Delta == nil || len(*event.Delta) > 32<<10 || event.StartMS == nil || event.EndMS == nil || *event.StartMS < 0 || *event.EndMS < *event.StartMS || *event.EndMS > 86_400_000 {
			return invalid()
		}
		direction := runtimev1.AiRealtimeTranscriptDirection_AI_REALTIME_TRANSCRIPT_DIRECTION_INPUT
		if event.Type == "session.output_transcript.delta" {
			direction = runtimev1.AiRealtimeTranscriptDirection_AI_REALTIME_TRANSCRIPT_DIRECTION_OUTPUT
		}
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventContinuousTranscript, Text: *event.Delta, TranscriptDirection: direction, StartMS: *event.StartMS, EndMS: *event.EndMS}}, nil
	case "session.delegation.created":
		if event.Delegation == nil || !liveOpaqueID(event.Delegation.ID) || event.Delegation.Type != "delegation" || event.Delegation.Target != "client" || event.Delegation.ResponseID != "" || event.OffsetMS == nil || *event.OffsetMS < 0 || *event.OffsetMS > 86_400_000 {
			return invalid()
		}
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventContextRequest, ProviderContextID: event.Delegation.ID, OffsetMS: *event.OffsetMS}}, nil
	case "session.usage.updated", "session.closed":
		if event.Usage == nil || event.Usage.Seconds == nil || math.IsNaN(*event.Usage.Seconds) || math.IsInf(*event.Usage.Seconds, 0) || *event.Usage.Seconds < 0 || *event.Usage.Seconds > 86400 || (s.usage != nil && *event.Usage.Seconds < *s.usage) {
			return invalid()
		}
		seconds := *event.Usage.Seconds
		s.usage = &seconds
		if event.Type == "session.usage.updated" {
			return []CloudRealtimeEvent{{Kind: CloudRealtimeEventSessionUsage, SessionAudioSeconds: &seconds}}, nil
		}
		if !s.validResource(event.Session, false) {
			return invalid()
		}
		switch event.Reason {
		case "close_requested", "expired", "content", "remote_hangup", "connection_lost":
		default:
			return invalid()
		}
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventSessionClosed, SessionAudioSeconds: &seconds, SessionCloseReason: event.Reason}}, nil
	case "error":
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventFailed, ErrorCode: "live-session-error"}}, nil
	default:
		// Responses/Decisions and fixture audio are not admitted in this cell.
		return invalid()
	}
}

func (s *openAILiveSession) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.open = CloudRealtimeOpen{}
	s.nativeSessionID = ""
	s.startEventID = ""
	s.usage = nil
}
