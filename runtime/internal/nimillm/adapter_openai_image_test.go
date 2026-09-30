package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func openAIImageTestPNG(width uint32, height uint32) []byte {
	var image bytes.Buffer
	image.Write(pngSignature)
	_ = binary.Write(&image, binary.BigEndian, uint32(13))
	image.WriteString("IHDR")
	_ = binary.Write(&image, binary.BigEndian, width)
	_ = binary.Write(&image, binary.BigEndian, height)
	image.Write([]byte{8, 6, 0, 0, 0, 0, 0, 0, 0})
	return image.Bytes()
}

func openAIImageTestJob(size string, quality string) *runtimev1.SubmitScenarioJobRequest {
	return &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{
			Prompt: " A paper lantern ", Size: size, Quality: quality, ResponseFormat: "b64_json",
		}}},
	}
}

func openAIImageTestServer(t *testing.T, body *map[string]any, response func() string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/images/generations" || r.Header.Get("Authorization") != "Bearer test-key" {
			http.NotFound(w, r)
			return
		}
		raw, _ := io.ReadAll(r.Body)
		if body != nil {
			_ = json.Unmarshal(raw, body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, response())
	}))
}

func TestOpenAIImageSendsOnlyEndpointFields(t *testing.T) {
	png := openAIImageTestPNG(1536, 1024)
	var body map[string]any
	server := openAIImageTestServer(t, &body, func() string {
		return `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString(png) + `"}],"usage":{"input_tokens":9,"output_tokens":272,"total_tokens":281}}`
	})
	defer server.Close()

	provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.5-flare")
	artifacts, usage, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("1536x1024", "low"), "gpt-image-2.5-flare", target)
	if err != nil {
		t.Fatalf("executeOpenAIImage: %v", err)
	}
	want := map[string]any{"model": "gpt-image-2.5-flare", "prompt": "A paper lantern", "size": "1536x1024", "quality": "low"}
	if !reflect.DeepEqual(body, want) {
		t.Fatalf("body = %v, want %v", body, want)
	}
	if len(artifacts) != 1 || artifacts[0].GetMimeType() != "image/png" || !bytes.Equal(artifacts[0].GetBytes(), png) ||
		artifacts[0].GetWidth() != 1536 || artifacts[0].GetHeight() != 1024 {
		t.Fatalf("artifacts = %+v", artifacts)
	}
	if usage.GetInputTokens() != 9 || usage.GetOutputTokens() != 272 || usage.GetComputeMs() != 0 {
		t.Fatalf("usage = %+v", usage)
	}

	body = nil
	if _, _, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("", ""), "gpt-image-2.5-flare", target); err != nil {
		t.Fatalf("plain prompt: %v", err)
	}
	if want := map[string]any{"model": "gpt-image-2.5-flare", "prompt": "A paper lantern"}; !reflect.DeepEqual(body, want) {
		t.Fatalf("plain body = %v, want %v", body, want)
	}
}

func TestOpenAIImageRejectsResultsThatAreNotOnePNG(t *testing.T) {
	encoded := base64.StdEncoding.EncodeToString(openAIImageTestPNG(1024, 1024))
	for name, response := range map[string]string{
		"two images": `{"data":[{"b64_json":"` + encoded + `"},{"b64_json":"` + encoded + `"}]}`,
		"url only":   `{"data":[{"url":"https://example.com/a.png"}]}`,
		"not a png":  `{"data":[{"b64_json":"` + base64.StdEncoding.EncodeToString([]byte("GIF89a-not-png-data")) + `"}]}`,
		"bad base64": `{"data":[{"b64_json":"%%%"}]}`,
	} {
		server := openAIImageTestServer(t, nil, func() string { return response })
		provider, target := openAITranscriptionTestTarget(server.URL, "gpt-image-2.5-flare")
		_, _, _, err := provider.executeOpenAIImage(context.Background(), openAIImageTestJob("", ""), "gpt-image-2.5-flare", target)
		server.Close()
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("%s: reason=%v present=%v err=%v", name, reason, ok, err)
		}
	}
}
