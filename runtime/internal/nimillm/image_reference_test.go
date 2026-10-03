package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestGeminiOwnedReferenceUsesCapturedOriginalBytesAndRejectsMissingCapture(t *testing.T) {
	var imageBody bytes.Buffer
	if err := png.Encode(&imageBody, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	payload := imageBody.Bytes()
	digest := sha256.Sum256(payload)
	reference := &ImageReference{ArtifactID: "owned-reference", MIMEType: "image/png", SHA256: hex.EncodeToString(digest[:]), Bytes: bytes.Clone(payload)}
	ctx := WithImageReference(context.Background(), reference)
	reference.Bytes[0] ^= 0xff
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if r.URL.Path != "/v1beta/models/gemini-3.1-flash-image:generateContent" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Errorf("unexpected route/auth")
		}
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		parts := body["contents"].([]any)[0].(map[string]any)["parts"].([]any)
		if len(parts) != 2 {
			t.Fatalf("parts=%v", parts)
		}
		inline := parts[1].(map[string]any)["inlineData"].(map[string]any)
		if inline["mimeType"] != "image/png" || inline["data"] != base64.StdEncoding.EncodeToString(payload) {
			t.Fatal("reference bytes or MIME changed")
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(payload)}}}}}}})
	}))
	defer server.Close()
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "make the bag green", ReferenceImageArtifactId: "owned-reference", AspectRatio: "1:1"}}}}
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/v1beta", APIKey: "test-key", AllowLoopbackEndpoint: true}
	result, _, _, err := ExecuteGeminiImageGenerateContent(ctx, cfg, request, "gemini-3.1-flash-image")
	if err != nil || len(result) != 1 {
		t.Fatalf("result=%v err=%v", result, err)
	}
	if _, _, _, err := ExecuteGeminiImageGenerateContent(context.Background(), cfg, request, "gemini-3.1-flash-image"); err == nil {
		t.Fatal("missing captured input dispatched")
	}
	if calls.Load() != 1 {
		t.Fatalf("provider calls=%d", calls.Load())
	}
}

func TestGeminiOwnedReferenceBudgetIncludesPromptAndBase64(t *testing.T) {
	// Valid encoded geometry with trailing bytes is deliberately large: the
	// full serialized request budget, not only decoded geometry, must apply.
	var imageBody bytes.Buffer
	if err := png.Encode(&imageBody, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatal(err)
	}
	payload := append(imageBody.Bytes(), make([]byte, 15_000_000)...)
	digest := sha256.Sum256(payload)
	reference := &ImageReference{ArtifactID: "large", MIMEType: "image/png", SHA256: hex.EncodeToString(digest[:]), Bytes: payload}
	if err := ValidateGeminiImageReferenceRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "edit", ReferenceImageArtifactId: "large"}, reference); err == nil {
		t.Fatal("oversized serialized image input admitted")
	}
}

func TestGeminiOwnedReferenceRejectsTruncatedImageWithValidHeaderAndDigest(t *testing.T) {
	var imageBody bytes.Buffer
	if err := png.Encode(&imageBody, image.NewRGBA(image.Rect(0, 0, 3, 2))); err != nil {
		t.Fatal(err)
	}
	// PNG's signature and IHDR are enough for DecodeConfig but cannot be used
	// as an image. A matching custody digest does not establish image validity.
	payload := bytes.Clone(imageBody.Bytes()[:33])
	if _, _, err := image.DecodeConfig(bytes.NewReader(payload)); err != nil {
		t.Fatalf("fixture must retain valid image geometry: %v", err)
	}
	digest := sha256.Sum256(payload)
	reference := &ImageReference{ArtifactID: "truncated", MIMEType: "image/png", SHA256: hex.EncodeToString(digest[:]), Bytes: payload}
	if err := ValidateGeminiImageReferenceRequest(&runtimev1.ImageGenerateScenarioSpec{Prompt: "edit", ReferenceImageArtifactId: reference.ArtifactID}, reference); err == nil {
		t.Fatal("truncated image admitted as a captured reference")
	}
}
