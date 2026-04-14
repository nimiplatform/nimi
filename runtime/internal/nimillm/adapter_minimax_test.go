package nimillm

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

func TestExecuteMiniMaxTaskPreservesNonNotFoundTTSFailureAcrossFallbacks(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/t2a_v2":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"text": "not-audio",
			})
		case "/v1/audio/speech":
			http.NotFound(w, r)
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	_, _, _, err := ExecuteMiniMaxTask(
		context.Background(),
		MediaAdapterConfig{BaseURL: server.URL, APIKey: "test-key"},
		nil,
		"job-1",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text: "hello world",
					},
				},
			},
		},
		"minimax/speech-1",
		func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil },
	)
	if err == nil {
		t.Fatal("expected TTS fallback failure")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
		t.Fatalf("unexpected reason: ok=%v reason=%v err=%v", ok, reason, err)
	}
}

func TestExecuteMiniMaxTaskReturnsCanceledOnContextCancelWhilePolling(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/video_generation":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "minimax-task-1"})
		case r.Method == http.MethodGet && r.URL.Path == "/v1/query/video_generation":
			if got := r.URL.Query().Get("task_id"); got != "minimax-task-1" {
				t.Fatalf("unexpected task_id query: %q", got)
			}
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{"status": "queued"})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, _, providerJobID, err := ExecuteMiniMaxTask(
		ctx,
		MediaAdapterConfig{BaseURL: server.URL, APIKey: "minimax-key"},
		noopJobStateUpdater{},
		"job-minimax-video-cancel",
		newAsyncVideoJobRequest("A short MiniMax scene."),
		"minimax-video-model",
		func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil },
	)
	if providerJobID != "minimax-task-1" {
		t.Fatalf("unexpected provider job id: %q", providerJobID)
	}
	if status.Code(err) != codes.Canceled {
		t.Fatalf("expected canceled status, got %v err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_ACTION_EXECUTED {
		t.Fatalf("expected ACTION_EXECUTED cancel reason, got err=%v reason=%v ok=%v", err, reason, ok)
	}
}
