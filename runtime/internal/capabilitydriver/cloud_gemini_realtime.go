package capabilitydriver

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-live-owner-controls
type geminiRealtimeDriver struct{}

// @nimi-authority: rule.nimi.runtime.ai-provider.gemini-live-owner-controls
// This private candidate is deliberately absent from the production registry.
func NewGeminiRealtimeCandidateDriver() CloudRealtimeDriver {
	return geminiRealtimeDriver{}
}

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
	if !open.AudioOutput || open.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
		return nil, geminiRealtimeInputError("Realtime requires manual turn detection and audio output")
	}
	return &geminiRealtimeSession{target: target, open: open, phase: "idle"}, nil
}

type geminiRealtimeSession struct {
	mu                                                        sync.Mutex
	target                                                    CloudRealtimeTarget
	open                                                      CloudRealtimeOpen
	phase                                                     string
	ordinal                                                   uint64
	inputMode                                                 string
	inputKey                                                  string
	inputTrack, utterance                                     string
	sealed, inputFinal                                        bool
	deferredFinal                                             string
	deferredFinalSet                                          bool
	transcript, outputText                                    string
	reportedUsage                                             *runtimev1.UsageStats
	outputFinal                                               bool
	responseKey                                               string
	outputStarted                                             bool
	interrupted, generationComplete                           bool
	turnCompleteObserved, idleObserved, inputFinishedObserved bool
	interactionObserved                                       string
	drainPackets, drainAudioPackets                           int
	stopRequestedAt, lastNativeControlAt                      time.Time
	stopReady                                                 chan struct{}
	stopResult                                                CloudRealtimeStopResult
	stopErr                                                   error
	closed                                                    bool
}

