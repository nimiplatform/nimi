package capabilitydriver

import (
	"encoding/json"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestAgentContextReplacementKeepsOnlyUnansweredNativeAudio(t *testing.T) {
	for name, mapper := range map[string]realtimeWireMapper{"openai": openAIRealtimeDriver{}, "dashscope": dashScopeRealtimeDriver{}} {
		t.Run(name, func(t *testing.T) {
			s := newRealtimeWireSession(mapper, CloudRealtimeTarget{}, CloudRealtimeOpen{SelfIntention: true}).(*realtimeWireSession)
			for _, raw := range []string{
				`{"type":"conversation.item.added","item":{"id":"old-context"}}`,
				`{"type":"conversation.item.created","item":{"id":"old-user"}}`,
				`{"type":"response.output_item.added","item":{"id":"old-reply"}}`,
				`{"type":"conversation.item.created","item":{"id":"old-reply"}}`,
				`{"type":"input_audio_buffer.committed","item_id":"current-audio"}`,
				`{"type":"conversation.item.created","item":{"id":"current-audio"}}`,
			} {
				if _, err := s.Normalize([]byte(raw)); err != nil {
					t.Fatal(err)
				}
			}
			effect, err := s.ResetAgentContext("replace")
			if err != nil || len(effect.Wires) != 3 {
				t.Fatalf("%+v %v", effect, err)
			}
			for _, wire := range effect.Wires {
				var value map[string]any
				if json.Unmarshal(wire, &value) != nil || value["type"] != "conversation.item.delete" || value["item_id"] == "current-audio" {
					t.Fatalf("%s", wire)
				}
			}
			if _, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"new-response"}}`)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.ResetAgentContext("busy"); err == nil {
				t.Fatal("deleted active response context")
			}
			if _, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"new-response","status":"completed"}}`)); err != nil {
				t.Fatal(err)
			}
			effect, err = s.ResetAgentContext("after")
			if err != nil || len(effect.Wires) != 1 {
				t.Fatalf("answered audio retained: %+v %v", effect, err)
			}
		})
	}
}

func TestAgentContextPrefixPrecedesCommittedAudioInBothDrivers(t *testing.T) {
	for name, mapper := range map[string]realtimeWireMapper{"openai": openAIRealtimeDriver{}, "dashscope": dashScopeRealtimeDriver{}} {
		t.Run(name, func(t *testing.T) {
			s := newRealtimeWireSession(mapper, CloudRealtimeTarget{}, CloudRealtimeOpen{SelfIntention: true}).(*realtimeWireSession)
			_, _ = s.Normalize([]byte(`{"type":"input_audio_buffer.committed","item_id":"audio"}`))
			if _, err := s.ResetAgentContext("reset"); err != nil {
				t.Fatal(err)
			}
			for index, id := range []string{"context-one", "context-two"} {
				effect, err := s.Input(id, &runtimev1.AppendRealtimeInputRequest{
					Input: &runtimev1.AppendRealtimeInputRequest_OwnerContext{OwnerContext: &runtimev1.AiRealtimeOwnerContextInput{Kind: runtimev1.AiRealtimeOwnerContextKind_AI_REALTIME_OWNER_CONTEXT_KIND_CONTEXT, Text: "Current canonical context"}},
				})
				if err != nil {
					t.Fatal(err)
				}
				var wire map[string]any
				if err := json.Unmarshal(effect.Wires[0], &wire); err != nil {
					t.Fatal(err)
				}
				want := "root"
				if index > 0 {
					want = "context-one"
				}
				if wire["previous_item_id"] != want || wire["item"].(map[string]any)["id"] != id || s.pendingAudio != "audio" {
					t.Fatalf("context order or native audio lost: %s", effect.Wires[0])
				}
			}
		})
	}
}
