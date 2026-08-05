package ai

import (
	"context"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/metadata"
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
	ctx    context.Context
	events []*runtimev1.StreamScenarioEvent
}

func (m *mockScenarioEventStream) Send(event *runtimev1.StreamScenarioEvent) error {
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
