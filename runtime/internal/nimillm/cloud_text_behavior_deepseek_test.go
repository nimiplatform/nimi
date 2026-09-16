package nimillm_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestDeepseekJSONUsesExistingCredentialHostAndExactChatPath(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" {
			t.Errorf("unexpected request path or credential header")
		}
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid request JSON")
		}
		if body["model"] != "deepseek-v4-flash" || body["thinking"].(map[string]any)["type"] != "disabled" {
			t.Error("captured target or behavior was lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprintln(w, `data: {"choices":[{"index":0,"delta":{"content":"{\"ok\":true}"},"finish_reason":"stop"}]}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, `data: {"choices":[],"usage":{"prompt_tokens":7,"completion_tokens":4}}`)
		fmt.Fprintln(w)
		fmt.Fprintln(w, "data: [DONE]")
		fmt.Fprintln(w)
	}))
	defer server.Close()
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "deepseek.v4-flash.chat", Version: "2", RequestSerializerID: "deepseek/chat/request/v2", NonStreamParserID: "deepseek/chat/response/v2", StreamAssemblerID: "deepseek/chat/stream/v2", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected},
		capabilitydriver.DeepseekChatRequestSerializer, capabilitydriver.DeepseekChatNonStreamParser, capabilitydriver.DeepseekChatStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Return JSON."}}, ResponseFormat: &runtimev1.ResponseFormat{Kind: runtimev1.ResponseFormatKind_RESPONSE_FORMAT_KIND_JSON_OBJECT}}
	invocation, err := adapter.Bind(spec)
	if err != nil {
		t.Fatal(err)
	}
	payload, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "deepseek", Endpoint: server.URL + "/v1", APIKey: "fixture-key", ProviderModelID: "deepseek-v4-flash", AllowLoopback: true}
	text := ""
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "deepseek-v4-flash", target, invocation, payload, func(delta textbehavior.OrderedDelta) error { text += delta.Text; return nil })
	if err != nil {
		t.Fatal(err)
	}
	if text != `{"ok":true}` || result.Usage.GetOutputTokens() != 4 {
		t.Fatalf("result=%+v text=%q", result, text)
	}
}

func deepseekToolsInvocation(t *testing.T) *textbehavior.Invocation {
	t.Helper()
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}, "required": []any{"query"}, "additionalProperties": false})
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "deepseek.flash.chat", Version: "2", RequestSerializerID: "deepseek/chat/request/v2", NonStreamParserID: "deepseek/chat/response/v2", StreamAssemblerID: "deepseek/chat/stream/v2", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected}, capabilitydriver.DeepseekChatRequestSerializer, capabilitydriver.DeepseekChatNonStreamParser, capabilitydriver.DeepseekChatStreamAssembler)
	if err != nil {
		t.Fatal(err)
	}
	invocation, err := adapter.Bind(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Find the source."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_TOOL, ToolChoiceName: "lookup"})
	if err != nil {
		t.Fatal(err)
	}
	return invocation
}
func TestDeepseekToolsTransportUsesExactModelAndCompleteNativeCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" || b["model"] != "deepseek-flash" || b["thinking"].(map[string]any)["type"] != "disabled" {
			t.Error("target, credential custody or thinking mode changed")
		}
		if b["tool_choice"].(map[string]any)["function"].(map[string]any)["name"] != "lookup" {
			t.Error("named tool lost")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: "+`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"query\":"}}]},"finish_reason":null}]}`+"\n\n")
		fmt.Fprint(w, "data: "+`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"论文\"}"}}]},"finish_reason":"tool_calls"}]}`+"\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()
	invocation := deepseekToolsInvocation(t)
	request, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "deepseek", Endpoint: server.URL + "/v1", APIKey: "fixture-key", ProviderModelID: "deepseek-flash", AllowLoopback: true}
	var publicCalls int
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "deepseek-flash", target, invocation, request, func(d textbehavior.OrderedDelta) error {
		if d.ToolCall != nil {
			publicCalls++
			if !d.ItemCompleted || d.ToolCall.ArgumentsJson != `{"query":"论文"}` {
				t.Error("partial tool emitted")
			}
		}
		return nil
	})
	if err != nil || publicCalls != 1 || result.FinishReason != runtimev1.FinishReason_FINISH_REASON_TOOL_CALL {
		t.Fatalf("result=%+v calls=%d err=%v", result, publicCalls, err)
	}
}
func TestDeepseekToolsTransportCancellationDoesNotCompletePartialCall(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: "+`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"pending","type":"function","function":{"name":"lookup","arguments":"{"}}]},"finish_reason":null}]}`+"\n\n")
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	invocation := deepseekToolsInvocation(t)
	request, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "deepseek", Endpoint: server.URL + "/v1", APIKey: "fixture-key", ProviderModelID: "deepseek-flash", AllowLoopback: true}
	ended := make(chan error, 1)
	go func() {
		_, err := provider.ExecuteTextBehaviorWithTarget(ctx, "deepseek-flash", target, invocation, request, func(d textbehavior.OrderedDelta) error {
			if d.ToolCall != nil {
				t.Error("cancelled partial call published")
			}
			return nil
		})
		ended <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("provider request not started")
	}
	cancel()
	select {
	case err := <-ended:
		if err == nil {
			t.Fatal("cancellation became success")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("cancellation did not terminate")
	}
	select {
	case <-cancelled:
	case <-time.After(3 * time.Second):
		t.Fatal("upstream request left active")
	}
}
