package nimillm

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

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
