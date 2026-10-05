package capabilitydriver

import (
	"context"
	"fmt"

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
	mapper realtimeWireMapper
	target CloudRealtimeTarget
	open   CloudRealtimeOpen
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
	return realtimeWireEffect(s.mapper.MapOwnerControl(id, req))
}
func (s *realtimeWireSession) Interrupt(id, key string) (CloudRealtimeEffect, error) {
	return realtimeWireEffect(s.mapper.MapInterrupt(id, key))
}
func (s *realtimeWireSession) Normalize(raw []byte) ([]CloudRealtimeEvent, error) {
	return s.mapper.NormalizeEvent(raw, s.open)
}
func (s *realtimeWireSession) WaitNativeStop(context.Context, string) (CloudRealtimeStopResult, error) {
	return CloudRealtimeStopResult{}, fmt.Errorf("Realtime protocol has no deferred stop")
}
func (*realtimeWireSession) Close() {}

func (*realtimeWireSession) CurrentResponseKey() string { return "" }
