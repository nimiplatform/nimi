package ai

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestCloudProviderPickBackend(t *testing.T) {
	p := &cloudProvider{
		litellm:   &openAIBackend{name: "litellm"},
		alibaba:   &openAIBackend{name: "alibaba"},
		bytedance: &openAIBackend{name: "bytedance"},
	}

	type tc struct {
		modelID       string
		wantBackend   string
		wantModelID   string
		wantExplicit  bool
		wantAvailable bool
	}
	cases := []tc{
		{modelID: "litellm/gpt-4o", wantBackend: "litellm", wantModelID: "gpt-4o", wantExplicit: true, wantAvailable: true},
		{modelID: "aliyun/qwen-max", wantBackend: "alibaba", wantModelID: "qwen-max", wantExplicit: true, wantAvailable: true},
		{modelID: "alibaba/qwen-plus", wantBackend: "alibaba", wantModelID: "qwen-plus", wantExplicit: true, wantAvailable: true},
		{modelID: "bytedance/deepseek-v3", wantBackend: "bytedance", wantModelID: "deepseek-v3", wantExplicit: true, wantAvailable: true},
		{modelID: "gpt-4o-mini", wantBackend: "litellm", wantModelID: "gpt-4o-mini", wantExplicit: false, wantAvailable: true},
	}

	for _, item := range cases {
		backend, resolved, explicit, available := p.pickBackend(item.modelID)
		if resolved != item.wantModelID {
			t.Fatalf("%s resolved model mismatch: got=%s want=%s", item.modelID, resolved, item.wantModelID)
		}
		if explicit != item.wantExplicit {
			t.Fatalf("%s explicit mismatch: got=%v want=%v", item.modelID, explicit, item.wantExplicit)
		}
		if available != item.wantAvailable {
			t.Fatalf("%s available mismatch: got=%v want=%v", item.modelID, available, item.wantAvailable)
		}
		if backend == nil || backend.name != item.wantBackend {
			got := "<nil>"
			if backend != nil {
				got = backend.name
			}
			t.Fatalf("%s backend mismatch: got=%s want=%s", item.modelID, got, item.wantBackend)
		}
	}
}

func TestCloudProviderExplicitBackendMissing(t *testing.T) {
	p := &cloudProvider{
		litellm: nil,
	}

	_, _, _, err := p.generateText(context.Background(), "aliyun/qwen-max", &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}, "hello")
	if err == nil {
		t.Fatalf("expected explicit backend missing error")
	}

	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status error")
	}
	if st.Code() != codes.Unavailable || st.Message() != runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String() {
		t.Fatalf("unexpected error: code=%v message=%s", st.Code(), st.Message())
	}
}

func TestCloudProviderRoutesByPrefix(t *testing.T) {
	liteCalls := int32(0)
	aliCalls := int32(0)
	byteCalls := int32(0)

	liteServer := newChatServer(t, "from-litellm", &liteCalls)
	defer liteServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()
	byteServer := newChatServer(t, "from-bytedance", &byteCalls)
	defer byteServer.Close()

	p := &cloudProvider{
		litellm:   newOpenAIBackend("litellm", liteServer.URL, "", 3*time.Second),
		alibaba:   newOpenAIBackend("alibaba", aliServer.URL, "", 3*time.Second),
		bytedance: newOpenAIBackend("bytedance", byteServer.URL, "", 3*time.Second),
	}

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.generateText(context.Background(), "aliyun/qwen-max", req, "hello")
	if err != nil {
		t.Fatalf("generate aliyun: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected aliyun text: %s", text)
	}

	text, _, _, err = p.generateText(context.Background(), "bytedance/deepseek-v3", req, "hello")
	if err != nil {
		t.Fatalf("generate bytedance: %v", err)
	}
	if text != "from-bytedance" {
		t.Fatalf("unexpected bytedance text: %s", text)
	}

	text, _, _, err = p.generateText(context.Background(), "gpt-4o-mini", req, "hello")
	if err != nil {
		t.Fatalf("generate litellm default: %v", err)
	}
	if text != "from-litellm" {
		t.Fatalf("unexpected litellm text: %s", text)
	}

	if got := atomic.LoadInt32(&liteCalls); got != 1 {
		t.Fatalf("litellm calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&byteCalls); got != 1 {
		t.Fatalf("bytedance calls mismatch: got=%d want=1", got)
	}
}

func TestCloudProviderUsesRegistryHintForDefaultModel(t *testing.T) {
	liteCalls := int32(0)
	aliCalls := int32(0)

	liteServer := newChatServer(t, "from-litellm", &liteCalls)
	defer liteServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()

	registry := modelregistry.New()
	registry.Upsert(modelregistry.Entry{
		ModelID:      "qwen-max",
		Version:      "latest",
		Status:       runtimev1.ModelStatus_MODEL_STATUS_INSTALLED,
		Capabilities: []string{"text.generate"},
		ProviderHint: modelregistry.ProviderHintAlibaba,
	})

	p := &cloudProvider{
		litellm:  newOpenAIBackend("litellm", liteServer.URL, "", 3*time.Second),
		alibaba:  newOpenAIBackend("alibaba", aliServer.URL, "", 3*time.Second),
		registry: registry,
	}

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.generateText(context.Background(), "qwen-max", req, "hello")
	if err != nil {
		t.Fatalf("generate with registry hint: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected text: %s", text)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&liteCalls); got != 0 {
		t.Fatalf("litellm should not be called: got=%d want=0", got)
	}
}

func TestCloudProviderSkipsUnhealthyBackend(t *testing.T) {
	liteCalls := int32(0)
	aliCalls := int32(0)

	liteServer := newChatServer(t, "from-litellm", &liteCalls)
	defer liteServer.Close()
	aliServer := newChatServer(t, "from-alibaba", &aliCalls)
	defer aliServer.Close()

	healthTracker := providerhealth.New()
	healthTracker.Mark("cloud-litellm", false, "timeout")
	healthTracker.Mark("cloud-alibaba", true, "")

	p := &cloudProvider{
		litellm: newOpenAIBackend("litellm", liteServer.URL, "", 3*time.Second),
		alibaba: newOpenAIBackend("alibaba", aliServer.URL, "", 3*time.Second),
		health:  healthTracker,
	}

	req := &runtimev1.GenerateRequest{
		Input: []*runtimev1.ChatMessage{
			{Role: "user", Content: "hello"},
		},
	}

	text, _, _, err := p.generateText(context.Background(), "gpt-4o-mini", req, "hello")
	if err != nil {
		t.Fatalf("generate with unhealthy litellm: %v", err)
	}
	if text != "from-alibaba" {
		t.Fatalf("unexpected text: %s", text)
	}
	if got := atomic.LoadInt32(&aliCalls); got != 1 {
		t.Fatalf("alibaba calls mismatch: got=%d want=1", got)
	}
	if got := atomic.LoadInt32(&liteCalls); got != 0 {
		t.Fatalf("litellm should be skipped: got=%d want=0", got)
	}
}

func newChatServer(t *testing.T, text string, counter *int32) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		atomic.AddInt32(counter, 1)
		payload := map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": text,
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     12,
				"completion_tokens": 8,
			},
		}
		if err := json.NewEncoder(w).Encode(payload); err != nil {
			t.Fatalf("encode payload: %v", err)
		}
	}))
}
