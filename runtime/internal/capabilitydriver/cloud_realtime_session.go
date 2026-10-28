package capabilitydriver

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type CloudRealtimeTransport struct {
	BasePath     string
	Path         string
	ModelQuery   bool
	APIKeyHeader string
}

// Effects belong to one captured Session. Empty wires require a real local
// protocol transition; they never represent an invented provider receipt.
type CloudRealtimeEffect struct {
	Wires           [][]byte
	BindInputKey    string
	Events          []CloudRealtimeEvent
	AwaitNativeStop bool
	ResponseKey     string
}

type CloudRealtimeStopResult struct {
	Status      CloudRealtimeResponseStatus
	Usage       *runtimev1.UsageStats
	Observation string
}

type CloudRealtimeProtocol interface {
	Transport() CloudRealtimeTransport
	OpenWire(string) ([]byte, error)
	Input(string, *runtimev1.AppendRealtimeInputRequest) (CloudRealtimeEffect, error)
	OwnerControl(string, *runtimev1.SubmitRealtimeOwnerControlRequest) (CloudRealtimeEffect, error)
	Interrupt(string, string) (CloudRealtimeEffect, error)
	Normalize([]byte) ([]CloudRealtimeEvent, error)
	WaitNativeStop(context.Context, string) (CloudRealtimeStopResult, error)
	CurrentResponseKey() string
	Close()
}

type realtimeWireMapper interface {
	SelfIntentionTools(bool) []any
	SelfIntentionToolsUpdate(string, bool, runtimev1.AiRealtimeTurnDetectionMode) ([]byte, error)
	Transport() CloudRealtimeTransport
	MapOpen(string, CloudRealtimeTarget, CloudRealtimeOpen) ([]byte, error)
	MapInput(string, *runtimev1.AppendRealtimeInputRequest) ([]byte, error)
	MapOwnerControl(string, *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error)
	MapInterrupt(string, string) ([]byte, error)
	NormalizeEvent([]byte, CloudRealtimeOpen) ([]CloudRealtimeEvent, error)
}

type realtimeWireSession struct {
	contextItems  []string
	pendingAudio  string
	contextCursor string
	toolsDisabled bool
	mapper        realtimeWireMapper
	target        CloudRealtimeTarget
	open          CloudRealtimeOpen
	mu            sync.Mutex
	responseKey   string
	stop          *realtimeWireStop
	closed        bool
}

type realtimeWireStop struct {
	key      string
	ready    chan struct{}
	finished bool
	result   CloudRealtimeStopResult
	err      error
}

func newRealtimeWireSession(mapper realtimeWireMapper, target CloudRealtimeTarget, open CloudRealtimeOpen) CloudRealtimeProtocol {
	return &realtimeWireSession{mapper: mapper, target: target, open: open}
}