func geminiRealtimeInputError(message string) error {
	return cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("%s", message))
}
func geminiRealtimeOutputError(message string) error {
	return cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("%s", message))
}
func (s *geminiRealtimeSession) Transport() CloudRealtimeTransport {
	return CloudRealtimeTransport{Endpoint: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent", APIKeyHeader: "x-goog-api-key"}
}
func realtimeJSON(value any) []byte { out, _ := json.Marshal(value); return out }
func (s *geminiRealtimeSession) OpenWire(string) ([]byte, error) {
	setup := map[string]any{
		"model":                   "models/" + s.target.providerModelID,
		"generationConfig":        map[string]any{"responseModalities": []string{"AUDIO"}},
		"realtimeInputConfig":     map[string]any{"automaticActivityDetection": map[string]any{"disabled": true}, "activityHandling": "NO_INTERRUPTION", "turnCoverage": "TURN_INCLUDES_ONLY_ACTIVITY"},
		"inputAudioTranscription": map[string]any{}, "outputAudioTranscription": map[string]any{},
	}
	if s.open.InitialInstruction != "" {
		setup["systemInstruction"] = map[string]any{"parts": []any{map[string]any{"text": s.open.InitialInstruction}}}
	}
	return realtimeJSON(map[string]any{"setup": setup}), nil
}

func (s *geminiRealtimeSession) Input(id string, req *runtimev1.AppendRealtimeInputRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.phase == "response" || s.phase == "draining" || s.phase == "stopped" {
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime input waits for the current output to finish or be interrupted")
	}
	if req == nil {
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime input is required")
	}
	switch v := req.GetInput().(type) {
	case *runtimev1.AppendRealtimeInputRequest_AudioFrame:
		f := v.AudioFrame
		if f == nil || len(f.GetFrame()) == 0 || len(f.GetFrame())%2 != 0 || len(f.GetFrame()) > int(s.open.InputAudio.GetMaximumFrameBytes()) {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime audio frame is invalid")
		}
		if s.inputMode != "" && (s.inputMode != "audio" || s.sealed || s.inputTrack != f.GetInputTrackId() || s.utterance != f.GetUtteranceId()) {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime permits one unresolved input modality and utterance")
		}
		var wires [][]byte
		if s.inputMode == "" {
			s.ordinal++
			s.inputKey = fmt.Sprintf("gemini-input-%d", s.ordinal)
			s.inputMode = "audio"
			s.inputTrack = f.GetInputTrackId()
			s.utterance = f.GetUtteranceId()
			s.inputFinal = false
			s.sealed = false
			s.transcript = ""
			s.deferredFinalSet = false
			wires = append(wires, realtimeJSON(map[string]any{"realtimeInput": map[string]any{"activityStart": map[string]any{}}}))
		}
		wires = append(wires, realtimeJSON(map[string]any{"realtimeInput": map[string]any{"audio": map[string]any{"data": base64.StdEncoding.EncodeToString(f.GetFrame()), "mimeType": "audio/pcm;rate=16000"}}}))
		s.phase = "input"
		return CloudRealtimeEffect{Wires: wires}, nil
	case *runtimev1.AppendRealtimeInputRequest_Text:
		if v.Text == nil || strings.TrimSpace(v.Text.GetText()) == "" {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime text is required")
		}
		return s.textInputLocked(v.Text.GetText())
	case *runtimev1.AppendRealtimeInputRequest_OwnerContext:
		if v.OwnerContext == nil || strings.TrimSpace(v.OwnerContext.GetText()) == "" || v.OwnerContext.GetKind() == runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_UNSPECIFIED {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime owner context is invalid")
		}
		if v.OwnerContext.GetKind() == runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_INSTRUCTION {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime instruction is fixed at Open; use bounded context or sanitized result")
		}
		return s.textInputLocked(v.OwnerContext.GetText())
	default:
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime input variant is unsupported")
	}
}

func (s *geminiRealtimeSession) textInputLocked(text string) (CloudRealtimeEffect, error) {
	if s.inputMode == "audio" {
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime does not interleave text with an unresolved audio utterance")
	}
	s.inputMode = "text"
	s.phase = "input"
	return CloudRealtimeEffect{Wires: [][]byte{realtimeJSON(map[string]any{"clientContent": map[string]any{"turns": []any{map[string]any{"role": "user", "parts": []any{map[string]any{"text": text}}}}, "turnComplete": false}})}}, nil
}

func (s *geminiRealtimeSession) OwnerControl(id string, req *runtimev1.SubmitRealtimeOwnerControlRequest) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || req == nil {
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime Session is closed")
	}
	switch req.GetControl() {
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_COMMIT_INPUT:
		if s.phase != "input" || s.inputMode != "audio" || s.sealed {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime audio input cannot be committed in the current state")
		}
		s.sealed = true
		effect := CloudRealtimeEffect{BindInputKey: s.inputKey}
		if s.deferredFinalSet {
			effect.Events = []CloudRealtimeEvent{{Kind: CloudRealtimeEventTranscriptFinal, ProviderItemID: s.inputKey, Text: s.deferredFinal}}
			s.inputFinal = true
			s.deferredFinalSet = false
		}
		return effect, nil
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE:
		if s.phase == "response" || s.phase == "draining" || s.phase == "stopped" || s.inputMode == "audio" && !s.sealed {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime response requires sealed input and an idle output")
		}
		if s.phase == "idle" && s.inputMode == "audio" && !s.inputFinal {
			return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime awaits the actual input transcription final")
		}
		var wire []byte
		if s.inputMode == "audio" && s.phase == "input" {
			wire = realtimeJSON(map[string]any{"realtimeInput": map[string]any{"activityEnd": map[string]any{}}})
		} else {
			wire = realtimeJSON(map[string]any{"clientContent": map[string]any{"turnComplete": true}})
		}
		s.ordinal++
		s.responseKey = fmt.Sprintf("gemini-response-%d", s.ordinal)
		s.phase = "response"
		s.outputStarted = false
		s.outputText = ""
		s.outputFinal = false
		s.reportedUsage = nil
		s.interrupted = false
		s.generationComplete = false
		s.turnCompleteObserved, s.idleObserved = false, false
		s.inputFinishedObserved = s.inputFinal || s.deferredFinalSet
		s.interactionObserved = "absent"
		s.drainPackets, s.drainAudioPackets = 0, 0
		s.stopRequestedAt, s.lastNativeControlAt = time.Time{}, time.Time{}
		return CloudRealtimeEffect{Wires: [][]byte{wire}, ResponseKey: s.responseKey}, nil
	case runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_PAUSE_RESPONSE, runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE:
		return s.interruptLocked(s.responseKey)
	default:
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime owner control is unsupported")
	}
}
func (s *geminiRealtimeSession) Interrupt(id, key string) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.interruptLocked(key)
}
func (s *geminiRealtimeSession) interruptLocked(key string) (CloudRealtimeEffect, error) {
	if s.closed || s.phase != "response" || key == "" || key != s.responseKey || !s.outputStarted {
		return CloudRealtimeEffect{}, geminiRealtimeInputError("Realtime output track is not current")
	}
	s.phase = "draining"
	s.stopReady = make(chan struct{})
	s.stopErr = nil
	s.stopResult = CloudRealtimeStopResult{}
	s.stopRequestedAt = time.Now()
	return CloudRealtimeEffect{Wires: [][]byte{realtimeJSON(map[string]any{"clientContent": map[string]any{"turnComplete": false}})}, AwaitNativeStop: true, ResponseKey: key}, nil
}

