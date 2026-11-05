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

func stepfunToolsInvocation(t *testing.T) *textbehavior.Invocation {
	t.Helper()
	schema, _ := structpb.NewStruct(map[string]any{"type": "object", "properties": map[string]any{"query": map[string]any{"type": "string"}}, "required": []any{"query"}, "additionalProperties": false})
	profile, err := capabilitydriver.NewStepFunTextBehavior("step-5-preview")
	if err != nil {
		t.Fatal(err)
	}
	adapter, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "stepfun.step-5-preview.chat", Version: "1", RequestSerializerID: "stepfun/step-5-preview/request/v1", NonStreamParserID: "stepfun/step-5-preview/response/v1", StreamAssemblerID: "stepfun/step-5-preview/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected}, profile.Serialize, profile.Parse, profile.Stream)
	if err != nil {
		t.Fatal(err)
	}
	invocation, err := adapter.Bind(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Find the source."}}, Tools: []*runtimev1.ToolSpec{{Kind: runtimev1.ToolSpecKind_TOOL_SPEC_KIND_FUNCTION, Name: "lookup", InputSchema: schema}}, ToolChoice: runtimev1.ToolChoiceMode_TOOL_CHOICE_MODE_AUTO})
	if err != nil {
		t.Fatal(err)
	}
	return invocation
}
func TestStepFunToolsTransportUsesExactModelAndCompleteNativeCall(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var b map[string]any
		if err := json.NewDecoder(r.Body).Decode(&b); err != nil {
			t.Error(err)
		}
		if r.URL.Path != "/proxy/anthropic/v1/chat/completions" || r.Header.Get("Authorization") != "Bearer fixture-key" || b["model"] != "step-5-preview" || b["thinking"] != nil || r.Header.Get("x-api-key") != "" {
			t.Error("target, credential custody or thinking mode changed")
		}
		if b["tool_choice"] != nil || b["stream_options"] != nil {
			t.Error("StepFun auto choice or stream parameters changed")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		for _, event := range []string{
			`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call-1","type":"function","function":{"name":"lookup","arguments":"{\"query\":"}}]},"finish_reason":null}]}`,
			`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"论文\"}"}}]},"finish_reason":"stop"}]}`,
			"[DONE]",
		} {
			if _, err := fmt.Fprintf(w, "data: %s\n\n", event); err != nil {
				t.Errorf("write provider event: %v", err)
				return
			}
		}
	}))
	defer server.Close()
	invocation := stepfunToolsInvocation(t)
	request, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "stepfun", Endpoint: server.URL + "/proxy/anthropic", APIKey: "fixture-key", ProviderModelID: "step-5-preview", AllowLoopback: true}
	var publicCalls int
	result, err := provider.ExecuteTextBehaviorWithTarget(context.Background(), "step-5-preview", target, invocation, request, func(d textbehavior.OrderedDelta) error {
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
func TestStepFunToolsTransportCancellationDoesNotCompletePartialCall(t *testing.T) {
	started := make(chan struct{})
	cancelled := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		if _, err := fmt.Fprint(w, "data: "+`{"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"pending","type":"function","function":{"name":"lookup","arguments":"{"}}]},"finish_reason":null}]}`+"\n\n"); err != nil {
			t.Errorf("write provider response: %v", err)
		}
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(cancelled)
	}))
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	invocation := stepfunToolsInvocation(t)
	request, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	provider := nimillm.NewCloudProvider(nimillm.CloudConfig{})
	target := &nimillm.RemoteTarget{ProviderType: "stepfun", Endpoint: server.URL + "/proxy/anthropic", APIKey: "fixture-key", ProviderModelID: "step-5-preview", AllowLoopback: true}
	ended := make(chan error, 1)
	go func() {
		_, err := provider.ExecuteTextBehaviorWithTarget(ctx, "step-5-preview", target, invocation, request, func(d textbehavior.OrderedDelta) error {
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
