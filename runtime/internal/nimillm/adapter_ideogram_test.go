package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestIdeogramExistingModelsUseTheirNativeProtocols(t *testing.T) {
	for _, model := range []string{"ideogram-v3", "ideogram-v2-turbo"} {
		t.Run(model, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Header.Get("Api-Key") != "test-key" || r.Header.Get("Authorization") != "" {
					t.Error("wrong native authentication")
				}
				if model == "ideogram-v3" {
					if r.URL.Path != "/gateway/v1/ideogram-v3/generate" || !strings.HasPrefix(r.Header.Get("Content-Type"), "multipart/form-data;") {
						t.Fatalf("wrong v3 endpoint/type: %s %s", r.URL.Path, r.Header.Get("Content-Type"))
					}
					if err := r.ParseMultipartForm(1 << 20); err != nil {
						t.Fatal(err)
					}
					defer r.MultipartForm.RemoveAll()
					if r.FormValue("prompt") != " a cat " || r.FormValue("aspect_ratio") != "16x9" || r.FormValue("seed") != "0" || r.FormValue("style_type") != "REALISTIC" || r.FormValue("model") != "" || len(r.MultipartForm.Value) != 5 {
						t.Fatalf("wrong v3 body: %v", r.MultipartForm.Value)
					}
				} else {
					if r.URL.Path != "/gateway/generate" {
						t.Fatalf("wrong v2 endpoint: %s", r.URL.Path)
					}
					var body map[string]map[string]any
					if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
						t.Fatal(err)
					}
					input := body["image_request"]
					if len(body) != 1 || input["model"] != "V_2_TURBO" || input["aspect_ratio"] != "ASPECT_16_9" || input["seed"] != float64(0) || input["prompt"] != " a cat " || input["style_type"] != "REALISTIC" {
						t.Fatalf("wrong v2 body: %v", body)
					}
				}
				_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"is_image_safe": true, "url": "https://images.example/result.png", "resolution": "1024x1024"}}})
			}))
			defer server.Close()
			zero := int64(0)
			spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: " a cat ", AspectRatio: "16:9", Style: "realistic", NegativePrompt: "text", Seed: &zero}
			req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
			artifacts, _, _, err := ExecuteIdeogramImage(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/gateway", APIKey: "test-key", AllowLoopbackEndpoint: true}, req, model)
			if err != nil || len(artifacts) != 1 || artifacts[0].GetUri() != "https://images.example/result.png" || len(artifacts[0].GetBytes()) != 0 {
				t.Fatalf("artifact=%v error=%v", artifacts, err)
			}
		})
	}
}

func TestIdeogramNeverPublishesFilteredOrIncompleteImageSet(t *testing.T) {
	for _, data := range []any{
		[]any{map[string]any{"is_image_safe": false, "url": "https://images.example/result.png"}},
		[]any{map[string]any{"url": "https://images.example/result.png"}},
		[]any{map[string]any{"is_image_safe": true, "url": "file:///result.png"}},
		[]any{},
		[]any{map[string]any{"is_image_safe": true, "url": "https://images.example/a.png"}, map[string]any{"is_image_safe": true, "url": "https://images.example/b.png"}},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			_ = json.NewEncoder(w).Encode(map[string]any{"data": data})
		}))
		req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat"}}}}
		artifacts, _, _, err := ExecuteIdeogramImage(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, req, "ideogram-v2-turbo")
		server.Close()
		if err == nil || len(artifacts) != 0 {
			t.Fatalf("unsafe/incomplete data accepted: %v", data)
		}
	}
}

func TestExecuteIdeogramImageRejectsMissingAPIKey(t *testing.T) {
	_, _, _, err := ExecuteIdeogramImage(
		context.Background(),
		MediaAdapterConfig{BaseURL: "https://api.ideogram.ai"},
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_ImageGenerate{
					ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cat"},
				},
			},
		},
		"ideogram-v3",
	)
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("expected AI_PROVIDER_AUTH_FAILED, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}
