package nimillm

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestSiliconFlowRejectsIncompleteOrWrongSizedImage(t *testing.T) {
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, image.NewRGBA(image.Rect(0, 0, 256, 256))); err != nil {
		t.Fatal(err)
	}
	for _, kind := range []string{"truncated", "wrong-size", "extra-output"} {
		t.Run(kind, func(t *testing.T) {
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/image" {
					b := encoded.Bytes()
					if kind == "truncated" {
						b = b[:40]
					}
					_, _ = w.Write(b)
					return
				}
				urls := []any{map[string]any{"url": endpoint + "/image"}}
				if kind == "extra-output" {
					urls = append(urls, urls[0])
				}
				w.Header().Set("Content-Type", "application/json")
				_ = json.NewEncoder(w).Encode(map[string]any{"images": urls})
			}))
			defer server.Close()
			endpoint = server.URL
			size := "256x256"
			if kind == "wrong-size" {
				size = "512x512"
			}
			req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", Size: size}}}}
			artifacts, _, _, err := ExecuteSiliconFlowImage(context.Background(), MediaAdapterConfig{BaseURL: endpoint + "/v1", APIKey: "test", AllowLoopbackEndpoint: true}, req, "Qwen/Qwen-Image")
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID || len(artifacts) != 0 {
				t.Fatal("invalid image published", artifacts, err)
			}
		})
	}
}
