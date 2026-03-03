package ai

import (
	"context"
	"io"
	"log/slog"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestResolveMediaAdapterNameKimiImage(t *testing.T) {
	adapter := resolveMediaAdapterName("kimi/moonshot-v1-vision", "moonshot-v1-vision", runtimev1.Modal_MODAL_IMAGE, "")
	if adapter != adapterKimiChatMultimodal {
		t.Fatalf("adapter mismatch: got=%s want=%s", adapter, adapterKimiChatMultimodal)
	}
}

func TestResolveMediaAdapterNameGLMNative(t *testing.T) {
	if adapter := resolveMediaAdapterName("glm/cogview-3", "cogview-3", runtimev1.Modal_MODAL_IMAGE, ""); adapter != adapterGLMNative {
		t.Fatalf("glm image adapter mismatch: got=%s want=%s", adapter, adapterGLMNative)
	}
	if adapter := resolveMediaAdapterName("glm/asr-1", "asr-1", runtimev1.Modal_MODAL_STT, ""); adapter != adapterGLMNative {
		t.Fatalf("glm stt adapter mismatch: got=%s want=%s", adapter, adapterGLMNative)
	}
	if adapter := resolveMediaAdapterName("glm/video-1", "video-1", runtimev1.Modal_MODAL_VIDEO, ""); adapter != adapterGLMTask {
		t.Fatalf("glm video adapter mismatch: got=%s want=%s", adapter, adapterGLMTask)
	}
}

func TestResolveMediaAdapterNameAlibabaAndBytedance(t *testing.T) {
	if adapter := resolveMediaAdapterName("dashscope/wanx-v2", "wanx-v2", runtimev1.Modal_MODAL_IMAGE, ""); adapter != adapterAlibabaNative {
		t.Fatalf("alibaba image adapter mismatch: got=%s want=%s", adapter, adapterAlibabaNative)
	}
	if adapter := resolveMediaAdapterName("dashscope/wan2.2", "wan2.2", runtimev1.Modal_MODAL_VIDEO, ""); adapter != adapterAlibabaNative {
		t.Fatalf("alibaba video adapter mismatch: got=%s want=%s", adapter, adapterAlibabaNative)
	}
	if adapter := resolveMediaAdapterName("volcengine/video-1", "video-1", runtimev1.Modal_MODAL_VIDEO, ""); adapter != adapterBytedanceARKTask {
		t.Fatalf("bytedance video adapter mismatch: got=%s want=%s", adapter, adapterBytedanceARKTask)
	}
	if adapter := resolveMediaAdapterName("volcengine/stt-1", "stt-1", runtimev1.Modal_MODAL_STT, ""); adapter != adapterBytedanceOpenSpeech {
		t.Fatalf("bytedance stt adapter mismatch: got=%s want=%s", adapter, adapterBytedanceOpenSpeech)
	}
}

func TestResolveMediaAdapterNameProviderTypeFallback(t *testing.T) {
	tests := []struct {
		name         string
		modelID      string
		modal        runtimev1.Modal
		providerType string
		want         string
	}{
		{
			name:         "dashscope provider + bare model + TTS",
			modelID:      "qwen3-tts-instruct-flash-2026-01-26",
			modal:        runtimev1.Modal_MODAL_TTS,
			providerType: "dashscope",
			want:         adapterAlibabaNative,
		},
		{
			name:         "dashscope provider + bare model + IMAGE",
			modelID:      "wanx-v2",
			modal:        runtimev1.Modal_MODAL_IMAGE,
			providerType: "dashscope",
			want:         adapterAlibabaNative,
		},
		{
			name:         "volcengine provider + bare model + TTS",
			modelID:      "tts-model-1",
			modal:        runtimev1.Modal_MODAL_TTS,
			providerType: "volcengine",
			want:         adapterBytedanceOpenSpeech,
		},
		{
			name:         "volcengine provider + bare model + VIDEO",
			modelID:      "video-model-1",
			modal:        runtimev1.Modal_MODAL_VIDEO,
			providerType: "volcengine",
			want:         adapterBytedanceARKTask,
		},
		{
			name:         "gemini provider + bare model + IMAGE",
			modelID:      "imagen-3.0-generate-002",
			modal:        runtimev1.Modal_MODAL_IMAGE,
			providerType: "gemini",
			want:         adapterGeminiOperation,
		},
		{
			name:         "empty provider + bare model + TTS falls back to openai compat",
			modelID:      "some-bare-model",
			modal:        runtimev1.Modal_MODAL_TTS,
			providerType: "",
			want:         adapterOpenAICompat,
		},
		{
			name:         "prefix still works with empty provider",
			modelID:      "dashscope/xxx",
			modal:        runtimev1.Modal_MODAL_TTS,
			providerType: "",
			want:         adapterAlibabaNative,
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := resolveMediaAdapterName(tc.modelID, tc.modelID, tc.modal, tc.providerType)
			if got != tc.want {
				t.Fatalf("adapter mismatch: got=%s want=%s", got, tc.want)
			}
		})
	}
}

