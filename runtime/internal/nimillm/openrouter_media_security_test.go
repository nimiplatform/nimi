package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/protobuf/proto"
)

func TestOpenRouterAuthenticatedContentNeverFollowsRedirect(t *testing.T) {
	var otherCalls atomic.Int32
	other := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { otherCalls.Add(1); w.WriteHeader(200) }))
	defer other.Close()
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer private-fixture" {
			t.Error("original auth missing")
		}
		http.Redirect(w, r, other.URL+"/steal", http.StatusFound)
	}))
	defer origin.Close()
	r := &NativeTaskReceipt{Version: 1, Adapter: AdapterOpenRouterVideo, Model: capabilitydriver.OpenRouterVideoModel, TaskID: "original", QueryPathTemplate: openRouterVideoQueryPath, Artifact: BinaryArtifact("video/mp4", nil, nil)}
	a := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	a.Uri = origin.URL + "/v1/videos/original/content?index=0"
	_, err := OpenNativeTaskArtifacts(context.Background(), MediaAdapterConfig{BaseURL: origin.URL + "/v1", APIKey: "private-fixture", AllowLoopbackEndpoint: true}, r, &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{a}})
	if err == nil || otherCalls.Load() != 0 {
		t.Fatal("redirect followed or succeeded", err, otherCalls.Load())
	}
}
func TestOpenRouterRejectedCreateIsNotAnUnknownSubmission(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":{"message":"invalid input"}}`))
	}))
	defer server.Close()
	ctx := WithNativeTaskPublisher(context.Background(), func(*NativeTaskReceipt) error { t.Fatal("rejected create published a receipt"); return nil })
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "test", Options: &runtimev1.VideoGenerationOptions{DurationSec: proto.Int32(3)}}}}}
	_, _, _, err := ExecuteOpenRouterVideo(ctx, MediaAdapterConfig{BaseURL: server.URL + "/v1", APIKey: "fixture", AllowLoopbackEndpoint: true}, req, capabilitydriver.OpenRouterVideoModel)
	if err == nil || IsNativeCreateResponseUnavailable(err) {
		t.Fatal("explicit refusal became unknown submission", err)
	}
}
