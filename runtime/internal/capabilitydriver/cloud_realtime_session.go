package capabilitydriver

import (
	"context"
	"fmt"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type CloudRealtimeTransport struct {
	Endpoint     string
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
	Endpoint(CloudRealtimeTarget) string
	MapOpen(string, CloudRealtimeTarget, CloudRealtimeOpen) ([]byte, error)
	MapInput(string, *runtimev1.AppendRealtimeInputRequest) ([]byte, error)
	MapOwnerControl(string, *runtimev1.SubmitRealtimeOwnerControlRequest) ([]byte, error)
	MapInterrupt(string, string) ([]byte, error)
	NormalizeEvent([]byte, CloudRealtimeOpen) ([]CloudRealtimeEvent, error)
}

type realtimeWireSession struct {
	mapper      realtimeWireMapper
	target      CloudRealtimeTarget
	open        CloudRealtimeOpen
	mu          sync.Mutex
	responseKey string
	stop        *realtimeWireStop
	closed      bool
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
	return CloudRealtimeTransport{Endpoint: s.mapper.Endpoint(s.target), ModelQuery: true}
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
	return realtimeWireEffect(s.mapper.MapInput(id, req))
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
	return realtimeWireEffect(s.mapper.MapOwnerControl(id, req))
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
	events, err := s.mapper.NormalizeEvent(raw, s.open)
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
				return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("Realtime response overlaps an active output"))
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
