package capabilitydriver

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestWireRealtimeStopRequiresExactNativeTerminalAndAllowsSameSessionContinue(t *testing.T) {
	for name, mapper := range map[string]realtimeWireMapper{"openai": openAIRealtimeDriver{}, "dashscope": dashScopeRealtimeDriver{}} {
		t.Run(name, func(t *testing.T) {
			s := newRealtimeWireSession(mapper, CloudRealtimeTarget{}, CloudRealtimeOpen{})
			defer s.Close()
			if _, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"response-a"}}`)); err != nil {
				t.Fatal(err)
			}
			effect, err := s.Interrupt("cancel-a", "response-a")
			if err != nil || !effect.AwaitNativeStop || effect.ResponseKey != "response-a" {
				t.Fatalf("stop effect=%+v err=%v", effect, err)
			}
			var wire map[string]any
			if json.Unmarshal(effect.Wires[0], &wire) != nil || wire["type"] != "response.cancel" || wire["response_id"] != "response-a" {
				t.Fatalf("cancel wire=%s", effect.Wires[0])
			}
			ctx, cancel := context.WithTimeout(context.Background(), time.Second)
			defer cancel()
			done := make(chan CloudRealtimeStopResult, 1)
			errors := make(chan error, 1)
			go func() { result, err := s.WaitNativeStop(ctx, "response-a"); done <- result; errors <- err }()
			select {
			case <-done:
				t.Fatal("wire dispatch fabricated native success")
			default:
			}
			if _, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"foreign","status":"cancelled"}}`)); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
				t.Fatal("foreign terminal confirmed this stop")
			default:
			}
			audioType := "response.output_audio.delta"
			if name == "dashscope" {
				audioType = "response.audio.delta"
			}
			late := realtimeJSON(map[string]any{"type": audioType, "response_id": "response-a", "delta": "AQI="})
			if events, err := s.Normalize(late); err != nil || len(events) != 0 {
				t.Fatalf("draining audio escaped: %+v %v", events, err)
			}
			if events, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"response-a","status":"cancelled"}}`)); err != nil || len(events) != 0 {
				t.Fatalf("stop terminal bypassed owner: %+v %v", events, err)
			}
			if result := <-done; result.Status != CloudRealtimeResponseStatusCancelled || result.Usage != nil {
				t.Fatalf("native stop=%+v", result)
			}
			if err := <-errors; err != nil {
				t.Fatal(err)
			}
			if s.CurrentResponseKey() != "" {
				t.Fatal("interrupted response remains current")
			}
			continued, err := s.OwnerControl("continue", &runtimev1.SubmitRealtimeOwnerControlRequest{Control: runtimev1.AiRealtimeOwnerControlKind_AI_REALTIME_OWNER_CONTROL_KIND_CONTINUE_RESPONSE})
			if err != nil || len(continued.Wires) != 1 || continued.AwaitNativeStop {
				t.Fatalf("same-session continue=%+v %v", continued, err)
			}
			if _, err := s.Normalize([]byte(`{"type":"response.created","response":{"id":"response-b"}}`)); err != nil {
				t.Fatal(err)
			}
			if _, err := s.Interrupt("stale", "response-a"); err == nil {
				t.Fatal("stale track canceled the new response")
			}
		})
	}
}

func TestWireRealtimeNativeCompletionRaceIsNotInventedCancellation(t *testing.T) {
	s := newRealtimeWireSession(openAIRealtimeDriver{}, CloudRealtimeTarget{}, CloudRealtimeOpen{})
	defer s.Close()
	_, _ = s.Normalize([]byte(`{"type":"response.created","response":{"id":"response-a"}}`))
	if _, err := s.Interrupt("cancel", "response-a"); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"response-a","status":"completed"}}`)); err != nil {
		t.Fatal(err)
	}
	result, err := s.WaitNativeStop(context.Background(), "response-a")
	if err != nil || result.Status != CloudRealtimeResponseStatusCompleted {
		t.Fatalf("completion race=%+v %v", result, err)
	}
}

func TestWireRealtimeCloseAndCallerCancellationReleaseUnconfirmedStop(t *testing.T) {
	s := newRealtimeWireSession(openAIRealtimeDriver{}, CloudRealtimeTarget{}, CloudRealtimeOpen{})
	_, _ = s.Normalize([]byte(`{"type":"response.created","response":{"id":"response-a"}}`))
	if _, err := s.Interrupt("cancel", "response-a"); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if result, err := s.WaitNativeStop(ctx, "response-a"); err == nil || result.Status == CloudRealtimeResponseStatusCancelled {
		t.Fatalf("caller cancellation fabricated native stop: %+v %v", result, err)
	}
	s.Close()
	if _, err := s.WaitNativeStop(context.Background(), "response-a"); err == nil {
		t.Fatal("Close fabricated a native stop")
	}
	if events, err := s.Normalize([]byte(`{"type":"response.done","response":{"id":"response-a","status":"cancelled"}}`)); err != nil || len(events) != 0 {
		t.Fatalf("closed Session delivered events: %+v %v", events, err)
	}
}
