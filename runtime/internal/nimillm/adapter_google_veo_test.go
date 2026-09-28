package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestGoogleVeoOperationUsesNativeAuthPollAndResultShape(t *testing.T) {
	const model = "veo-3.1-fast-generate-preview"
	const operation = "models/veo-3.1-fast-generate-preview/operations/abc_123"
	const videoURL = "https://generativelanguage.googleapis.com/v1beta/files/video_123:download?alt=media"
	var polls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-goog-api-key") != "fixture-key" || r.Header.Get("Authorization") != "" {
			t.Errorf("Google native authentication was not used")
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1beta/models/"+model+":predictLongRunning":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode submission: %v", err)
			}
			params, _ := body["parameters"].(map[string]any)
			if params["aspectRatio"] != "16:9" || params["durationSeconds"] != float64(4) || params["resolution"] != "720p" {
				t.Errorf("unexpected submission parameters: %+v", params)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"name": operation})
		case r.Method == http.MethodGet && r.URL.Path == "/v1beta/"+operation:
			if polls.Add(1) == 1 {
				_ = json.NewEncoder(w).Encode(map[string]any{"name": operation, "done": false})
			} else {
				_ = json.NewEncoder(w).Encode(map[string]any{"name": operation, "done": true, "response": map[string]any{"generateVideoResponse": map[string]any{"generatedSamples": []any{map[string]any{"video": map[string]any{"uri": videoURL}}}}}})
			}
		default:
			t.Errorf("unexpected Google Veo request: %s %s", r.Method, r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	ctx := WithProviderPollWait(context.Background(), func(context.Context, time.Duration) error { return nil })
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "A sunrise.", Mode: runtimev1.VideoMode_VIDEO_MODE_T2V}}}}
	artifacts, _, providerJobID, err := ExecuteGoogleVeoOperation(ctx, MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture-key", AllowLoopbackEndpoint: true}, noopGeminiJobUpdater{}, "job-1", request, model)
	if err != nil || providerJobID != operation || polls.Load() != 2 || len(artifacts) != 1 || artifacts[0].GetUri() != videoURL {
		t.Fatalf("Google Veo native operation result: job=%q polls=%d artifacts=%+v err=%v", providerJobID, polls.Load(), artifacts, err)
	}
	if artifacts[0].GetMetadata() == nil || artifacts[0].GetMetadata().AsMap()["uri"] != nil || len(artifacts[0].GetBytes()) != 0 {
		t.Fatal("provider URL leaked into persisted metadata or skipped body detachment")
	}
}

func TestGoogleVeoArtifactURLRejectsCredentialExfiltrationTargets(t *testing.T) {
	good := "https://generativelanguage.googleapis.com/v1beta/files/video_123:download?alt=media"
	if !validGoogleVeoArtifactURL(good) {
		t.Fatal("official Google file download rejected")
	}
	bad := []string{
		"https://evil.example/v1beta/files/video_123:download?alt=media",
		"https://generativelanguage.googleapis.com.evil.example/v1beta/files/video_123:download?alt=media",
		"https://generativelanguage.googleapis.com:443/v1beta/files/video_123:download?alt=media",
		"https://generativelanguage.googleapis.com/v1beta/files/video_123:download?alt=media&key=leak",
		"https://generativelanguage.googleapis.com/v1beta/files/%2e%2e:download?alt=media",
		"http://generativelanguage.googleapis.com/v1beta/files/video_123:download?alt=media",
	}
	for _, raw := range bad {
		if validGoogleVeoArtifactURL(raw) {
			t.Fatalf("credential-bearing artifact URL accepted: %s", raw)
		}
	}
}

func TestGoogleVeoOperationRejectsMissingModelWithoutDispatch(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		requests.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()
	request := &runtimev1.SubmitScenarioJobRequest{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE,
		Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{
			VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Prompt: "orbiting satellite"},
		}},
	}
	config := MediaAdapterConfig{BaseURL: server.URL, APIKey: "fixture-key", AllowLoopbackEndpoint: true}

	_, _, _, err := ExecuteGoogleVeoOperation(context.Background(), config, nil, "job-1", request, " ")
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MODEL_ID_REQUIRED {
		t.Fatalf("missing Veo model must fail typed, got reason=%v ok=%v err=%v", reason, ok, err)
	}
	if got := requests.Load(); got != 0 {
		t.Fatalf("missing Veo model dispatched %d provider requests", got)
	}
}
