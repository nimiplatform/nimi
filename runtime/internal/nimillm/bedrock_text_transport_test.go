package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws/protocol/eventstream"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

func bedrockClaudeInvocation(t *testing.T) *textbehavior.Invocation {
	t.Helper()
	p, err := capabilitydriver.NewBedrockClaudeBehavior("anthropic.claude-sonnet-5-5")
	if err != nil {
		t.Fatal(err)
	}
	a, err := textbehavior.NewAdapter(textbehavior.AdapterCapture{AdapterID: "bedrock.sonnet55.invoke", Version: "1", RequestSerializerID: "bedrock/sonnet55/request/v1", NonStreamParserID: "bedrock/sonnet55/response/v1", StreamAssemblerID: "bedrock/sonnet55/stream/v1", ProcessIdentityImpact: textbehavior.ProcessIdentityUnaffected}, p.Serialize, p.Parse, p.Stream)
	if err != nil {
		t.Fatal(err)
	}
	invocation, err := a.Bind(&runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "Reply with a greeting."}}})
	if err != nil {
		t.Fatal(err)
	}
	return invocation
}

func bedrockEncodedChunk(t *testing.T, raw string) []byte {
	t.Helper()
	payload, _ := json.Marshal(map[string]string{"bytes": base64.StdEncoding.EncodeToString([]byte(raw))})
	var b bytes.Buffer
	msg := eventstream.Message{Headers: eventstream.Headers{{Name: ":message-type", Value: eventstream.StringValue("event")}, {Name: ":event-type", Value: eventstream.StringValue("chunk")}, {Name: ":content-type", Value: eventstream.StringValue("application/json")}}, Payload: payload}
	if err := eventstream.NewEncoder().Encode(&b, msg); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func TestBedrockInvokeUsesNativeBinaryStreamAndRejectsDamagedOrIncompleteOutput(t *testing.T) {
	events := []string{
		`{"type":"message_start","message":{"content":[],"usage":{"input_tokens":10,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}`,
		`{"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}`,
		`{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}`,
		`{"type":"content_block_stop","index":0}`,
		`{"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}`,
		`{"type":"message_stop"}`,
	}
	for _, mode := range []string{"complete", "missing terminal", "bad crc", "nonstream"} {
		t.Run(mode, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body map[string]any
				_ = json.NewDecoder(r.Body).Decode(&body)
				path := "/model/us.anthropic.claude-sonnet-5-5/invoke"
				if mode != "nonstream" {
					path += "-with-response-stream"
				}
				if r.Method != "POST" || r.URL.Path != path || r.Header.Get("Authorization") != "Bearer selected-key" || r.Header.Get("x-api-key") != "" || body["model"] != nil || body["stream"] != nil || body["anthropic_version"] != "bedrock-2023-05-31" {
					t.Error("incorrect native Invoke transport", r.URL.Path, body)
				}
				if mode == "nonstream" {
					w.Header().Set("Content-Type", "application/json")
					_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"Hello"}],"stop_reason":"end_turn","usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}`))
					return
				}
				w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
				for i, raw := range events {
					if mode == "missing terminal" && i == len(events)-1 {
						break
					}
					chunk := bedrockEncodedChunk(t, raw)
					if mode == "bad crc" && i == 0 {
						chunk[len(chunk)-1] ^= 0xff
					}
					_, _ = w.Write(chunk)
				}
			}))
			defer server.Close()
			invocation := bedrockClaudeInvocation(t)
			request, err := invocation.Serialize(mode != "nonstream")
			if err != nil {
				t.Fatal(err)
			}
			target := &RemoteTarget{ProviderType: "bedrock", ProviderModelID: "anthropic.claude-sonnet-5-5", BedrockInvocationModelID: "us.anthropic.claude-sonnet-5-5", Endpoint: server.URL, APIKey: "selected-key", AllowLoopback: true}
			var onDelta func(textbehavior.OrderedDelta) error
			if mode != "nonstream" {
				onDelta = func(textbehavior.OrderedDelta) error { return nil }
			}
			result, err := NewCloudProvider(CloudConfig{}).ExecuteTextBehaviorWithTarget(context.Background(), target.ProviderModelID, target, invocation, request, onDelta)
			if mode == "complete" || mode == "nonstream" {
				if err != nil || len(result.Items) != 1 || result.Items[0].Text != "Hello" || result.Usage.GetOutputTokens() != 2 {
					t.Fatal(result, err)
				}
			} else if err == nil {
				t.Fatal("invalid stream became success", mode)
			}
		})
	}
}

func TestBedrockBinaryStreamCancellationUnblocksFrameRead(t *testing.T) {
	started, closed := make(chan struct{}), make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/vnd.amazon.eventstream")
		frame := bedrockEncodedChunk(t, `{"type":"message_start","message":{"content":[],"usage":{"input_tokens":10,"output_tokens":1,"cache_creation_input_tokens":0,"cache_read_input_tokens":0}}}`)
		_, _ = w.Write(frame[:len(frame)-2])
		w.(http.Flusher).Flush()
		close(started)
		<-r.Context().Done()
		close(closed)
	}))
	defer server.Close()
	invocation := bedrockClaudeInvocation(t)
	request, err := invocation.Serialize(true)
	if err != nil {
		t.Fatal(err)
	}
	target := &RemoteTarget{ProviderType: "bedrock", ProviderModelID: "anthropic.claude-sonnet-5-5", BedrockInvocationModelID: "us.anthropic.claude-sonnet-5-5", Endpoint: server.URL, APIKey: "selected-key", AllowLoopback: true}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	ended := make(chan error, 1)
	go func() {
		_, err := NewCloudProvider(CloudConfig{}).ExecuteTextBehaviorWithTarget(ctx, target.ProviderModelID, target, invocation, request, func(textbehavior.OrderedDelta) error { t.Error("partial frame published"); return nil })
		ended <- err
	}()
	select {
	case <-started:
	case <-time.After(3 * time.Second):
		t.Fatal("native request did not start")
	}
	cancel()
	select {
	case err := <-ended:
		if err == nil {
			t.Fatal("cancelled stream succeeded")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("decoder ignored cancellation")
	}
	select {
	case <-closed:
	case <-time.After(3 * time.Second):
		t.Fatal("HTTP request remained active")
	}
}
