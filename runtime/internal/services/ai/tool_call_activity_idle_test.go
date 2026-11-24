package ai

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
)

// TestLocalTextStreamToolCallActivityRefreshesIdleWithoutPublicPayload verifies
// v2.1's 30s Idle liveness fix: transient ToolCallActivity heartbeats emitted
// via the context observer keep a long streaming tool-call argument generation
// alive past streamFirstPacketTimeout and streamIdleTimeout while emitting zero
// premature public text payloads before the final tool/text payload arrives.
func TestLocalTextStreamToolCallActivityRefreshesIdleWithoutPublicPayload(t *testing.T) {
	svc := newTestService(nil)
	svc.streamFirstPacketTimeout = 40 * time.Millisecond
	svc.streamIdleTimeout = 40 * time.Millisecond
	svc.SetLocalExecutionResolver(&mutableLocalExecutionResolver{projection: selectedTextExecutionForTest(t, "tool-activity-idle", "tool-activity.gguf")})
	svc.SetLocalTextExecutionHost(&localTextHostStub{
		streamFn: func(ctx context.Context, onDelta func(localexecution.TextDelta) error) (localexecution.TextResult, error) {
			observer := textbehavior.ToolCallActivityObserverFromContext(ctx)
			if observer == nil {
				t.Fatalf("expected ToolCallActivityObserver in stream context")
			}
			// Stream 6 transient tool-argument heartbeats spaced 20ms apart (= 120ms > 40ms idle timeout).
			// No public text delta is emitted during this window.
			for i := 0; i < 6; i++ {
				select {
				case <-ctx.Done():
					return localexecution.TextResult{}, &localexecution.ExecutionError{Kind: localexecution.FailureCanceled, Err: ctx.Err()}
				case <-time.After(20 * time.Millisecond):
				}
				if err := observer(textbehavior.ToolCallActivity{
					CallID:              "call_write_large_file",
					ToolName:            "write_file",
					ArgumentsDeltaBytes: 4096,
					AccumulatedBytes:    (i + 1) * 4096,
				}); err != nil {
					return localexecution.TextResult{}, err
				}
			}
			if err := onDelta(localexecution.TextDelta{Text: "done"}); err != nil {
				return localexecution.TextResult{}, err
			}
			return localexecution.TextResult{FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP}, nil
		},
	})

	executeRequest := localTextExecuteRequestForTest()
	executeRequest.Head.TimeoutMs = 2000
	stream := &mockScenarioEventStream{ctx: localTextIntentContext(context.Background(), nil)}
	request := &runtimev1.StreamScenarioRequest{
		Head:          executeRequest.GetHead(),
		ScenarioType:  executeRequest.GetScenarioType(),
		ExecutionMode: runtimev1.ExecutionMode_EXECUTION_MODE_STREAM,
		Spec:          executeRequest.GetSpec(),
	}
	if err := svc.StreamScenario(request, stream); err != nil {
		t.Fatalf("StreamScenario failed despite ToolCallActivity heartbeats: %v", err)
	}
	if len(stream.events) == 0 {
		t.Fatalf("expected stream events")
	}
	last := stream.events[len(stream.events)-1]
	if last.GetCompleted() == nil {
		t.Fatalf("expected Completed terminal event, got %+v", last)
	}
	// Verify no spurious text delta was emitted during the 6 ToolCallActivity pulses;
	// only the single final "done" text delta was emitted.
	textCount := 0
	for _, ev := range stream.events {
		if d := ev.GetDelta().GetTextOutputItem().GetText(); d != nil && d.GetText() != "" {
			textCount++
			if d.GetText() != "done" {
				t.Fatalf("unexpected public delta text %q", d.GetText())
			}
		}
	}
	if textCount != 1 {
		t.Fatalf("expected exactly 1 public text delta, got %d", textCount)
	}
}
