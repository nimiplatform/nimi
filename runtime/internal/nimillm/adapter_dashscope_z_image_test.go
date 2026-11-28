package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestDashscopeZImageSubmitsExactDocumentedPayload(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/ws/api/v1/services/aigc/multimodal-generation/generation" || r.Header.Get("Authorization") != "Bearer test-key" || r.Header.Get("X-DashScope-WorkSpace") != "test-workspace" {
			t.Errorf("incorrect native target or workspace")
		}
		var got map[string]any
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		want := map[string]any{
			"model": "z-image-turbo",
			"input": map[string]any{"messages": []any{map[string]any{
				"role": "user", "content": []any{map[string]any{"text": "cube"}},
			}}},
			"parameters": map[string]any{"size": "1024*1024", "seed": float64(0)},
		}
		if !reflect.DeepEqual(got, want) {
			t.Errorf("payload = %#v", got)
		}
		w.WriteHeader(http.StatusBadRequest)
	}))
	defer server.Close()
	spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "cube", N: proto.Int32(1), Seed: proto.Int64(0), Size: "1024x1024", ResponseFormat: "url"}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
	_, _, _, err := ExecuteAlibabaNative(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/ws/compatible-mode/v1", APIKey: "test-key", AllowLoopbackEndpoint: true, Headers: map[string]string{"X-DashScope-WorkSpace": "test-workspace"}}, nil, "job", req, "z-image-turbo")
	if err == nil || calls.Load() != 1 {
		t.Fatal("expected exactly the fixture server rejection")
	}
}

func TestDashscopeZImageSelectsOnlyFinalImage(t *testing.T) {
	image := map[string]any{"image": "https://example.com/final.png"}
	text := map[string]any{"text": "https://example.com/prompt"}
	for _, tc := range []struct {
		parts []any
		valid bool
	}{{[]any{image, text}, true}, {[]any{text, image}, true}, {[]any{text}, false}, {[]any{image, image}, false}} {
		response := map[string]any{"output": map[string]any{"choices": []any{map[string]any{"finish_reason": "stop", "message": map[string]any{"role": "assistant", "content": tc.parts}}}}}
		url, err := dashscopeZImageURL(response)
		if (err == nil) != tc.valid || tc.valid && url != image["image"] {
			t.Fatalf("URL %q, error %v", url, err)
		}
	}
}
