package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestPrivateSelfIntentionNativeRoundTripOnBothWireDrivers(t *testing.T) {
	for name, mapper := range map[string]realtimeWireMapper{"openai": openAIRealtimeDriver{}, "dashscope": dashScopeRealtimeDriver{}} {
		t.Run(name, func(t *testing.T) {
			tools := mapper.SelfIntentionTools(true)
			definition := tools[0].(map[string]any)
			if name == "dashscope" {
				definition = definition["function"].(map[string]any)
			}
			if definition["name"] != "nimi_self_intention" || definition["parameters"] == nil {
				t.Fatal("provider-native function schema missing")
			}
			s := newRealtimeWireSession(mapper, CloudRealtimeTarget{}, CloudRealtimeOpen{SelfIntention: true})
			_, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"response-a"}}`))
			if err != nil {
				t.Fatal(err)
			}
			ignored, err := s.Normalize([]byte(`{"type":"response.function_call_arguments.done","response_id":"response-a","call_id":"unrecognized","name":"not_an_admitted_function","arguments":"{}"}`))
			if err != nil || len(ignored) != 0 {
				t.Fatal("unrecognized optional function interrupted the native session")
			}
			call := []byte(`{"type":"response.function_call_arguments.done","response_id":"response-a","item_id":"item-a","call_id":"call-a","name":"nimi_self_intention","arguments":"{\"action\":\"abandon\",\"activity_ref\":\"drawing\"}"}`)
			events, err := s.Normalize(call)
			if err != nil || len(events) != 1 || events[0].CallID != "call-a" || events[0].Kind != CloudRealtimeEventSelfIntention {
				t.Fatalf("call mapping: %+v %v", events, err)
			}
			private := s.(CloudRealtimeSelfIntentionProtocol)
			if _, err := private.SelfIntentionResult("result", "call-a", `{"accepted":true}`); err == nil {
				t.Fatal("result preceded native response terminal")
			}
			_, err = s.Normalize([]byte(`{"type":"response.done","response":{"id":"response-a","status":"completed"}}`))
			if err != nil {
				t.Fatal(err)
			}
			effect, err := private.SelfIntentionResult("result", "call-a", `{"accepted":false}`)
			if err != nil || len(effect.Wires) != 3 {
				t.Fatalf("result wires: %+v %v", effect, err)
			}
			for i, kind := range []string{"conversation.item.create", "session.update", "response.create"} {
				var wire map[string]any
				if json.Unmarshal(effect.Wires[i], &wire) != nil || wire["type"] != kind {
					t.Fatalf("wire order %s", effect.Wires[i])
				}
				if kind == "session.update" && name == "openai" && wire["session"].(map[string]any)["type"] != "realtime" {
					t.Fatal("OpenAI session update omitted its required type")
				}
				if _, ok := wire["tool_choice"]; ok {
					t.Fatal("unsupported shared tool choice")
				}
			}
			if duplicates, err := s.Normalize(call); err != nil || len(duplicates) != 1 || duplicates[0].CallID != "call-a" {
				t.Fatal("late duplicate cannot reach the Agent call identity fence")
			}
			effect, err = s.OwnerControl("next", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE})
			if err != nil || len(effect.Wires) != 2 {
				t.Fatal("next genuine user response did not restore optional function")
			}
		})
	}
}
