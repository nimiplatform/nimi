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
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestNanoBanana21NativeSizeAndDecodedOutputContract(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewGray(image.Rect(0, 0, 12288, 1536))); err != nil {
		t.Fatal(err)
	}
	if _, _, valid := decodedMediaImageConfig(encoded.Bytes()); valid {
		t.Fatal("generic image pixel limit was widened")
	}
	var requestedSize, requestedRatio string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1beta/models/gemini-nano-banana-2.1:generateContent" {
			t.Error(r.URL.Path)
			w.WriteHeader(404)
			return
		}
		body := decodeJSONBodyForBackendMediaTest(t, r)
		config := body["generationConfig"].(map[string]any)["imageConfig"].(map[string]any)
		requestedSize, _ = config["imageSize"].(string)
		requestedRatio, _ = config["aspectRatio"].(string)
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(encoded.Bytes())}}}}}}})
	}))
	defer server.Close()
	spec := &runtimev1.ImageGenerateScenarioSpec{Prompt: "panorama", Size: "4K", AspectRatio: "8:1"}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: spec}}}
	config := MediaAdapterConfig{BaseURL: server.URL + "/v1beta", AllowLoopbackEndpoint: true, APIKey: "fixture"}
	artifacts, usage, _, err := ExecuteGeminiImageGenerateContent(context.Background(), config, request, "gemini-nano-banana-2.1")
	if err != nil || len(artifacts) != 1 || usage != nil || requestedSize != "4K" || requestedRatio != "8:1" {
		t.Fatalf("native size/result mismatch %q %q %v", requestedSize, requestedRatio, err)
	}
	if artifacts[0].GetWidth() != 12288 || artifacts[0].GetHeight() != 1536 {
		t.Fatal("lost decoded geometry")
	}
	// Native resolution tiers do not promise exact pixels. Preserve the actual
	// valid canvas, including shapes differing from the documentation's table.
	encoded.Reset()
	if err := png.Encode(&encoded, image.NewGray(image.Rect(0, 0, 5856, 704))); err != nil {
		t.Fatal(err)
	}
	spec.Size = "2K"
	artifacts, _, _, err = ExecuteGeminiImageGenerateContent(context.Background(), config, request, "gemini-nano-banana-2.1")
	if err != nil || len(artifacts) != 1 || artifacts[0].GetWidth() != 5856 || artifacts[0].GetHeight() != 704 || requestedSize != "2K" {
		t.Fatalf("actual geometry lost: %v", err)
	}
	encoded.Reset()
	encoded.WriteString("not an image")
	artifacts, _, _, err = ExecuteGeminiImageGenerateContent(context.Background(), config, request, "gemini-nano-banana-2.1")
	reason, _ := grpcerr.ExtractReasonCode(err)
	if reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
		t.Fatal("invalid image published")
	}
}