func (s *geminiRealtimeSession) WaitNativeStop(ctx context.Context, key string) (CloudRealtimeStopResult, error) {
	s.mu.Lock()
	if key != s.responseKey || s.stopReady == nil {
		s.mu.Unlock()
		return CloudRealtimeStopResult{}, geminiRealtimeInputError("Realtime native stop is not pending")
	}
	ready := s.stopReady
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		s.mu.Lock()
		observation := s.nativeStopObservationLocked()
		s.mu.Unlock()
		return CloudRealtimeStopResult{}, geminiRealtimeOutputError(fmt.Sprintf("Realtime native stop was not confirmed (%s): %s", ctx.Err(), observation))
	case <-ready:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.stopResult, s.stopErr
	if err == nil {
		s.phase = "idle"
		s.responseKey = ""
		s.outputStarted = false
		if s.inputMode != "audio" || s.inputFinal {
			s.clearInputLocked()
		}
	}
	return result, err
}

// Only control presence, reception time and bounded counters enter diagnostics.
func (s *geminiRealtimeSession) nativeStopObservationLocked() string {
	elapsed := int64(0)
	if !s.stopRequestedAt.IsZero() {
		elapsed = time.Since(s.stopRequestedAt).Milliseconds()
	}
	lastControl := "absent"
	if !s.lastNativeControlAt.IsZero() {
		lastControl = s.lastNativeControlAt.UTC().Format(time.RFC3339Nano)
	}
	return fmt.Sprintf("phase=%s closed=%t interrupted_observed=%t generation_complete_observed=%t turn_complete_observed=%t idle_observed=%t interaction=%s input_finished_observed=%t drain_packets=%d drain_audio_packets=%d elapsed_ms=%d last_control_at=%s",
		s.phase, s.closed, s.interrupted, s.generationComplete, s.turnCompleteObserved, s.idleObserved, s.interactionObserved, s.inputFinishedObserved, s.drainPackets, s.drainAudioPackets, elapsed, lastControl)
}
func (s *geminiRealtimeSession) clearInputLocked() {
	s.inputMode = ""
	s.inputKey = ""
	s.inputTrack = ""
	s.utterance = ""
	s.sealed = false
	s.inputFinal = false
	s.transcript = ""
	s.deferredFinalSet = false
}
func (s *geminiRealtimeSession) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return
	}
	s.closed = true
	if s.stopReady != nil && s.phase == "draining" {
		s.stopErr = geminiRealtimeOutputError("Realtime Session closed before native stop")
		close(s.stopReady)
		s.stopReady = nil
	}
	s.clearInputLocked()
	s.outputText = ""
}

func (s *geminiRealtimeSession) CurrentResponseKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.phase == "response" && s.outputStarted {
		return s.responseKey
	}
	return ""
}

