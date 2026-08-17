package ai

import (
	"context"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/metadata"
	"google.golang.org/grpc/status"
)

type fakeScenarioStreamingSpeechProvider struct{}

func (fakeScenarioStreamingSpeechProvider) StreamSynthesizeSpeech(
	_ context.Context,
	_ string,
	_ *runtimev1.SpeechSynthesizeScenarioSpec,
	_ map[string]any,
	onChunk func(scenarioSpeechStreamChunk) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if onChunk == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, errors.New("missing chunk callback")
	}
	if err := onChunk(scenarioSpeechStreamChunk{
		Sequence:     1,
		MIMEType:     "audio/mpeg",
		SampleRateHz: 24000,
		TraceID:      "trace-001",
		Bytes:        []byte("chunk"),
	}); err != nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_UNSPECIFIED, err
	}
	return &runtimev1.UsageStats{}, runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

var _ scenarioStreamingSpeechProvider = fakeScenarioStreamingSpeechProvider{}

func TestSpeechStreamNativeRequiredFailsClosedWithoutNativeSubstrate(t *testing.T) {
	_, err := speechStreamVoiceOutputMode(true)
	if err == nil {
		t.Fatal("native-required speech stream must fail closed when only simulated stream is available")
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED {
		t.Fatalf("expected AI_ROUTE_UNSUPPORTED, got reason=%v ok=%v err=%v", reason, ok, err)
	}
}

func testStringSliceContains(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}

func TestStreamChunkMinBytes(t *testing.T) {
	// K-STREAM-006: minimum 32 bytes before flushing a text delta.
	if minStreamChunkBytes != 32 {
		t.Fatalf("minStreamChunkBytes = %d, spec requires 32 (K-STREAM-006)", minStreamChunkBytes)
	}
}

type mockScenarioEventStream struct {
	ctx        context.Context
	events     []*runtimev1.StreamScenarioEvent
	sendCount  int
	failSendAt int
	sendErr    error
}

func (m *mockScenarioEventStream) Send(event *runtimev1.StreamScenarioEvent) error {
	m.sendCount++
	if m.failSendAt > 0 && m.sendCount == m.failSendAt {
		return m.sendErr
	}
	m.events = append(m.events, event)
	return nil
}

func (m *mockScenarioEventStream) Context() context.Context {
	return m.ctx
}

func (m *mockScenarioEventStream) SendHeader(_ metadata.MD) error { return nil }
func (m *mockScenarioEventStream) SetHeader(_ metadata.MD) error  { return nil }
func (m *mockScenarioEventStream) SetTrailer(_ metadata.MD)       {}
func (m *mockScenarioEventStream) RecvMsg(any) error              { return nil }
func (m *mockScenarioEventStream) SendMsg(any) error              { return nil }

func TestImmediateScenarioInvalidTimeoutRejectedBeforePublication(t *testing.T) {
	invalidTimeouts := []int32{-1, int32((maxRuntimeRequestTimeout + time.Millisecond) / time.Millisecond)}
	for _, timeoutMS := range invalidTimeouts {
		t.Run((time.Duration(timeoutMS) * time.Millisecond).String(), func(t *testing.T) {
			tests := []struct {
				name string
				run  func(*Service) error
			}{
				{
					name: "execute text",
					run: func(svc *Service) error {
						_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
							Head:          &runtimev1.ScenarioRequestHead{AppId: "app.timeout", SubjectUserId: "user-timeout", TimeoutMs: timeoutMS},
							ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
							ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
							Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
								Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
							}}},
						})
						return err
					},
				},
				{
					name: "execute embed",
					run: func(svc *Service) error {
						_, err := svc.ExecuteScenario(context.Background(), &runtimev1.ExecuteScenarioRequest{
							Head:          &runtimev1.ScenarioRequestHead{AppId: "app.timeout", SubjectUserId: "user-timeout", TimeoutMs: timeoutMS},
							ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_EMBED,
							ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_SYNC,
							Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextEmbed{TextEmbed: &runtimev1.TextEmbedScenarioSpec{
								Inputs: []string{"hello"},
							}}},
						})
						return err
					},
				},
				{
					name: "stream text",
					run: func(svc *Service) error {
						return svc.StreamScenario(&runtimev1.StreamScenarioRequest{
							Head:          &runtimev1.ScenarioRequestHead{AppId: "app.timeout", SubjectUserId: "user-timeout", TimeoutMs: timeoutMS},
							ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_TEXT_GENERATE,
							ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
							Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_TextGenerate{TextGenerate: &runtimev1.TextGenerateScenarioSpec{
								Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
							}}},
						}, &mockScenarioEventStream{ctx: context.Background()})
					},
				},
				{
					name: "stream speech",
					run: func(svc *Service) error {
						return svc.StreamScenario(&runtimev1.StreamScenarioRequest{
							Head:          &runtimev1.ScenarioRequestHead{AppId: "app.timeout", SubjectUserId: "user-timeout", TimeoutMs: timeoutMS},
							ScenarioType:  runtimev1.ScenarioType_SCENARIO_TYPE_SPEECH_SYNTHESIZE,
							ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
							Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{
								SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "hello"},
							}},
						}, &mockScenarioEventStream{ctx: context.Background()})
					},
				},
			}
			for _, test := range tests {
				t.Run(test.name, func(t *testing.T) {
					svc := newTestService(nil)
					err := test.run(svc)
					if status.Code(err) != codes.InvalidArgument {
						t.Fatalf("status=%s err=%v", status.Code(err), err)
					}
					if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED {
						t.Fatalf("reason=%s present=%v err=%v", reason, ok, err)
					}
					if got := len(svc.scenarioJobs.jobs); got != 0 {
						t.Fatalf("invalid timeout published %d Jobs", got)
					}
				})
			}
		})
	}
}
