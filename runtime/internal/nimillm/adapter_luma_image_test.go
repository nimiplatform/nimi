package nimillm

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestLumaUniImageOriginalTypeAndOwnedSource(t *testing.T) {
	for _, model := range []string{"uni-1", "uni-1-max"} {
		for _, inputKind := range []string{"text", "owned", "urls"} {
			t.Run(model+"/"+inputKind, func(t *testing.T) {
				source := ideogramTestImage(t, image.NewNRGBA(image.Rect(0, 0, 2, 2)), "source")
				spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "a cup", OutputFormat: "jpeg"}
				wantType := "image"
				if inputKind == "owned" {
					spec.ReferenceImageArtifactId = "source"
					wantType = "image_edit"
				}
				if inputKind == "urls" {
					spec.ReferenceImages = []string{"https://media.example/source.png", "https://media.example/style.png"}
					wantType = "image_edit"
				}
				creates, queries, deletes := 0, 0, 0
				observedModel, observedType, state := model, wantType, "queued"
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if r.Header.Get("Authorization") != "Bearer test-key" {
						t.Error("wrong auth")
					}
					if r.Method == http.MethodDelete {
						deletes++
						t.Error("resource delete used as cancel")
						return
					}
					if r.Method == http.MethodPost {
						creates++
						if r.URL.Path != "/gateway/v1/generations" {
							t.Error(r.URL.Path)
						}
						var body map[string]any
						_ = json.NewDecoder(r.Body).Decode(&body)
						if body["model"] != model || body["type"] != wantType || body["output_format"] != "jpeg" || body["web_search"] != false {
							t.Errorf("wrong payload %v", body)
						}
						switch inputKind {
						case "text":
							if body["source"] != nil {
								t.Error("invented edit")
							}
						case "owned":
							s := body["source"].(map[string]any)
							if s["data"] != base64.StdEncoding.EncodeToString(source.Bytes) || s["media_type"] != "image/png" || s["url"] != nil {
								t.Error("owned source changed")
							}
						case "urls":
							if body["source"].(map[string]any)["url"] != spec.ReferenceImages[0] || body["image_ref"].([]any)[0].(map[string]any)["url"] != spec.ReferenceImages[1] {
								t.Error("reference order changed")
							}
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "model": model, "type": wantType, "state": "queued"})
					} else {
						queries++
						if r.URL.Path != "/gateway/v1/generations/original" {
							t.Error("original task changed")
						}
						_ = json.NewEncoder(w).Encode(map[string]any{"id": "original", "model": observedModel, "type": observedType, "state": state, "output": []any{map[string]any{"type": "image", "url": "https://media.example/output.jpeg"}}, "usage": map[string]any{"credits_charged": 23}})
					}
				}))
				defer server.Close()
				var receipt *NativeTaskReceipt
				ctx := WithImageReference(WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil }), source)
				request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
				cfg := MediaAdapterConfig{BaseURL: server.URL + "/gateway/v1", APIKey: "test-key", AllowLoopbackEndpoint: true}
				if !MediaUsesNativeTask(AdapterLumaUniImage, request, model) {
					t.Fatal("async handoff missing")
				}
				_, _, _, err := ExecuteLumaUniImage(ctx, cfg, request, model)
				if !errors.Is(err, ErrNativeTaskYielded) || receipt == nil || queries != 0 || receipt.LumaGenerationType != wantType {
					t.Fatal("receipt", receipt, err)
				}
				if _, done, err := ObserveNativeTask(context.Background(), cfg, receipt); done || err != nil {
					t.Fatal("queued", err)
				}
				state = "completed"
				observedType = "video"
				if _, _, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil {
					t.Fatal("type drift accepted")
				}
				observedType = wantType
				observedModel = "ray-3.2"
				if _, _, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil {
					t.Fatal("model drift accepted")
				}
				observedModel = model
				result, done, err := ObserveNativeTask(context.Background(), cfg, receipt)
				if err != nil || !done || len(result.GetArtifacts()) != 1 || result.Artifacts[0].GetMimeType() != "image/jpeg" || result.Usage != nil {
					t.Fatal("output or fabricated usage", result, err)
				}
				outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterLumaUniImage, receipt.TaskID, cfg)
				if err != nil || outcome != ProviderTaskCleanupNotCancelable || deletes != 0 || creates != 1 {
					t.Fatal("false cancel or replay", outcome, err)
				}
			})
		}
	}
}