func (dashScopeRealtimeDriver) NewSession(target CloudRealtimeTarget, open CloudRealtimeOpen) (CloudRealtimeProtocol, error) {
	return newRealtimeWireSession(dashScopeRealtimeDriver{}, target, open), nil
}
func (openAIRealtimeDriver) NewSession(target CloudRealtimeTarget, open CloudRealtimeOpen) (CloudRealtimeProtocol, error) {
	return newRealtimeWireSession(openAIRealtimeDriver{}, target, open), nil
}
func (s *realtimeWireSession) Transport() CloudRealtimeTransport {
	return s.mapper.Transport()
}
func (s *realtimeWireSession) OpenWire(id string) ([]byte, error) {
	return s.mapper.MapOpen(id, s.target, s.open)
}
func realtimeWireEffect(wire []byte, err error) (CloudRealtimeEffect, error) {
	if err != nil {
		return CloudRealtimeEffect{}, err
	}
	if len(wire) == 0 {
		return CloudRealtimeEffect{}, fmt.Errorf("Realtime protocol produced no wire")
	}
	return CloudRealtimeEffect{Wires: [][]byte{wire}}, nil
}
func (s *realtimeWireSession) Input(id string, req *runtimev1.AppendRealtimeInputRequest) (CloudRealtimeEffect, error) {
	wire, err := s.mapper.MapInput(id, req)
	if err != nil {
		return CloudRealtimeEffect{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.open.SelfIntention && req.GetOwnerContext() != nil && s.contextCursor != "" {
		// Insert the freshly compiled prefix before an already committed audio
		// item, preserving the same context-before-user order as typed input.
		var event map[string]any
		if err := json.Unmarshal(wire, &event); err != nil {
			return CloudRealtimeEffect{}, err
		}
		item := event["item"].(map[string]any)
		item["id"] = id
		event["previous_item_id"] = s.contextCursor
		wire, err = json.Marshal(event)
		if err != nil {
			return CloudRealtimeEffect{}, err
		}
		s.contextCursor = id
	}
	return realtimeWireEffect(wire, nil)
}
func (s *realtimeWireSession) OwnerControl(id string, req *runtimev1.SubmitRealtimeOwnerControlRequest) (CloudRealtimeEffect, error) {
	if req != nil && (req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_PAUSE_RESPONSE || req.GetControl() == runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CANCEL_RESPONSE) {
		return s.Interrupt(id, s.CurrentResponseKey())
	}
	s.mu.Lock()
	closed, stopping := s.closed, s.stop != nil
	s.mu.Unlock()
	if closed || stopping {
		return CloudRealtimeEffect{}, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime Session is closed or stopping"))
	}
	effect, err := realtimeWireEffect(s.mapper.MapOwnerControl(id, req))
	if err != nil {
		return effect, err
	}
	s.mu.Lock()
	restore := s.toolsDisabled && s.open.SelfIntention
	s.toolsDisabled = false
	s.mu.Unlock()
	if restore {
		wire, err := s.mapper.SelfIntentionToolsUpdate(id+"_tools", true, s.open.TurnDetection)
		if err != nil {
			return CloudRealtimeEffect{}, err
		}
		effect.Wires = append([][]byte{wire}, effect.Wires...)
	}
	return effect, nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r116
func (s *realtimeWireSession) Interrupt(id, key string) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || key == "" || key != s.responseKey || s.stop != nil {
		return CloudRealtimeEffect{}, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime output track is not current"))
	}
	effect, err := realtimeWireEffect(s.mapper.MapInterrupt(id, key))
	if err != nil {
		return CloudRealtimeEffect{}, err
	}
	s.stop = &realtimeWireStop{key: key, ready: make(chan struct{})}
	effect.AwaitNativeStop, effect.ResponseKey = true, key
	return effect, nil
}
func (s *realtimeWireSession) Normalize(raw []byte) ([]CloudRealtimeEvent, error) {
	s.mu.Lock()
	expected := s.open
	expected.SelfIntention = expected.SelfIntention && !s.toolsDisabled
	s.mu.Unlock()
	// Late repeated native calls still reach the Agent identity fence after
	// tools have been disabled for the sole result response.
	var header struct {
		Type   string `json:"type"`
		ItemID string `json:"item_id"`
		Item   struct {
			ID string `json:"id"`
		} `json:"item"`
	}
	if err := json.Unmarshal(raw, &header); err == nil {
		s.mu.Lock()
		if s.open.SelfIntention && (header.Type == "conversation.item.created" || header.Type == "conversation.item.added" || header.Type == "response.output_item.added") {
			if header.Item.ID != "" {
				found := false
				for _, id := range s.contextItems {
					if id == header.Item.ID {
						found = true
						break
					}
				}
				if !found {
					s.contextItems = append(s.contextItems, header.Item.ID)
				}
			}
		}
		if s.open.SelfIntention && header.Type == "input_audio_buffer.committed" {
			s.pendingAudio = header.ItemID
		}
		if header.Type == "response.created" {
			s.pendingAudio = ""
		}
		s.mu.Unlock()
		if header.Type == "response.function_call_arguments.done" {
			expected.SelfIntention = s.open.SelfIntention
		}
	}
	events, err := s.mapper.NormalizeEvent(raw, expected)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, nil
	}
	output := make([]CloudRealtimeEvent, 0, len(events))
	for _, event := range events {
		isOutput := event.Kind >= CloudRealtimeEventOutputStarted && event.Kind <= CloudRealtimeEventResponseDone
		if stop := s.stop; stop != nil && isOutput && event.ProviderResponseID == stop.key {
			if event.Kind == CloudRealtimeEventResponseDone && !stop.finished {
				stop.result = CloudRealtimeStopResult{Status: event.ResponseStatus, Usage: event.Usage, Observation: "response.done"}
				stop.finished = true
				close(stop.ready)
			}
			continue
		}
		if event.Kind == CloudRealtimeEventOutputStarted {
			if s.responseKey != "" && s.responseKey != event.ProviderResponseID {
				return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("Realtime response overlaps an active output: active=%s incoming=%s", s.responseKey, event.ProviderResponseID))
			}
			s.responseKey = event.ProviderResponseID
		}
		if event.Kind == CloudRealtimeEventResponseDone && event.ProviderResponseID == s.responseKey {
			s.responseKey = ""
		}
		output = append(output, event)
	}
	return output, nil
}

// Replace the execution copy between Agent turns. The new, unanswered audio
// item remains native; canonical history is composed by the Agent owner.
func (s *realtimeWireSession) ResetAgentContext(id string) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.open.SelfIntention || s.closed || s.stop != nil || s.responseKey != "" {
		return CloudRealtimeEffect{}, fmt.Errorf("Agent context is not idle")
	}
	effect := CloudRealtimeEffect{}
	keep := []string{}
	for index, itemID := range s.contextItems {
		if itemID == s.pendingAudio {
			keep = append(keep, itemID)
			continue
		}
		wire, err := json.Marshal(map[string]any{"event_id": fmt.Sprintf("%s_%d", id, index), "type": "conversation.item.delete", "item_id": itemID})
		if err != nil {
			return CloudRealtimeEffect{}, err
		}
		effect.Wires = append(effect.Wires, wire)
	}
	s.contextItems = keep
	s.contextCursor = "root"
	return effect, nil
}

func (s *realtimeWireSession) WaitNativeStop(ctx context.Context, key string) (CloudRealtimeStopResult, error) {
	s.mu.Lock()
	stop := s.stop
	if stop == nil || stop.key != key {
		s.mu.Unlock()
		return CloudRealtimeStopResult{}, cloudInvocationError(CloudInvocationFailureRequest, fmt.Errorf("Realtime native stop is not pending"))
	}
	s.mu.Unlock()
	select {
	case <-ctx.Done():
		return CloudRealtimeStopResult{}, ctx.Err()
	case <-stop.ready:
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.stop == stop {
		s.stop = nil
		s.responseKey = ""
	}
	return stop.result, stop.err
}

func (s *realtimeWireSession) Close() {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	s.responseKey = ""
	if stop := s.stop; stop != nil && !stop.finished {
		stop.err = cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("Realtime Session closed before native stop"))
		stop.finished = true
		close(stop.ready)
	}
}

func (s *realtimeWireSession) CurrentResponseKey() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.responseKey
}
