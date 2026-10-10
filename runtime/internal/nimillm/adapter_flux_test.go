package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestFluxFreezesReturnedPollingURLAndUsesNativeAuthentication(t *testing.T) {
	var creates, queries, bodies atomic.Int32
	var endpoint string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("x-key") != "original-key" || r.Header.Get("Authorization") != "" {
			t.Error("incorrect BFL native authentication")
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/v1/flux-pro":
			creates.Add(1)
			json.NewEncoder(w).Encode(map[string]any{"id": "original", "polling_url": endpoint + "/v1/get_result?id=original"})
		case "/v1/get_result":
			queries.Add(1)
			if r.URL.Query().Get("id") != "original" {
				t.Error("original task selector lost")
			}
			json.NewEncoder(w).Encode(map[string]any{"id": "original", "status": "Ready", "result": map[string]any{"sample": endpoint + "/output"}})
		case "/output":
			bodies.Add(1)
		default:
			t.Errorf("unexpected native endpoint: %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	endpoint = server.URL
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	cfg := MediaAdapterConfig{BaseURL: endpoint, APIKey: "original-key", AllowLoopbackEndpoint: true}
	request := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_IMAGE_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_ImageGenerate{ImageGenerate: &runtimev1.ImageGenerateScenarioSpec{Prompt: "a cup"}}}}
	_, _, id, err := ExecuteFluxImage(ctx, cfg, noopJobStateUpdater{}, "job", request, "flux-pro")
	if !errors.Is(err, ErrNativeTaskYielded) || id != "original" || queries.Load() != 0 {
		t.Fatalf("create did not hand off: %v", err)
	}
	result, terminal, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !terminal || len(result.GetArtifacts()) != 1 || result.Artifacts[0].GetUri() != endpoint+"/output" || creates.Load() != 1 || queries.Load() != 1 || bodies.Load() != 0 {
		t.Fatalf("native query/body boundary: %v %v", result, err)
	}
}

func TestFluxPollingURLCannotRetargetCredential(t *testing.T) {
	base := "https://api.bfl.ai"
	for _, uri := range []string{"https://evil.test/v1/get_result?id=original", "https://api.bfl.ai.evil.test/v1/get_result?id=original", "https://user@api.bfl.ai/v1/get_result?id=original", "https://api.bfl.ai/v1/get_result?id=other", "https://api.bfl.ai/v1/get_result?id=original&token=extra", "https://api.bfl.ai:444/v1/get_result?id=original", "http://api.bfl.ai/v1/get_result?id=original"} {
		if validFluxPollingURL(base, uri, "original", false) {
			t.Fatalf("unbound credential target accepted: %s", uri)
		}
	}
	if !validFluxPollingURL(base, "https://api.eu2.bfl.ai/v1/get_result?id=original", "original", false) {
		t.Fatal("documented cluster receipt rejected")
	}
}