type geminiLiveTranscription struct {
	Text     string `json:"text"`
	Finished *bool  `json:"finished"`
}
type geminiLiveContent struct {
	ModelTurn *struct {
		Parts []struct {
			Text       string `json:"text"`
			Thought    bool   `json:"thought"`
			InlineData *struct {
				Data string `json:"data"`
				MIME string `json:"mimeType"`
			} `json:"inlineData"`
		} `json:"parts"`
	} `json:"modelTurn"`
	Input              *geminiLiveTranscription `json:"inputTranscription"`
	Interim            *geminiLiveTranscription `json:"interimInputTranscription"`
	Output             *geminiLiveTranscription `json:"outputTranscription"`
	Interrupted        bool                     `json:"interrupted"`
	GenerationComplete bool                     `json:"generationComplete"`
	TurnComplete       bool                     `json:"turnComplete"`
	Interaction        string                   `json:"interactionStatus"`
	Waiting            bool                     `json:"waitingForInput"`
}

func (s *geminiRealtimeSession) Normalize(raw []byte) ([]CloudRealtimeEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, nil
	}
	var msg struct {
		Setup   *struct{}          `json:"setupComplete"`
		Content *geminiLiveContent `json:"serverContent"`
		Tool    json.RawMessage    `json:"toolCall"`
		GoAway  json.RawMessage    `json:"goAway"`
		Error   json.RawMessage    `json:"error"`
		Usage   *struct {
			Prompt   *int64 `json:"promptTokenCount"`
			Response *int64 `json:"responseTokenCount"`
			Total    *int64 `json:"totalTokenCount"`
			Cached   int64  `json:"cachedContentTokenCount"`
			Thoughts int64  `json:"thoughtsTokenCount"`
		} `json:"usageMetadata"`
	}
	if len(raw) == 0 || json.Unmarshal(raw, &msg) != nil {
		return nil, geminiRealtimeOutputError("Realtime native message is invalid")
	}
	if len(msg.Tool) > 0 || len(msg.GoAway) > 0 || len(msg.Error) > 0 {
		return nil, geminiRealtimeOutputError("Realtime native Session produced an unsupported action or terminal")
	}
	if msg.Setup != nil {
		return []CloudRealtimeEvent{{Kind: CloudRealtimeEventReady}}, nil
	}
	if msg.Usage != nil && (s.phase == "response" || s.phase == "draining") {
		u := msg.Usage
		if (u.Prompt != nil && *u.Prompt < 0) || (u.Response != nil && *u.Response < 0) || (u.Total != nil && *u.Total < 0) || u.Cached < 0 || u.Thoughts < 0 {
			return nil, geminiRealtimeOutputError("Realtime native usage is invalid")
		}
		if u.Prompt != nil && u.Response != nil {
			s.reportedUsage = &runtimev1.UsageStats{InputTokens: *u.Prompt, OutputTokens: *u.Response, CachedInputTokens: u.Cached, ReasoningOutputTokens: u.Thoughts}
		}
	}
	if msg.Content == nil {
		return nil, nil
	}
	c := msg.Content
	if s.phase == "draining" {
		s.drainPackets++
		if c.ModelTurn != nil {
			for _, part := range c.ModelTurn.Parts {
				if part.InlineData != nil && strings.HasPrefix(part.InlineData.MIME, "audio/") {
					s.drainAudioPackets++
					break
				}
			}
		}
	}
	if c.TurnComplete {
		s.turnCompleteObserved = true
	}
	if c.Interaction != "" {
		s.interactionObserved = "other"
		if c.Interaction == "IDLE" {
			s.interactionObserved, s.idleObserved = "IDLE", true
		}
	}
	inputFinished := c.Input != nil && c.Input.Finished != nil && *c.Input.Finished
	if inputFinished {
		s.inputFinishedObserved = true
	}
	if c.Interrupted || c.GenerationComplete || c.TurnComplete || c.Interaction != "" || inputFinished {
		s.lastNativeControlAt = time.Now()
	}
	var events []CloudRealtimeEvent
	input := c.Input
	interim := false
	if input == nil {
		input = c.Interim
		interim = true
	}
	if input != nil {
		if s.inputMode != "audio" || s.inputKey == "" {
			return nil, geminiRealtimeOutputError("Realtime transcription has no unique submitted input")
		}
		if len(s.transcript)+len(input.Text) > 32*1024 {
			return nil, geminiRealtimeOutputError("Realtime transcript is oversized")
		}
		if !interim {
			s.transcript += input.Text
		}
		display := s.transcript
		if interim {
			display = input.Text
		}
		final := !interim && input.Finished != nil && *input.Finished
		if final && !s.sealed {
			s.deferredFinal = s.transcript
			s.deferredFinalSet = true
		} else {
			kind := CloudRealtimeEventTranscriptPartial
			if final {
				kind = CloudRealtimeEventTranscriptFinal
				s.inputFinal = true
			}
			events = append(events, CloudRealtimeEvent{Kind: kind, ProviderItemID: s.inputKey, Text: display})
		}
	}
	if c.Interrupted {
		if s.phase != "draining" {
			return nil, geminiRealtimeOutputError("Realtime native interruption had no owner control")
		}
		s.interrupted = true
	}
	outputAllowed := s.phase == "response" || s.phase == "draining"
	start := func() error {
		if !outputAllowed {
			return geminiRealtimeOutputError("Realtime native response started without owner control")
		}
		if !s.outputStarted {
			s.outputStarted = true
			events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventOutputStarted, ProviderResponseID: s.responseKey})
		}
		return nil
	}
	if !s.interrupted {
		if c.ModelTurn != nil {
			for _, part := range c.ModelTurn.Parts {
				if part.Thought {
					continue
				}
				if part.InlineData != nil {
					if err := start(); err != nil {
						return nil, err
					}
					if part.InlineData.MIME != "audio/pcm;rate=24000" {
						return nil, geminiRealtimeOutputError("Realtime native audio format is invalid")
					}
					audio, err := base64.StdEncoding.DecodeString(part.InlineData.Data)
					if err != nil || len(audio) == 0 || len(audio)%2 != 0 {
						return nil, geminiRealtimeOutputError("Realtime native audio is invalid")
					}
					events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventAudioDelta, ProviderResponseID: s.responseKey, Audio: audio})
				}
				if part.Text != "" {
					return nil, geminiRealtimeOutputError("Realtime audio target returned unadmitted model text")
				}
			}
		}
		if c.Output != nil && c.Output.Text != "" {
			if err := start(); err != nil {
				return nil, err
			}
			if len(s.outputText)+len(c.Output.Text) > 32*1024 {
				return nil, geminiRealtimeOutputError("Realtime output transcription is oversized")
			}
			s.outputText += c.Output.Text
			events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventTextDelta, ProviderResponseID: s.responseKey, Text: c.Output.Text})
		}
		if c.Output != nil && c.Output.Finished != nil && *c.Output.Finished {
			s.outputFinal = true
		}
	}
	if c.GenerationComplete {
		s.generationComplete = true
	}
	if c.TurnComplete {
		if !outputAllowed || s.responseKey == "" || c.Interaction != "IDLE" {
			return nil, geminiRealtimeOutputError("Realtime native turn has no correlated idle terminal")
		}
		usage := s.reportedUsage
		status := CloudRealtimeResponseStatusCompleted
		if s.interrupted {
			status = CloudRealtimeResponseStatusCancelled
		}
		if s.phase == "draining" {
			s.stopResult = CloudRealtimeStopResult{Status: status, Usage: usage}
			if !s.interrupted && !s.generationComplete {
				s.stopErr = geminiRealtimeOutputError("Realtime native stop was neither interrupted nor complete")
			}
			close(s.stopReady)
			s.phase = "stopped"
			s.stopResult.Observation = s.nativeStopObservationLocked()
			return events, nil
		}
		if !s.generationComplete && !c.Waiting {
			return nil, geminiRealtimeOutputError("Realtime native turn completed without generation or waiting evidence")
		}
		if s.outputStarted && s.outputText != "" && s.outputFinal {
			events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventTextFinal, ProviderResponseID: s.responseKey, Text: s.outputText})
		}
		events = append(events, CloudRealtimeEvent{Kind: CloudRealtimeEventResponseDone, ProviderResponseID: s.responseKey, ResponseStatus: status, Usage: usage, NoOutput: !s.outputStarted})
		s.phase = "idle"
		s.responseKey = ""
		s.outputStarted = false
		if s.inputMode != "audio" || s.inputFinal {
			s.clearInputLocked()
		}
	}
	if s.phase == "idle" && s.inputMode == "audio" && s.inputFinal {
		s.clearInputLocked()
	}
	return events, nil
}
