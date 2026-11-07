package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func TestSeedreamRejectsMalformedOrIncompleteImageResults(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1024, 1024))); err != nil {
		t.Fatal(err)
	}
	for name, change := range map[string]func(map[string]any, map[string]any){
		"wrong model": func(out, item map[string]any) { out["model"] = capabilitydriver.Seedream5FlashModel },
		"group":       func(out, item map[string]any) { out["data"] = []any{item, item} },
		"empty group": func(out, item map[string]any) { out["data"] = []any{} },
		"base64":      func(out, item map[string]any) { item["b64_json"] = "not base64" },
		"truncated image": func(out, item map[string]any) {
			item["b64_json"] = base64.StdEncoding.EncodeToString(pngData.Bytes()[:50])
		},
		"wrong size metadata":   func(out, item map[string]any) { item["size"] = "1024x1023" },
		"wrong codec metadata":  func(out, item map[string]any) { item["output_format"] = "jpeg" },
		"negative usage":        func(out, item map[string]any) { out["usage"] = map[string]any{"output_tokens": -1} },
		"wrong generated count": func(out, item map[string]any) { out["usage"] = map[string]any{"generated_images": 2} },
		"root error": func(out, item map[string]any) {
			out["error"] = map[string]any{"code": "GenerationFailed", "message": "failed"}
			delete(out, "data")
		},
		"item error": func(out, item map[string]any) {
			item["error"] = map[string]any{"code": "GenerationFailed", "message": "failed"}
		},
	} {
		t.Run(name, func(t *testing.T) {
			item := map[string]any{"b64_json": base64.StdEncoding.EncodeToString(pngData.Bytes()), "size": "1024x1024", "output_format": "png"}
			out := map[string]any{"model": capabilitydriver.Seedream5ProModel, "data": []any{item}}
			change(out, item)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(out)
			}))
			defer server.Close()
			req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup", Size: "1024x1024", ResponseFormat: "b64_json", OutputFormat: "png"}}}}
			artifacts, _, _, err := ExecuteSeedreamImage(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/api/v3", APIKey: "test", AllowLoopbackEndpoint: true}, req, capabilitydriver.Seedream5ProModel)
			if err == nil || len(artifacts) != 0 {
				t.Fatal("invalid output published", name)
			}
		})
	}
}

func TestSeedreamDoesNotInferUsageFromPixelsOrImageCount(t *testing.T) {
	var pngData bytes.Buffer
	if err := png.Encode(&pngData, image.NewRGBA(image.Rect(0, 0, 1024, 1024))); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"data": []any{map[string]any{"b64_json": base64.StdEncoding.EncodeToString(pngData.Bytes())}}, "usage": map[string]any{"generated_images": 1}})
	}))
	defer server.Close()
	req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A blue cup", Size: "1K", ResponseFormat: "b64_json", OutputFormat: "png"}}}}
	artifacts, usage, job, err := ExecuteSeedreamImage(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/api/v3", APIKey: "test", AllowLoopbackEndpoint: true}, req, capabilitydriver.Seedream5ProModel)
	if err != nil || len(artifacts) != 1 || usage != nil || job != "" || artifacts[0].GetWidth() != 1024 {
		t.Fatal("invented usage, task or size", err)
	}
}
