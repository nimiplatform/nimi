package nimillm

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/png"
	"net/http"
	"net/http/httptest"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

func omniResponse() map[string]any {
	return map[string]any{"id": "v1_created", "object": "interaction", "model": capabilitydriver.GeminiOmniVideoModel, "status": "completed",
		"usage": map[string]any{"total_input_tokens": float64(20), "total_output_tokens": float64(30)},
		"steps": []any{map[string]any{"type": "thought", "content": []any{}}, map[string]any{"type": "model_output", "content": []any{map[string]any{"type": "video", "mime_type": "video/mp4", "uri": "https://generativelanguage.googleapis.com/v1beta/files/video123:download?alt=media"}}}}}
}

func TestGeminiOmniStoredCreationCapturesOriginalResources(t *testing.T) {
	var reference bytes.Buffer
	if err := png.Encode(&reference, image.NewRGBA(image.Rect(0, 0, 2, 2))); err != nil {
		t.Fatal(err)
	}
	creates, queries := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("x-goog-api-key") != "test-key" {
			t.Error("incorrect native auth")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.Method + " " + r.URL.Path {
		case "POST /v1beta/interactions":
			creates++
			var payload map[string]any
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Error(err)
				return
			}
			format := payload["response_format"].(map[string]any)
			if payload["store"] != true || payload["background"] != false || payload["stream"] != false || format["delivery"] != "uri" || format["duration"] != "4s" || format["resolution"] != "4k" {
				t.Errorf("request=%v", payload)
			}
			input := payload["input"].([]any)
			if len(input) != 2 || input[0].(map[string]any)["data"] != base64.StdEncoding.EncodeToString(reference.Bytes()) || input[1].(map[string]any)["text"] != "A toy boat." {
				t.Error("reference or prompt changed")
			}
			_ = json.NewEncoder(w).Encode(omniResponse())
		case "GET /v1beta/files/video123":
			queries++
			state := "PROCESSING"
			if queries == 2 {
				state = "ACTIVE"
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "files/video123", "state": state, "mimeType": "video/mp4"})
		default:
			t.Errorf("unexpected IO %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	duration := int32(4)
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME, Prompt: "A toy boat.", Options: &runtimev1.VideoGenerationOptions{DurationSec: &duration, Resolution: "4k"},
		Content: []*runtimev1.VideoContentItem{{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "data:image/png;base64," + base64.StdEncoding.EncodeToString(reference.Bytes())}}},
	}}}}
	if !MediaUsesNativeTask(AdapterGeminiOmniVideo, request, capabilitydriver.GeminiOmniVideoModel) {
		t.Fatal("original file observation missing")
	}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(loopbackProviderTestContext(context.Background()), func(value *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(value); return nil })
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "test-key", AllowLoopbackEndpoint: true}
	_, err := ExecuteGeminiOmniVideo(ctx, cfg, request, capabilitydriver.GeminiOmniVideoModel)
	if !errors.Is(err, ErrNativeTaskYielded) || receipt == nil || receipt.GeminiInteractionID != "v1_created" || receipt.TaskID != "video123" || queries != 0 {
		t.Fatalf("original capture: %+v %v", receipt, err)
	}
	encoded, _ := json.Marshal(receipt)
	var recovered NativeTaskReceipt
	if err := json.Unmarshal(encoded, &recovered); err != nil || !EqualNativeTaskReceipt(receipt, &recovered) {
		t.Fatal("resource identities lost on recovery")
	}
	if result, done, err := ObserveNativeTask(ctx, cfg, &recovered); err != nil || done || result != nil {
		t.Fatalf("processing %v %v %v", result, done, err)
	}
	if result, done, err := ObserveNativeTask(ctx, cfg, &recovered); err != nil || !done || result.Usage.GetInputTokens() != 20 || len(result.Artifacts) != 1 {
		t.Fatalf("active %v %v %v", result, done, err)
	}
	if creates != 1 || queries != 2 {
		t.Fatal("generation was replayed or unrelated resources were queried")
	}
}

func TestGeminiOmniRejectsIncompleteForeignOrAmbiguousOutput(t *testing.T) {
	for _, mutate := range []func(map[string]any){
		func(v map[string]any) { v["model"] = "veo-3.1-generate-preview" },
		func(v map[string]any) { v["id"] = "../other" },
		func(v map[string]any) { delete(v, "id") },
		func(v map[string]any) { v["status"] = "in_progress" },
		func(v map[string]any) { v["steps"] = []any{} },
		func(v map[string]any) { v["steps"] = append(v["steps"].([]any), v["steps"].([]any)[1]) },
		func(v map[string]any) {
			v["steps"].([]any)[1].(map[string]any)["content"].([]any)[0].(map[string]any)["uri"] = "https://example.com/video.mp4"
		},
		func(v map[string]any) {
			v["steps"].([]any)[1].(map[string]any)["content"].([]any)[0].(map[string]any)["data"] = "inline"
		},
	} {
		response := omniResponse()
		mutate(response)
		if _, err := geminiOmniVideoResult(response, capabilitydriver.GeminiOmniVideoModel); err == nil {
			t.Fatal("invalid output admitted")
		}
	}
}

