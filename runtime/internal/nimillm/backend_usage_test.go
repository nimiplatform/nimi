package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestChatCompletionUsageReportsThroughSyncAndStream(t *testing.T) {
	for _, test := range []struct {
		name   string
		report any
		want   *runtimev1.UsageStats
	}{
		{name: "absent"},
		{name: "empty", report: map[string]any{}},
		{name: "partial", report: map[string]any{"prompt_tokens": 8}},
		{name: "zero", report: map[string]any{"prompt_tokens": 0, "completion_tokens": 0}, want: &runtimev1.UsageStats{}},
		{name: "reported", report: map[string]any{"prompt_tokens": 3, "completion_tokens": 2}, want: &runtimev1.UsageStats{InputTokens: 3, OutputTokens: 2}},
		{name: "total_without_completion", report: map[string]any{"prompt_tokens": 8, "total_tokens": 20}, want: &runtimev1.UsageStats{InputTokens: 8, OutputTokens: 12}},
		{name: "explicit_zero_completion", report: map[string]any{"prompt_tokens": 8, "completion_tokens": 0, "total_tokens": 20}, want: &runtimev1.UsageStats{InputTokens: 8}},
		{name: "negative", report: map[string]any{"prompt_tokens": -1, "completion_tokens": 2}},
		{name: "non_integer", report: map[string]any{"prompt_tokens": 1.5, "completion_tokens": 2}},
	} {
		for _, stream := range []bool{false, true} {
			mode := "sync"
			if stream {
				mode = "stream"
			}
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					response := map[string]any{"usage": test.report}
					if stream {
						w.Header().Set("Content-Type", "text/event-stream")
						response["choices"] = []any{map[string]any{"delta": map[string]any{"content": "Actual provider text"}, "finish_reason": "stop"}}
						payload, _ := json.Marshal(response)
						_, _ = w.Write(append(append([]byte("data: "), payload...), []byte("\n\ndata: [DONE]\n\n")...))
					} else {
						w.Header().Set("Content-Type", "application/json")
						response["choices"] = []any{map[string]any{"message": map[string]any{"content": "Actual provider text"}, "finish_reason": "stop"}}
						_ = json.NewEncoder(w).Encode(response)
					}
				}))
				defer server.Close()
				backend := NewBackend("cloud-mimo", server.URL, "", time.Second)
				var usage *runtimev1.UsageStats
				var finish runtimev1.FinishReason
				var err error
				input := []*runtimev1.ChatMessage{{Role: "user", Content: "A long input does not define billed tokens."}}
				var output string
				if stream {
					usage, finish, err = backend.StreamGenerateText(context.Background(), "mimo-v2.5", input, "", 0, 0, 0, textGenParams{}, func(delta string) error { output += delta; return nil })
				} else {
					output, _, usage, finish, err = backend.GenerateText(context.Background(), "mimo-v2.5", input, "", 0, 0, 0, textGenParams{})
				}
				if err != nil || output != "Actual provider text" || finish != runtimev1.FinishReason_FINISH_REASON_STOP {
					t.Fatalf("text=%q finish=%s err=%v", output, finish, err)
				}
				if (usage == nil) != (test.want == nil) || usage.GetInputTokens() != test.want.GetInputTokens() || usage.GetOutputTokens() != test.want.GetOutputTokens() || usage.GetComputeMs() != 0 {
					t.Fatalf("usage=%v want=%v", usage, test.want)
				}
			})
		}
	}
}

func TestSpeechArtifactBodyDoesNotEstimateUsageFromContentLength(t *testing.T) {
	audio := bytes.Repeat([]byte{0x52, 0x49, 0x46, 0x46}, 4096)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(audio)
	}))
	defer server.Close()
	backend := NewBackend("generic", server.URL, "", time.Second)
	body, usage, err := backend.SynthesizeSpeechArtifactBody(context.Background(), "speech", &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello from the provider."}, nil)
	if err != nil || body == nil || usage != nil {
		t.Fatalf("body=%v usage=%v err=%v", body, usage, err)
	}
	defer func() {
		if err := body.Body.Close(); err != nil {
			t.Errorf("close speech body: %v", err)
		}
	}()
	got, err := io.ReadAll(body.Body)
	if err != nil || !bytes.Equal(got, audio) {
		t.Fatalf("audio size=%d err=%v", len(got), err)
	}
}

