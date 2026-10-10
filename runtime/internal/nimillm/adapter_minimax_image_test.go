package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestMiniMaxImageIsFiniteAndKeepsTheWholeSet(t *testing.T) {
	for _, format := range []string{"url", "base64"} {
		t.Run(format, func(t *testing.T) {
			payload := openAIImageTestPNG(1, 1)
			var creates, queries, downloads, publishes atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method == http.MethodPost && r.URL.Path == "/v1/image_generation" {
					creates.Add(1)
					var input map[string]any
					if err := json.NewDecoder(r.Body).Decode(&input); err != nil {
						t.Error(err)
					}
					if input["n"] != float64(2) || input["seed"] != float64(0) || input["width"] != float64(1024) || input["height"] != float64(1024) || input["response_format"] != format {
						t.Errorf("lost declared image input: %v", input)
					}
					data := map[string]any{"image_urls": []string{endpoint + "/first.png", endpoint + "/second.png"}}
					if format == "base64" {
						data = map[string]any{"image_base64": []string{base64.StdEncoding.EncodeToString(payload), base64.StdEncoding.EncodeToString(payload)}}
					}
					w.Header().Set("Content-Type", "application/json")
					json.NewEncoder(w).Encode(map[string]any{"id": "trace-only", "data": data, "metadata": map[string]any{"success_count": "2", "failed_count": "0"}, "base_resp": map[string]any{"status_code": 0}})
					return
				}
				if r.URL.Path == "/first.png" || r.URL.Path == "/second.png" {
					downloads.Add(1)
					w.Header().Set("Content-Type", "image/png")
					w.Write(payload)
					return
				}
				queries.Add(1)
				http.NotFound(w, r)
			}))
			defer server.Close()
			endpoint = server.URL
			cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "key", AllowLoopbackEndpoint: true}
			ctx := WithMediaAdapterEndpointPolicy(context.Background(), cfg)
			ctx = WithNativeTaskPublisher(ctx, func(*NativeTaskReceipt) error { publishes.Add(1); return nil })
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "cup", N: proto.Int32(2), Seed: proto.Int64(0), Size: "1024x1024", ResponseFormat: format}}}}
			if MediaUsesNativeTask(AdapterMiniMaxTask, request, "image-01") {
				t.Fatal("image trace was classified as native task")
			}
			result, err := (&CloudProvider{}).ExecuteMediaAdapter(ctx, AdapterMiniMaxTask, "job", request, "image-01", &RemoteTarget{Endpoint: endpoint, APIKey: "key", AllowLoopback: true}, noopJobStateUpdater{})
			if err != nil || len(result.Artifacts) != 2 || result.ProviderJobID != "" || creates.Load() != 1 || queries.Load() != 0 || publishes.Load() != 0 {
				t.Fatalf("image entered task query lifecycle: %v (%d/%d/%d)", err, creates.Load(), queries.Load(), publishes.Load())
			}
			for _, artifact := range result.Artifacts {
				body := result.ArtifactBodies[artifact.ArtifactId]
				actual := body.Bytes
				if body.Stream != nil {
					actual, err = io.ReadAll(body.Stream)
					body.Stream.Close()
				}
				if err != nil || !bytes.Equal(actual, payload) || artifact.GetMimeType() != "image/png" {
					t.Fatal("complete image body changed")
				}
			}
			expected := int32(0)
			if format == "url" {
				expected = 2
			}
			if downloads.Load() != expected {
				t.Fatal("wrong body acquisition count")
			}
		})
	}
}

func TestMiniMaxImageRejectsPartialSetWithoutPublishingTrace(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		io.WriteString(w, `{"id":"not-a-task","data":{"image_urls":["https://example.test/one"]},"metadata":{"failed_count":"1","success_count":"1"},"base_resp":{"status_code":0}}`)
	}))
	defer server.Close()
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "two", N: proto.Int32(2)}}}}
	artifacts, _, id, err := ExecuteMiniMaxTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true}, noopJobStateUpdater{}, "job", request, "image-01", nil)
	if err == nil || len(artifacts) != 0 || id != "" {
		t.Fatalf("partial image response became a task or result: %v %s", err, id)
	}
}
