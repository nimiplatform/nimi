package capabilitydriver

import (
	"encoding/json"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/agentintent"
)

// Only the private Agent composition can install the fixed native function.
type CloudRealtimeSelfIntentionProtocol interface {
	SelfIntentionResult(string, string, string) (CloudRealtimeEffect, error)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.r115
func (s *realtimeWireSession) SelfIntentionResult(id, callID, result string) (CloudRealtimeEffect, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.open.SelfIntention || s.closed || s.stop != nil || s.responseKey != "" || callID == "" || len(result) > 4096 {
		return CloudRealtimeEffect{}, fmt.Errorf("self-intention result is not current")
	}
	output, err := json.Marshal(map[string]any{"event_id": id + "_result", "type": "conversation.item.create", "item": map[string]any{"type": "function_call_output", "call_id": callID, "output": result}})
	if err != nil {
		return CloudRealtimeEffect{}, err
	}
	disable, err := s.mapper.SelfIntentionToolsUpdate(id+"_tools", false, s.open.TurnDetection)
	if err != nil {
		return CloudRealtimeEffect{}, err
	}
	continuation, _ := json.Marshal(map[string]any{"event_id": id, "type": "response.create"})
	s.toolsDisabled = true
	return CloudRealtimeEffect{Wires: [][]byte{output, disable, continuation}}, nil
}

func normalizeSelfIntention(event cloudRealtimeServerEvent, enabled bool) (CloudRealtimeEvent, error) {
	if !enabled || event.Name != agentintent.FunctionName || event.CallID == "" || len(event.CallID) > 256 || event.ResponseID == "" {
		return CloudRealtimeEvent{}, fmt.Errorf("invalid private self-intention call")
	}
	return CloudRealtimeEvent{Kind: CloudRealtimeEventSelfIntention, ProviderResponseID: event.ResponseID, ProviderItemID: event.ItemID, CallID: event.CallID, Text: event.Arguments}, nil
}

func (openAIRealtimeDriver) SelfIntentionTools(enabled bool) []any {
	return agentintent.NativeTools(enabled)
}
func (dashScopeRealtimeDriver) SelfIntentionTools(enabled bool) []any {
	tools := agentintent.NativeTools(enabled)
	for i, raw := range tools {
		tool := raw.(map[string]any)
		// DashScope's native configuration keeps an object parameter's type
		// and description but drops its nested property definitions. Keep the
		// same private object contract readable at that supported field level.
		properties := tool["parameters"].(map[string]any)["properties"].(map[string]any)
		properties["experience"].(map[string]any)["description"] = "Required for change/abandon; omit for adopt. JSON object with required action (create, practice, explore, reflect), object (specific own work or subject, at most 80 characters), and result (direction_changed for change; abandoned for abandon). Optional outcome describes the concrete change, at most 160 characters. No other fields."
		tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": tool["name"], "description": tool["description"], "parameters": tool["parameters"]}}
	}
	return tools
}

func (d openAIRealtimeDriver) SelfIntentionToolsUpdate(id string, enabled bool, _ runtimev1.AiRealtimeTurnDetectionMode) ([]byte, error) {
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{"type": "realtime", "tools": d.SelfIntentionTools(enabled)}})
}
func (d dashScopeRealtimeDriver) SelfIntentionToolsUpdate(id string, enabled bool, mode runtimev1.AiRealtimeTurnDetectionMode) ([]byte, error) {
	detection, err := dashScopeRealtimeTurnDetection(mode)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{"tools": d.SelfIntentionTools(enabled), "turn_detection": detection}})
}