func TestGeminiOmniCleanupRecordsEachResourceAndContinuesAfterFailure(t *testing.T) {
	for _, fileStatus := range []int{200, 404, 500} {
		t.Run(http.StatusText(fileStatus), func(t *testing.T) {
			paths := []string{}
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				paths = append(paths, r.URL.Path)
				if r.Method != "DELETE" || r.Header.Get("x-goog-api-key") != "test-key" {
					t.Error("unexpected cleanup request")
				}
				if r.URL.Path == "/v1beta/files/video123" {
					w.WriteHeader(fileStatus)
					return
				}
				if r.URL.Path != "/v1beta/interactions/v1_created" {
					t.Error("cleanup escaped original handles")
				}
				w.WriteHeader(200)
			}))
			defer server.Close()
			receipt, err := geminiOmniVideoResult(omniResponse(), capabilitydriver.GeminiOmniVideoModel)
			if err != nil {
				t.Fatal(err)
			}
			result := CleanupGeminiOmniResources(loopbackProviderTestContext(context.Background()), MediaAdapterConfig{BaseURL: server.URL + "/v1beta/openai", APIKey: "test-key", AllowLoopbackEndpoint: true}, receipt)
			if len(paths) != 2 || result.InteractionState != "deleted" || result.Complete() != (fileStatus != 500) {
				t.Fatalf("cleanup=%+v paths=%v", result, paths)
			}
			if fileStatus == 404 && result.FileState != "absent" {
				t.Fatal("absence mislabeled as deletion")
			}
			if fileStatus == 500 && result.FileState != "failed" {
				t.Fatal("cleanup failure hidden")
			}
		})
	}
}

func TestGeminiOmniMalformedCreationCleansKnownInteractionWithoutGuessingFile(t *testing.T) {
	creates, deletes := 0, 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "test-key" {
			t.Error("cleanup credential missing")
		}
		switch r.Method + " " + r.URL.Path {
		case "POST /interactions":
			creates++
			response := omniResponse()
			response["steps"] = []any{}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(response)
		case "DELETE /interactions/v1_created":
			deletes++
			w.WriteHeader(200)
		default:
			t.Errorf("guessed resource or repeated creation: %s %s", r.Method, r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	var observation *ProviderTaskCleanupObservation
	ctx := WithProviderTaskCleanupObserver(loopbackProviderTestContext(context.Background()), func(value ProviderTaskCleanupObservation) { observation = &value })
	ctx = WithNativeTaskPublisher(ctx, func(*NativeTaskReceipt) error { t.Error("invalid output published"); return nil })
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A pond."}}}}
	_, err := ExecuteGeminiOmniVideo(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, request, capabilitydriver.GeminiOmniVideoModel)
	if err == nil || creates != 1 || deletes != 1 || observation == nil || observation.GeminiResources.FileState != "unconfirmed" || observation.GeminiResources.InteractionState != "deleted" {
		t.Fatalf("malformed response cleanup: %v creates=%d deletes=%d observation=%+v", err, creates, deletes, observation)
	}
}

func TestGeminiOmniInterruptedCreationRecordsUnconfirmedCleanup(t *testing.T) {
	entered := make(chan struct{})
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { close(entered); <-release }))
	defer server.Close()
	defer close(release)
	ctx, cancel := context.WithCancel(loopbackProviderTestContext(context.Background()))
	defer cancel()
	var observed *ProviderTaskCleanupObservation
	ctx = WithProviderTaskCleanupObserver(ctx, func(value ProviderTaskCleanupObservation) { observed = &value })
	ctx = WithNativeTaskPublisher(ctx, func(*NativeTaskReceipt) error { t.Error("unknown creation published a handle"); return nil })
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A pond."}}}}
	done := make(chan error, 1)
	go func() {
		_, err := ExecuteGeminiOmniVideo(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key", AllowLoopbackEndpoint: true}, request, capabilitydriver.GeminiOmniVideoModel)
		done <- err
	}()
	<-entered
	cancel()
	err := <-done
	if !IsNativeCreateResponseUnavailable(err) || observed == nil || observed.Outcome != ProviderTaskCleanupUnconfirmed || observed.GeminiResources.FileState != "unconfirmed" || observed.GeminiResources.InteractionState != "unconfirmed" {
		t.Fatalf("unknown cleanup misreported: %v %+v", err, observed)
	}
}