func TestMediaJobMethodsValidateAndNotFound(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	if _, err := svc.SubmitMediaJob(ctx, nil); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("submit nil request code mismatch: %v", status.Code(err))
	}
	if _, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("submit invalid image spec code mismatch: %v", status.Code(err))
	}
	if _, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal(99),
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
	}); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("submit unsupported modal code mismatch: %v", status.Code(err))
	}

	if _, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("get media job invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("get media job missing code mismatch: %v", status.Code(err))
	}

	if _, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("cancel media job invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("cancel media job missing code mismatch: %v", status.Code(err))
	}

	if _, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{}); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("get artifacts invalid code mismatch: %v", status.Code(err))
	}
	if _, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{JobId: "missing"}); status.Code(err) != codes.NotFound {
		t.Fatalf("get artifacts missing code mismatch: %v", status.Code(err))
	}

	stream := &mediaJobEventCollector{ctx: ctx}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{}, stream); status.Code(err) != codes.InvalidArgument {
		t.Fatalf("subscribe invalid code mismatch: %v", status.Code(err))
	}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: "missing"}, stream); status.Code(err) != codes.NotFound {
		t.Fatalf("subscribe missing code mismatch: %v", status.Code(err))
	}
}

func TestSubmitMediaJobLocalModelUnavailableUsesLocalModelUnavailable(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	svc.SetLocalModelLister(&staticLocalModelLister{models: []*runtimev1.LocalModelRecord{}})

	_, err := svc.SubmitMediaJob(context.Background(), &runtimev1.SubmitMediaJobRequest{
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
			ImageSpec: &runtimev1.ImageGenerationSpec{
				Prompt: "test",
			},
		},
	})
	if err == nil {
		t.Fatalf("expected local model unavailable")
	}
	st, ok := status.FromError(err)
	if !ok {
		t.Fatalf("expected grpc status")
	}
	if st.Code() != codes.FailedPrecondition || st.Message() != runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE.String() {
		t.Fatalf("unexpected error: code=%v msg=%s", st.Code(), st.Message())
	}
}

func TestSubmitMediaJobRangeValidation(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	cases := []struct {
		name string
		req  *runtimev1.SubmitMediaJobRequest
	}{
		{
			name: "image negative n",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/sd3",
				Modal:         runtimev1.Modal_MODAL_IMAGE,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
					ImageSpec: &runtimev1.ImageGenerationSpec{
						Prompt: "test",
						N:      -1,
					},
				},
			},
		},
		{
			name: "video fps overflow",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/video",
				Modal:         runtimev1.Modal_MODAL_VIDEO,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
					VideoSpec: &runtimev1.VideoGenerationSpec{
						Prompt: "test",
						Fps:    121,
					},
				},
			},
		},
		{
			name: "tts invalid sample rate",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/tts",
				Modal:         runtimev1.Modal_MODAL_TTS,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
					SpeechSpec: &runtimev1.SpeechSynthesisSpec{
						Text:         "hello",
						SampleRateHz: 500000,
					},
				},
			},
		},
		{
			name: "stt speaker count overflow",
			req: &runtimev1.SubmitMediaJobRequest{
				AppId:         "nimi.desktop",
				SubjectUserId: "user-001",
				ModelId:       "local/stt",
				Modal:         runtimev1.Modal_MODAL_STT,
				RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
				Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
				Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
					TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{
						AudioBytes:   []byte("audio"),
						SpeakerCount: 33,
					},
				},
			},
		},
	}
	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.SubmitMediaJob(ctx, tc.req)
			if status.Code(err) != codes.InvalidArgument {
				t.Fatalf("invalid request must return invalid argument, got=%v", status.Code(err))
			}
		})
	}
}

