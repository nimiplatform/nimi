package capabilitydriver

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestDashScopeExperienceShapeSurvivesShallowToolProjection(t *testing.T) {
	dash := (dashScopeRealtimeDriver{}).SelfIntentionTools(true)[0].(map[string]any)["function"].(map[string]any)
	openAI := (openAIRealtimeDriver{}).SelfIntentionTools(true)[0].(map[string]any)
	dashProperties := dash["parameters"].(map[string]any)["properties"].(map[string]any)
	openProperties := openAI["parameters"].(map[string]any)["properties"].(map[string]any)
	experience := dashProperties["experience"].(map[string]any)
	description, _ := experience["description"].(string)
	// The actual provider config retains type/description, but omits the
	// nested properties. These are the existing object's required semantics.
	for _, term := range []string{"change", "abandon", "adopt", "action", "object", "result", "outcome", "create", "practice", "explore", "reflect", "direction_changed", "abandoned", "80", "160"} {
		if !strings.Contains(description, term) {
			t.Fatalf("shallow tool definition loses experience field %q", term)
		}
	}
	delete(experience, "description")
	if !reflect.DeepEqual(experience, openProperties["experience"]) {
		t.Fatal("DashScope description changed the canonical nested contract")
	}
	if !reflect.DeepEqual(dash["parameters"].(map[string]any)["required"], openAI["parameters"].(map[string]any)["required"]) {
		t.Fatal("optional experience became required for every action")
	}
	if len((dashScopeRealtimeDriver{}).SelfIntentionTools(false)) != 0 {
		t.Fatal("description enabled an unrequested private tool")
	}
}

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
			s := newRealtimeWireSession(mapper, CloudRealtimeTarget{}, CloudRealtimeOpen{SelfIntention: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL})
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

func TestNativeOutputMetadataDoesNotInferOrReplayAnIntention(t *testing.T) {
	for name, mapper := range map[string]realtimeWireMapper{"openai": openAIRealtimeDriver{}, "dashscope": dashScopeRealtimeDriver{}} {
		t.Run(name, func(t *testing.T) {
			for _, sample := range []struct {
				output string
				want   []string
			}{
				{"", nil}, {`,"output":[]`, []string{}},
				{`,"output":[{"type":"message","content":[{"text":"I have changed my intention"}]}]`, []string{"message"}},
				{`,"output":[{"type":"function_call","name":"nimi_self_intention","arguments":"{}"}]`, []string{"function_call"}},
			} {
				raw := []byte(`{"type":"response.done","response":{"id":"r","status":"completed"` + sample.output + `}}`)
				events, err := mapper.NormalizeEvent(raw, CloudRealtimeOpen{SelfIntention: true})
				if err != nil || len(events) != 1 || events[0].Kind != CloudRealtimeEventResponseDone || !reflect.DeepEqual(events[0].OutputTypes, sample.want) {
					t.Fatalf("metadata became an effect or lost its presence: %+v %v", events, err)
				}
			}
		})
	}
}

func TestDashScopeToolTogglePreservesCapturedTurnDetection(t *testing.T) {
	for _, mode := range []runtimev1.AiRealtimeTurnDetectionMode{
		runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL,
		runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD,
	} {
		s := newRealtimeWireSession(dashScopeRealtimeDriver{}, CloudRealtimeTarget{}, CloudRealtimeOpen{SelfIntention: true, TurnDetection: mode})
		effect, err := s.(CloudRealtimeSelfIntentionProtocol).SelfIntentionResult("result", "call", `{"accepted":false}`)
		if err != nil {
			t.Fatal(err)
		}
		check := func(raw []byte) {
			t.Helper()
			var wire struct {
				Session map[string]any `json:"session"`
			}
			if err := json.Unmarshal(raw, &wire); err != nil {
				t.Fatal(err)
			}
			detection, present := wire.Session["turn_detection"]
			if !present {
				t.Fatal("tool update lets DashScope restore default VAD")
			}
			if mode == runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
				if detection != nil {
					t.Fatal("manual input became VAD")
				}
			} else {
				vad, ok := detection.(map[string]any)
				if !ok || vad["type"] != "server_vad" || vad["create_response"] != false {
					t.Fatal("VAD can start a response before the Agent owner")
				}
			}
		}
		check(effect.Wires[1])
		next, err := s.OwnerControl("next", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_START_RESPONSE})
		if err != nil {
			t.Fatal(err)
		}
		check(next.Wires[0])
	}
}
