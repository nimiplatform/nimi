package nimillm

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync/atomic"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/protobuf/proto"
)

func TestMiniMaxH3V2OriginalTaskUsesCapturedGatewayAndReportedIdentity(t *testing.T) {
	var creates, queries, downloads atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer key" || r.URL.Query().Get("tenant") != "example" {
			t.Errorf("lost original control scope: %s", r.URL)
		}
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "POST" && r.URL.Path == "/gateway/v2/video_generation":
			creates.Add(1)
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Error(err)
			}
			want := map[string]any{"model": "MiniMax-H3", "content": []any{map[string]any{"type": "text", "text": "A lake."}}, "resolution": "768P", "duration": float64(5), "ratio": "16:9", "aigc_watermark": false}
			if !reflect.DeepEqual(body, want) {
				t.Errorf("wrong native v2 body: %+v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{"task_id": "original"})
		case r.Method == "GET" && r.URL.Path == "/gateway/v2/query/video_generation/original":
			queries.Add(1)
			_ = json.NewEncoder(w).Encode(map[string]any{"task": map[string]any{"id": "original", "model": "MiniMax-H3", "status": "succeeded", "task_type": "generation", "modality": "video", "duration": 5, "content": map[string]any{"url": "https://media.example.test/video.mp4"}, "usage": map[string]any{"prompt_tokens": 100, "completion_tokens": 900, "total_tokens": 1000}}})
		default:
			downloads.Add(1)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	cfg := MediaAdapterConfig{BaseURL: server.URL + "/gateway/v1?tenant=example", APIKey: "key", AllowLoopbackEndpoint: true}
	req := &runtimev1.SubmitScenarioJobRequest{ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_VIDEO_GENERATE, Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_VideoGenerate{VideoGenerate: &runtimev1.VideoGenerateScenarioSpec{Mode: runtimev1.VideoMode_VIDEO_MODE_T2V, Prompt: "A lake.", Options: &runtimev1.VideoGenerationOptions{Resolution: "768p", DurationSec: proto.Int32(5), Ratio: "16:9", Watermark: proto.Bool(false)}}}}}
	var receipt *NativeTaskReceipt
	ctx := WithNativeTaskPublisher(context.Background(), func(r *NativeTaskReceipt) error { receipt = CloneNativeTaskReceipt(r); return nil })
	_, _, id, err := ExecuteMiniMaxH3Video(ctx, cfg, req, "MiniMax-H3")
	if !errors.Is(err, ErrNativeTaskYielded) || id != "original" || receipt == nil || receipt.Model != "MiniMax-H3" || creates.Load() != 1 || queries.Load() != 0 {
		t.Fatalf("original create handoff: %v %v", receipt, err)
	}
	observation, done, err := ObserveNativeTask(context.Background(), cfg, receipt)
	if err != nil || !done || len(observation.GetArtifacts()) != 1 || observation.Artifacts[0].GetUri() != "https://media.example.test/video.mp4" || observation.Artifacts[0].GetDurationMs() != 0 || observation.Usage.GetInputTokens() != 100 || observation.Usage.GetOutputTokens() != 900 || creates.Load() != 1 || queries.Load() != 1 || downloads.Load() != 0 {
		t.Fatalf("native observation=%v done=%v err=%v", observation, done, err)
	}
	// This is control-plane engineering evidence only: no fixture video body
	// is downloaded or presented as successful real generation.
}

func TestMiniMaxH3CancellationAndDeletionAreDifferentOutcomes(t *testing.T) {
	for _, tc := range []struct {
		name, status              string
		want                      ProviderTaskCleanupOutcome
		deletes                   int
		race, wrongID, wrongModel bool
	}{
		{name: "queued", status: "queued", want: ProviderTaskCleanupCanceled, deletes: 1},
		{name: "running", status: "running", want: ProviderTaskCleanupNotCancelable},
		{name: "completed record", status: "succeeded", want: ProviderTaskCleanupResourcesDeleted, deletes: 1},
		{name: "already cancelled", status: "cancelled", want: ProviderTaskCleanupCanceled},
		{name: "queue race", status: "queued", want: ProviderTaskCleanupNotCancelable, deletes: 1, race: true},
		{name: "wrong mutation identity", status: "queued", want: ProviderTaskCleanupUnconfirmed, deletes: 1, wrongID: true},
		{name: "wrong model", status: "queued", want: ProviderTaskCleanupFailed, wrongModel: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var queries, deletes int
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Query().Get("tenant") != "example" || r.Header.Get("Authorization") != "Bearer key" {
					t.Error("captured endpoint/auth lost")
				}
				w.Header().Set("Content-Type", "application/json")
				if r.Method == "GET" && r.URL.Path == "/prefix/v2/query/video_generation/original" {
					queries++
					state := tc.status
					if tc.race && queries > 1 {
						state = "running"
					}
					model := "MiniMax-H3"
					if tc.wrongModel {
						model = "MiniMax-H3-Lite"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"task": map[string]any{"id": "original", "model": model, "status": state}})
					return
				}
				if r.Method == "DELETE" && r.URL.Path == "/prefix/v2/video_generation/original" {
					deletes++
					if tc.race {
						w.WriteHeader(400)
						_ = json.NewEncoder(w).Encode(map[string]any{"error": map[string]any{"type": "bad_request_error"}})
						return
					}
					action := "cancelled"
					if tc.status == "succeeded" {
						action = "deleted"
					}
					id := "original"
					if tc.wrongID {
						id = "other"
					}
					_ = json.NewEncoder(w).Encode(map[string]any{"task_id": id, "action": action, "status": action})
					return
				}
				t.Errorf("unexpected operation: %s %s", r.Method, r.URL.Path)
				w.WriteHeader(404)
			}))
			defer server.Close()
			receipt := &NativeTaskReceipt{TaskID: "original", Model: "MiniMax-H3"}
			outcome, err := CancelMiniMaxH3Task(context.Background(), receipt, MediaAdapterConfig{BaseURL: server.URL + "/prefix/v2?tenant=example", APIKey: "key", AllowLoopbackEndpoint: true})
			if outcome != tc.want || deletes != tc.deletes || queries < 1 || queries > 2 {
				t.Fatalf("outcome=%s err=%v queries=%d deletes=%d", outcome, err, queries, deletes)
			}
		})
	}
}

func TestMiniMaxH3RequiresCredentialAndNeverInventsUsage(t *testing.T) {
	_, _, _, err := ExecuteMiniMaxH3Video(context.Background(), MediaAdapterConfig{BaseURL: "https://api.minimax.cn/v1"}, nil, "MiniMax-H3")
	if reason, _ := grpcerr.ExtractReasonCode(err); reason != runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED {
		t.Fatalf("empty credential=%v", err)
	}
	if value, err := miniMaxH3Usage(map[string]any{"total_seconds": 5}); err != nil || value != nil {
		t.Fatalf("seconds became token usage: %v %v", value, err)
	}
	for _, raw := range []any{map[string]any{"prompt_tokens": 2, "completion_tokens": 3, "total_tokens": 4}, map[string]any{"completion_tokens": -1}, map[string]any{"completion_tokens": 1.5}} {
		if _, err := miniMaxH3Usage(raw); err == nil {
			t.Fatal("invalid usage accepted")
		}
	}
}
