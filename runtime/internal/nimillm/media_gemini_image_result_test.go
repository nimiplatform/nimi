package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"image"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestGeminiImageRetainsReportedUsageAndRejectsBrokenImages(t *testing.T) {
	var pngBytes, jpegBytes bytes.Buffer
	picture := image.NewRGBA(image.Rect(0, 0, 3, 2))
	if err := png.Encode(&pngBytes, picture); err != nil {
		t.Fatal(err)
	}
	if err := jpeg.Encode(&jpegBytes, picture, nil); err != nil {
		t.Fatal(err)
	}
	for _, test := range []struct {
		name    string
		data    []byte
		usage   any
		want    *runtimev1.UsageStats
		invalid bool
	}{
		{name: "missing usage", data: pngBytes.Bytes()},
		{name: "reported usage", data: jpegBytes.Bytes(), usage: map[string]any{"promptTokenCount": 42, "candidatesTokenCount": 77, "totalTokenCount": 129, "thoughtsTokenCount": 10, "cachedContentTokenCount": 12}, want: &runtimev1.UsageStats{InputTokens: 42, OutputTokens: 87, CachedInputTokens: 12, ReasoningOutputTokens: 10}},
		{name: "actual zero", data: pngBytes.Bytes(), usage: map[string]any{"promptTokenCount": 0, "totalTokenCount": 0}, want: &runtimev1.UsageStats{}},
		{name: "invalid usage", data: pngBytes.Bytes(), usage: map[string]any{"promptTokenCount": -1, "totalTokenCount": 10}, invalid: true},
		{name: "truncated PNG", data: pngBytes.Bytes()[:33], invalid: true},
		{name: "truncated JPEG", data: jpegBytes.Bytes()[:len(jpegBytes.Bytes())-20], invalid: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				payload := map[string]any{"candidates": []any{map[string]any{"finishReason": "STOP", "content": map[string]any{"parts": []any{map[string]any{"inlineData": map[string]any{"mimeType": "image/png", "data": base64.StdEncoding.EncodeToString(test.data)}}}}}}}
				if test.usage != nil {
					payload["usageMetadata"] = test.usage
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(payload)
			}))
			defer server.Close()
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
				Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "A tree."}}}}
			artifacts, usage, _, err := ExecuteGeminiOperation(context.Background(), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", AllowLoopbackEndpoint: true, APIKey: "test-key"}, noopGeminiJobUpdater{}, "job-image", request, "gemini-3.1-flash-lite-image", func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil })
			if test.invalid {
				if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
					t.Fatalf("invalid output succeeded: %v %v", artifacts, err)
				}
				return
			}
			if err != nil || len(artifacts) != 1 {
				t.Fatalf("valid image failed: %v", err)
			}
			if (usage == nil) != (test.want == nil) || (usage != nil && (usage.GetInputTokens() != test.want.GetInputTokens() || usage.GetOutputTokens() != test.want.GetOutputTokens() || usage.GetCachedInputTokens() != test.want.GetCachedInputTokens() || usage.GetReasoningOutputTokens() != test.want.GetReasoningOutputTokens() || usage.GetComputeMs() != 0)) {
				t.Fatalf("reported usage changed: got=%v want=%v", usage, test.want)
			}
		})
	}
}