func TestCancelMediaJobAndSubscribeLive(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()
	cancelCalled := atomic.Bool{}

	jobID := "job-live"
	created := svc.mediaJobs.create(&runtimev1.MediaJob{
		JobId:         jobID,
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		ModelResolved: "local/sd3",
		TraceId:       "trace-live",
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
	}, func() {
		cancelCalled.Store(true)
	})
	if created == nil {
		t.Fatalf("create media job record")
	}

	stream := &mediaJobEventCollector{ctx: ctx}
	subscribeDone := make(chan error, 1)
	go func() {
		subscribeDone <- svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: jobID}, stream)
	}()
	time.Sleep(20 * time.Millisecond)

	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil)
	cancelResp, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{
		JobId:  jobID,
		Reason: "user canceled",
	})
	if err != nil {
		t.Fatalf("cancel media job: %v", err)
	}
	if cancelResp.GetJob().GetStatus() != runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_CANCELED {
		t.Fatalf("cancel status mismatch: %v", cancelResp.GetJob().GetStatus())
	}
	if cancelResp.GetJob().GetReasonDetail() != "user canceled" {
		t.Fatalf("cancel reason mismatch: %s", cancelResp.GetJob().GetReasonDetail())
	}

	select {
	case err := <-subscribeDone:
		if err != nil {
			t.Fatalf("subscribe media job events: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("subscribe media job events timeout")
	}
	if !cancelCalled.Load() {
		t.Fatalf("expected cancel function to be invoked")
	}
	if len(stream.snapshot()) < 3 {
		t.Fatalf("expected at least submitted/running/canceled events, got %d", len(stream.snapshot()))
	}
}

func TestSubscribeMediaJobEventsTerminalBacklog(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	jobID := "job-terminal"
	if svc.mediaJobs.create(&runtimev1.MediaJob{
		JobId:         jobID,
		AppId:         "nimi.desktop",
		SubjectUserId: "user-001",
		ModelId:       "local/sd3",
		Modal:         runtimev1.Modal_MODAL_IMAGE,
		RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
		ModelResolved: "local/sd3",
		TraceId:       "trace-terminal",
		Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
	}, nil) == nil {
		t.Fatalf("create media job record")
	}
	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_RUNNING, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_RUNNING, nil)
	_, _ = svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, nil)

	stream := &mediaJobEventCollector{ctx: context.Background()}
	if err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: jobID}, stream); err != nil {
		t.Fatalf("subscribe terminal backlog: %v", err)
	}
	events := stream.snapshot()
	if len(events) < 3 {
		t.Fatalf("expected backlog events, got %d", len(events))
	}
	if events[len(events)-1].GetEventType() != runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED {
		t.Fatalf("expected terminal completed event, got %v", events[len(events)-1].GetEventType())
	}
}

func TestReasonCodeFromMediaErrorMapping(t *testing.T) {
	cases := []struct {
		name string
		err  error
		want runtimev1.ReasonCode
	}{
		{
			name: "nil",
			err:  nil,
			want: runtimev1.ReasonCode_ACTION_EXECUTED,
		},
		{
			name: "deadline",
			err:  status.Error(codes.DeadlineExceeded, "deadline"),
			want: runtimev1.ReasonCode_AI_PROVIDER_TIMEOUT,
		},
		{
			name: "not found",
			err:  status.Error(codes.NotFound, "missing"),
			want: runtimev1.ReasonCode_AI_MODEL_NOT_FOUND,
		},
		{
			name: "failed precondition",
			err:  status.Error(codes.FailedPrecondition, "unsupported"),
			want: runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED,
		},
		{
			name: "invalid argument",
			err:  status.Error(codes.InvalidArgument, "bad request"),
			want: runtimev1.ReasonCode_AI_INPUT_INVALID,
		},
		{
			name: "message enum",
			err:  grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE),
			want: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		},
		{
			name: "non status",
			err:  io.EOF,
			want: runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE,
		},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			if got := reasonCodeFromMediaError(tc.err); got != tc.want {
				t.Fatalf("reason code mismatch: got=%v want=%v", got, tc.want)
			}
		})
	}
}