func TestAnthropicStreamKeepsReportedFinishAfterMessageStop(t *testing.T) {
	for _, test := range []struct {
		stop string
		want runtimev1.FinishReason
	}{
		{stop: "max_tokens", want: runtimev1.FinishReason_FINISH_REASON_LENGTH},
		{stop: "end_turn", want: runtimev1.FinishReason_FINISH_REASON_STOP},
	} {
		t.Run(test.stop, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "text/event-stream")
				_, _ = io.WriteString(w, "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"content\":[]}}\n\n")
				_, _ = io.WriteString(w, "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"Provider text\"}}\n\n")
				_, _ = io.WriteString(w, "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\""+test.stop+"\"}}\n\n")
				_, _ = io.WriteString(w, "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n")
			}))
			defer server.Close()
			backend := NewBackend("cloud-anthropic", server.URL, "", time.Second)
			var output string
			_, finish, err := backend.StreamGenerateText(context.Background(), "claude-sonnet-4-6", []*runtimev1.ChatMessage{{Role: "user", Content: "Hello"}}, "", 0, 0, 0, textGenParams{}, func(delta string) error { output += delta; return nil })
			if err != nil || output != "Provider text" || finish != test.want {
				t.Fatalf("text=%q finish=%s want=%s err=%v", output, finish, test.want, err)
			}
		})
	}
}

func TestAnthropicBackendUsagePreservesCacheAndUpdates(t *testing.T) {
	for _, test := range []struct {
		name, report string
		want         *runtimev1.UsageStats
	}{
		{name: "unknown_cache", report: "{\"input_tokens\":7,\"output_tokens\":3}"},
		{name: "partial_cache", report: "{\"input_tokens\":7,\"output_tokens\":3,\"cache_read_input_tokens\":100}"},
		{name: "zero", report: "{\"input_tokens\":0,\"output_tokens\":0,\"cache_creation_input_tokens\":0,\"cache_read_input_tokens\":0}", want: &runtimev1.UsageStats{}},
		{name: "cache", report: "{\"input_tokens\":7,\"output_tokens\":3,\"cache_creation_input_tokens\":11,\"cache_read_input_tokens\":100}", want: &runtimev1.UsageStats{InputTokens: 118, OutputTokens: 3, CachedInputTokens: 100}},
		{name: "negative", report: "{\"input_tokens\":7,\"output_tokens\":3,\"cache_creation_input_tokens\":-1,\"cache_read_input_tokens\":100}"},
	} {
		for _, stream := range []bool{false, true} {
			mode := "sync"
			if stream {
				mode = "stream"
			}
			t.Run(test.name+"/"+mode, func(t *testing.T) {
				var report map[string]any
				if err := json.Unmarshal([]byte(test.report), &report); err != nil {
					t.Fatal(err)
				}
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if !stream {
						w.Header().Set("Content-Type", "application/json")
						_ = json.NewEncoder(w).Encode(map[string]any{"content": []any{map[string]any{"type": "text", "text": "Provider text"}}, "stop_reason": "end_turn", "usage": report})
						return
					}
					w.Header().Set("Content-Type", "text/event-stream")
					send := func(name string, value any) {
						payload, _ := json.Marshal(value)
						_, _ = io.WriteString(w, "event: "+name+"\n"+"data: "+string(payload)+"\n\n")
					}
					initial := map[string]any{"input_tokens": 1, "output_tokens": 0}
					if _, ok := report["cache_creation_input_tokens"]; ok {
						initial["cache_creation_input_tokens"] = 2
					}
					if _, ok := report["cache_read_input_tokens"]; ok {
						initial["cache_read_input_tokens"] = 3
					}
					send("message_start", map[string]any{"message": map[string]any{"usage": initial}})
					send("content_block_delta", map[string]any{"delta": map[string]any{"type": "text_delta", "text": "Provider text"}})
					send("message_delta", map[string]any{"delta": map[string]any{"stop_reason": "end_turn"}, "usage": report})
					send("message_stop", map[string]any{})
				}))
				defer server.Close()
				backend := NewBackend("cloud-anthropic", server.URL, "", time.Second)
				input := []*runtimev1.ChatMessage{{Role: "user", Content: "Hello"}}
				var usage *runtimev1.UsageStats
				var text string
				var err error
				if stream {
					usage, _, err = backend.StreamGenerateText(context.Background(), "claude-sonnet-4-6", input, "", 0, 0, 0, textGenParams{}, func(delta string) error { text += delta; return nil })
				} else {
					text, _, usage, _, err = backend.GenerateText(context.Background(), "claude-sonnet-4-6", input, "", 0, 0, 0, textGenParams{})
				}
				if err != nil || text != "Provider text" {
					t.Fatalf("text=%q err=%v", text, err)
				}
				if (usage == nil) != (test.want == nil) || usage.GetInputTokens() != test.want.GetInputTokens() || usage.GetOutputTokens() != test.want.GetOutputTokens() || usage.GetCachedInputTokens() != test.want.GetCachedInputTokens() {
					t.Fatalf("usage=%v want=%v", usage, test.want)
				}
			})
		}
	}
}
