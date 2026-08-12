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

func TestExecuteMiniMaxTaskMapsVoiceRenderHintSpeed(t *testing.T) {
	var captured map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := json.NewDecoder(r.Body).Decode(&captured); err != nil {
			t.Fatalf("decode request body: %v", err)
		}
		w.Header().Set("Content-Type", "audio/mpeg")
		_, _ = w.Write([]byte("audio"))
	}))
	defer func() { server.Close() }()

	_, _, _, err := ExecuteMiniMaxTask(
		context.Background(),
		MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
		nil,
		"job-hints",
		&runtimev1.SubmitScenarioJobRequest{
			ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
			Spec: &runtimev1.ScenarioSpec{
				Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
					SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{
						Text:  "hello world",
						Speed: testFloat32(0.8),
						VoiceRenderHints: &runtimev1.VoiceRenderHints{
							Speed: 1.25,
						},
					},
				},
			},
		},
		"speech-02-hd",
		func(*runtimev1.SubmitScenarioJobRequest) *structpb.Struct { return nil },
	)
	if err != nil {
		t.Fatalf("ExecuteMiniMaxTask: %v", err)
	}
	voiceSetting, ok := captured["voice_setting"].(map[string]any)
	if !ok {
		t.Fatalf("voice_setting=%T, want object", captured["voice_setting"])
	}
	if got := ValueAsFloat64(voiceSetting["speed"]); got != 1.25 {
		t.Fatalf("voice_setting.speed=%v, want 1.25", voiceSetting["speed"])
	}
}

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
	defer func() { server.Close() }()

	_, _, _, err := ExecuteMiniMaxTask(
		context.Background(),
		MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "test-key"},
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

func TestMiniMaxVideoSubmitPayloadUsesProviderNativeFirstFrameDialect(t *testing.T) {
	duration := int32(6)
	watermark := false
	spec := &runtimev1.VideoGenerateScenarioSpec{
		Mode: runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_FRAME,
		Content: []*runtimev1.VideoContentItem{
			{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_TEXT, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_PROMPT, Text: "A short scene."},
			{Type: runtimev1.VideoContentType_VIDEO_CONTENT_TYPE_IMAGE_URL, Role: runtimev1.VideoContentRole_VIDEO_CONTENT_ROLE_FIRST_FRAME, ImageUrl: &runtimev1.VideoContentImageURL{Url: "https://example.test/first.png"}},
		},
		Options: &runtimev1.VideoGenerationOptions{DurationSec: &duration, Resolution: "768p", Watermark: &watermark},
	}

	payload, err := miniMaxVideoSubmitPayload("MiniMax-Hailuo-2.3", spec)
	if err != nil {
		t.Fatalf("miniMaxVideoSubmitPayload: %v", err)
	}
	if got := ValueAsString(payload["first_frame_image"]); got != "https://example.test/first.png" {
		t.Fatalf("first_frame_image=%q", got)
	}
	if got := ValueAsInt64(payload["duration"]); got != 6 {
		t.Fatalf("duration=%d, want 6", got)
	}
	if got := ValueAsString(payload["resolution"]); got != "768P" {
		t.Fatalf("resolution=%q, want 768P", got)
	}
	if got, ok := payload["aigc_watermark"].(bool); !ok || got {
		t.Fatalf("aigc_watermark=%#v, want false", payload["aigc_watermark"])
	}
	for _, forbidden := range []string{"mode", "content", "duration_sec", "first_frame_uri", "last_frame_uri", "reference_images"} {
		if _, ok := payload[forbidden]; ok {
			t.Fatalf("provider payload must not contain generic field %q: %#v", forbidden, payload)
		}
	}
}

func TestMiniMaxVideoSubmitPayloadRejectsModesOwnedByDifferentProviderModels(t *testing.T) {
	for _, mode := range []runtimev1.VideoMode{
		runtimev1.VideoMode_VIDEO_MODE_I2V_FIRST_LAST,
		runtimev1.VideoMode_VIDEO_MODE_I2V_REFERENCE,
	} {
		t.Run(mode.String(), func(t *testing.T) {
			_, err := miniMaxVideoSubmitPayload("MiniMax-Hailuo-2.3", &runtimev1.VideoGenerateScenarioSpec{
				Mode:   mode,
				Prompt: "A short scene.",
			})
			if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
				t.Fatalf("reason=%v ok=%v err=%v, want AI_ROUTE_UNSUPPORTED", reason, ok, err)
			}
		})
	}
}

func TestMiniMaxVideoSubmitPayloadRejectsUnsupportedGenericOptions(t *testing.T) {
	_, err := miniMaxVideoSubmitPayload("MiniMax-Hailuo-2.3", &runtimev1.VideoGenerateScenarioSpec{
		Mode:   runtimev1.VideoMode_VIDEO_MODE_T2V,
		Prompt: "A short scene.",
		Options: &runtimev1.VideoGenerationOptions{
			Ratio: "16:9",
		},
	})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
		t.Fatalf("reason=%v ok=%v err=%v, want AI_MEDIA_OPTION_UNSUPPORTED", reason, ok, err)
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
	defer func() { server.Close() }()

	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(50 * time.Millisecond)
		cancel()
	}()

	_, _, providerJobID, err := ExecuteMiniMaxTask(
		ctx,
		MediaAdapterConfig{BaseURL: server.URL, AllowLoopbackEndpoint: true, APIKey: "minimax-key"},
		noopJobStateUpdater{},
		"job-minimax-video-cancel",
		newAsyncVideoJobRequest("A short MiniMax scene."),
		"MiniMax-Hailuo-2.3",
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