func TestMediaJobReasonCodeClassification(t *testing.T) {
	svc := newTestService(slog.New(slog.NewTextHandler(io.Discard, nil)))
	ctx := context.Background()

	t.Run("GetMediaJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.GetMediaJob(ctx, &runtimev1.GetMediaJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelMediaJob_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("GetMediaArtifacts_NotFound_ReasonCode", func(t *testing.T) {
		_, err := svc.GetMediaArtifacts(ctx, &runtimev1.GetMediaArtifactsRequest{JobId: "nonexistent"})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubscribeMediaJobEvents_NotFound_ReasonCode", func(t *testing.T) {
		stream := &mediaJobEventCollector{ctx: ctx}
		err := svc.SubscribeMediaJobEvents(&runtimev1.SubscribeMediaJobEventsRequest{JobId: "nonexistent"}, stream)
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_FOUND {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_FOUND, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("CancelMediaJob_NotCancellable_ReasonCode", func(t *testing.T) {
		jobID := "job-completed-for-cancel"
		created := svc.mediaJobs.create(&runtimev1.MediaJob{
			JobId:         jobID,
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			RouteDecision: runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			ModelResolved: "local/sd3",
			TraceId:       "trace-completed",
			Status:        runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_SUBMITTED,
		}, func() {})
		if created == nil {
			t.Fatal("create media job record")
		}
		svc.mediaJobs.transition(jobID, runtimev1.MediaJobStatus_MEDIA_JOB_STATUS_COMPLETED, runtimev1.MediaJobEventType_MEDIA_JOB_EVENT_COMPLETED, nil)

		_, err := svc.CancelMediaJob(ctx, &runtimev1.CancelMediaJobRequest{JobId: jobID})
		if err == nil {
			t.Fatal("expected error canceling completed job")
		}
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_JOB_NOT_CANCELLABLE {
			t.Fatalf("expected AI_MEDIA_JOB_NOT_CANCELLABLE, got %v (ok=%v)", reason, ok)
		}
		if status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FailedPrecondition, got %v", status.Code(err))
		}
	})

	t.Run("SubmitMediaJob_SpecInvalid_MissingSpec", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_SpecInvalid_ModalUnspecified", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_UNSPECIFIED,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_SPEC_INVALID {
			t.Fatalf("expected AI_MEDIA_SPEC_INVALID, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_ImageN", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/sd3",
			Modal:         runtimev1.Modal_MODAL_IMAGE,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_ImageSpec{
				ImageSpec: &runtimev1.ImageGenerationSpec{Prompt: "test", N: 17},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_VideoFps", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/video",
			Modal:         runtimev1.Modal_MODAL_VIDEO,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_VideoSpec{
				VideoSpec: &runtimev1.VideoGenerationSpec{Prompt: "test", Fps: 121},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_TtsSampleRate", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/tts",
			Modal:         runtimev1.Modal_MODAL_TTS,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_SpeechSpec{
				SpeechSpec: &runtimev1.SpeechSynthesisSpec{Text: "hello", SampleRateHz: 500000},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})

	t.Run("SubmitMediaJob_OptionUnsupported_SttSpeakerCount", func(t *testing.T) {
		_, err := svc.SubmitMediaJob(ctx, &runtimev1.SubmitMediaJobRequest{
			AppId:         "nimi.desktop",
			SubjectUserId: "user-001",
			ModelId:       "local/stt",
			Modal:         runtimev1.Modal_MODAL_STT,
			RoutePolicy:   runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME,
			Fallback:      runtimev1.FallbackPolicy_FALLBACK_POLICY_DENY,
			Spec: &runtimev1.SubmitMediaJobRequest_TranscriptionSpec{
				TranscriptionSpec: &runtimev1.SpeechTranscriptionSpec{AudioBytes: []byte("audio"), SpeakerCount: 33},
			},
		})
		reason, ok := grpcerr.ExtractReasonCode(err)
		if !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
			t.Fatalf("expected AI_MEDIA_OPTION_UNSUPPORTED, got %v (ok=%v)", reason, ok)
		}
	})
}
