package nimillm

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestXAIImageDeferredJSONEditingAndCompleteOwnedFiles(t *testing.T) {
	for _, mode := range []string{"generate", "owned-edit", "multi-edit"} {
		t.Run(mode, func(t *testing.T) {
			data := stabilityTestPNG(t)
			var creates, queries, downloads atomic.Int32
			var endpoint string
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasPrefix(r.URL.Path, "/blob/") {
					downloads.Add(1)
					if r.Header.Get("Authorization") != "" {
						t.Error("provider credential forwarded to image URL")
					}
					w.Header().Set("Content-Type", "application/octet-stream")
					w.Write(data)
					return
				}
				if r.Header.Get("Authorization") != "Bearer fixture" {
					t.Error("missing control credential")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					creates.Add(1)
					path := "/gateway/v1/images/generations"
					if mode != "generate" {
						path = "/gateway/v1/images/edits"
					}
					if r.URL.Path != path || r.Header.Get("Content-Type") != "application/json" {
						t.Errorf("wrong native edit transport %s %s", r.URL.Path, r.Header.Get("Content-Type"))
					}
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					if body["deferred"] != true || body["response_format"] != "url" || body["n"] != float64(2) || body["model"] != capabilitydriver.XAIImage2Model || body["resolution"] != "1k" || body["quality"] != "auto" || body["size"] != nil || body["output"] != nil || body["storage_options"] != nil {
						t.Errorf("native image payload %+v", body)
					}
					if mode == "owned-edit" && !strings.HasPrefix(ValueAsString(MapField(body["image"], "url")), "data:image/png;base64,") {
						t.Error("owned bytes not mapped")
					}
					if mode == "multi-edit" && len(body["images"].([]any)) != 2 {
						t.Error("ordered multi-reference edit lost")
					}
					json.NewEncoder(w).Encode(map[string]any{"request_id": "image_task_1"})
					return
				}
				if r.URL.Path != "/gateway/v1/images/image_task_1" {
					t.Errorf("query path %s", r.URL.Path)
				}
				if queries.Add(1) == 1 {
					w.WriteHeader(202)
					json.NewEncoder(w).Encode(map[string]any{"request_id": "image_task_1", "status": "pending"})
					return
				}
				json.NewEncoder(w).Encode(map[string]any{"request_id": "image_task_1", "status": "done", "data": []any{map[string]any{"url": endpoint + "/blob/1.png"}, map[string]any{"url": endpoint + "/blob/2.png"}}, "usage": map[string]any{"input_tokens": 2, "output_tokens": 5, "cost_in_usd_ticks": 800000000}})
			}))
			defer server.Close()
			endpoint = server.URL
			s := &runtimev1.ImageGenerateScenarioSpec{Prompt: "a boat", N: proto.Int32(2), Size: "1k", Quality: "auto", AspectRatio: "auto", ResponseFormat: "b64_json"}
			var receipt *NativeTaskReceipt
			ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
			if mode == "owned-edit" {
				s.ReferenceImageArtifactId = "owned"
				sum := sha256.Sum256(data)
				ref := &CapturedMediaReference{ArtifactID: "owned", MIMEType: "image/png", Bytes: data, SHA256: hex.EncodeToString(sum[:])}
				if err := ValidateCloudImageReferenceRequest("xai", capabilitydriver.XAIImage2Model, s, ref); err != nil {
					t.Fatal(err)
				}
				ctx = WithImageReference(ctx, ref)
			}
			if mode == "multi-edit" {
				s.ReferenceImages = []string{"https://images.example/first.png", "https://images.example/second.webp"}
			}
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: s}}}
			cfg := MediaAdapterConfig{BaseURL: server.URL + "/gateway/v1", APIKey: "fixture", AllowLoopbackEndpoint: true}
			_, _, id, err := ExecuteXAIImage(ctx, cfg, request, capabilitydriver.XAIImage2Model)
			if !errors.Is(err, ErrNativeTaskYielded) || id != "image_task_1" || receipt == nil || creates.Load() != 1 {
				t.Fatalf("native receipt %v %v", receipt, err)
			}
			if result, done, err := ObserveNativeTask(context.Background(), cfg, receipt); err != nil || done || result != nil {
				t.Fatal("pending was treated as image output")
			}
			observed, done, err := ObserveNativeTask(context.Background(), cfg, receipt)
			if err != nil || !done || len(observed.Artifacts) != 2 || observed.Usage.GetOutputTokens() != 5 {
				t.Fatalf("original result %v %v", observed, err)
			}
			bodies, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, observed)
			if err != nil {
				t.Fatal(err)
			}
			for _, artifact := range observed.Artifacts {
				body := bodies[artifact.GetArtifactId()]
				raw, err := io.ReadAll(body.Stream)
				body.Stream.Close()
				if err != nil || !bytes.Equal(raw, data) || artifact.GetUri() != "" || artifact.GetMimeType() != "image/png" || artifact.GetWidth() != 64 || artifact.GetMetadata().GetFields()["provider_cost_in_usd_ticks"].GetStringValue() != "800000000" {
					t.Fatalf("owned image facts %+v %v", artifact, err)
				}
			}
			if creates.Load() != 1 || queries.Load() != 2 || downloads.Load() != 2 {
				t.Fatal("original work replayed or artifact set truncated")
			}
		})
	}
}
func TestXAIVideoNativeTaskUsesExactModelAndAudioSetting(t *testing.T) {
	for _, model := range []string{capabilitydriver.XAIVideo15Model, capabilitydriver.XAIVideo15LiteModel, capabilitydriver.XAIVideo1Model} {
		t.Run(model, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "POST" {
					var body map[string]any
					json.NewDecoder(r.Body).Decode(&body)
					if r.URL.Path != "/v1/videos/generations" || body["model"] != model || body["generate_audio"] != false || body["duration"] != float64(8) || body["resolution"] != "720p" {
						t.Errorf("video native payload %+v", body)
					}
					json.NewEncoder(w).Encode(map[string]any{"request_id": "video_task_1"})
					return
				}
				if r.URL.Path != "/v1/videos/video_task_1" {
					t.Error("wrong original query")
				}
				json.NewEncoder(w).Encode(map[string]any{"status": "done", "model": model, "video": map[string]any{"url": "https://media.example/video.mp4", "duration": 8, "respect_moderation": true}})
			}))
			defer server.Close()
			s := &runtimev1.VideoGenerateScenarioSpec{Prompt: "a boat", Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(8), Resolution: "720p", GenerateAudio: proto.Bool(false)}}
			request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: s}}}
			var receipt *NativeTaskReceipt
			ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
			cfg := MediaAdapterConfig{BaseURL: server.URL + "/v1", APIKey: "fixture", AllowLoopbackEndpoint: true}
			_, _, _, err := ExecuteXAIVideo(ctx, cfg, request, model)
			if !errors.Is(err, ErrNativeTaskYielded) {
				t.Fatal(err)
			}
			observed, done, err := ObserveNativeTask(context.Background(), cfg, receipt)
			if err != nil || !done || len(observed.Artifacts) != 1 || observed.Artifacts[0].DurationMs != 8000 || observed.Artifacts[0].Width != 0 || observed.Usage != nil || calls.Load() != 2 {
				t.Fatalf("native video result %v %v", observed, err)
			}
			if outcome, err := DeleteProviderAsyncTask(context.Background(), AdapterXAIVideo, receipt.TaskID, cfg); err != nil || outcome != ProviderTaskCleanupUnsupported || calls.Load() != 2 {
				t.Fatal("invented upstream cancel")
			}
		})
	}
}
func TestXAIMediaQueryRejectsInvalidOrFailedOriginalResults(t *testing.T) {
	for _, tc := range []struct {
		name, adapter, model string
		body                 map[string]any
		done                 bool
		reason               runtimev1.ReasonCode
	}{
		{"wrong image id", AdapterXAIImage, capabilitydriver.XAIImage2Model, map[string]any{"request_id": "another", "status": "pending"}, false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
		{"failed task", AdapterXAIVideo, capabilitydriver.XAIVideo15Model, map[string]any{"status": "failed", "error": map[string]any{"code": "service_unavailable"}}, true, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE},
		{"moderated video", AdapterXAIVideo, capabilitydriver.XAIVideo15Model, map[string]any{"status": "done", "model": capabilitydriver.XAIVideo15Model, "video": map[string]any{"url": "https://media.example/file.mp4", "duration": 8, "respect_moderation": false}}, true, runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED},
		{"wrong video model", AdapterXAIVideo, capabilitydriver.XAIVideo15Model, map[string]any{"status": "done", "model": capabilitydriver.XAIVideo1Model}, false, runtimev1.ReasonCode_AI_OUTPUT_INVALID},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", "application/json")
				json.NewEncoder(w).Encode(tc.body)
			}))
			defer server.Close()
			query, mime := xaiVideoQueryPath, "video/mp4"
			if tc.adapter == AdapterXAIImage {
				query, mime = xaiImageQueryPath, "image/jpeg"
			}
			receipt := &NativeTaskReceipt{Version: 1, Adapter: tc.adapter, Model: tc.model, TaskID: "original", QueryPathTemplate: query, Artifact: BinaryArtifact(mime, nil, nil)}
			_, done, err := ObserveNativeTask(context.Background(), MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}, receipt)
			if reason, _ := grpcerr.ExtractReasonCode(err); reason != tc.reason || done != tc.done {
				t.Fatalf("failure classification %v %v %v", reason, done, err)
			}
		})
	}
}
func TestXAIImageCustodyRejectsHTMLAndControlRedirectDoesNotFollow(t *testing.T) {
	var redirected atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/landing" {
			redirected.Add(1)
		}
		if r.URL.Path == "/v1/images/task" {
			w.Header().Set("Location", "/landing")
			w.WriteHeader(302)
			return
		}
		w.Header().Set("Content-Type", "image/png")
		fmt.Fprint(w, "<html>not an image</html>")
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture", AllowLoopbackEndpoint: true}
	receipt := &NativeTaskReceipt{Version: 1, Adapter: AdapterXAIImage, Model: capabilitydriver.XAIImage2Model, TaskID: "task", QueryPathTemplate: xaiImageQueryPath, Artifact: BinaryArtifact("image/jpeg", nil, nil)}
	if _, _, err := ObserveNativeTask(context.Background(), cfg, receipt); err == nil || redirected.Load() != 0 {
		t.Fatal("credentialed control redirect followed")
	}
	artifact := proto.Clone(receipt.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = server.URL + "/bad.png"
	if _, err := OpenNativeTaskArtifacts(context.Background(), cfg, receipt, &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}); err == nil {
		t.Fatal("non-image body became a generated image")
	}
}
