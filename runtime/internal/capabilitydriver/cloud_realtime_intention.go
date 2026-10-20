package capabilitydriver

import (
	"encoding/json"
	"fmt"

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
	disable, err := s.mapper.SelfIntentionToolsUpdate(id+"_tools", false)
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
		tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": tool["name"], "description": tool["description"], "parameters": tool["parameters"]}}
	}
	return tools
}

func (d openAIRealtimeDriver) SelfIntentionToolsUpdate(id string, enabled bool) ([]byte, error) {
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{"type": "realtime", "tools": d.SelfIntentionTools(enabled)}})
}
func (d dashScopeRealtimeDriver) SelfIntentionToolsUpdate(id string, enabled bool) ([]byte, error) {
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{"tools": d.SelfIntentionTools(enabled)}})
}
