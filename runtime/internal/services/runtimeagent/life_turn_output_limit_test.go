package runtimeagent

import (
	"context"
	"math"
	"strconv"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textbehavior"
	"google.golang.org/grpc/codes"
)

func TestLifeTurnOutputCapReachesExecutionWithoutReplacingActualUsage(t *testing.T) {
	for _, cap := range []int64{0, 64, math.MaxInt32} {
		t.Run(strconv.FormatInt(cap, 10), func(t *testing.T) {
			ai := &fakeLifeTurnAI{response: &runtimev1.ExecuteScenarioResponse{
				FinishReason: runtimev1.FinishReason_FINISH_REASON_STOP,
				Output: &runtimev1.ScenarioOutput{Output: &runtimev1.ScenarioOutput_TextGenerate{
					TextGenerate: &runtimev1.TextGenerateOutput{Text: `<life-turn><summary>ok</summary></life-turn>`},
				}},
				Usage: &runtimev1.UsageStats{InputTokens: 300, OutputTokens: 12},
			}}
			result, err := NewAIBackedLifeTrackExecutor(ai).ExecuteLifeTrackHook(context.Background(), outputLimitTestRequest(cap))
			if err != nil || len(ai.requests) != 1 {
				t.Fatalf("execution: result=%v err=%v requests=%d", result, err, len(ai.requests))
			}
			spec := ai.requests[0].GetSpec().GetTextGenerate()
			if (spec.MaxTokens == nil) != (cap == 0) {
				t.Fatalf("explicit cap presence = %v for %d", spec.MaxTokens, cap)
			}
			want := int32(cap)
			if cap == 0 {
				want = lifeTurnPromptMaxTokens
			}
			if got := textbehavior.ApplyInternalOutputBudget(ai.contexts[0], spec, nil, false).GetMaxTokens(); got != want {
				t.Fatalf("effective cap = %d, want %d", got, want)
			}
			if result.TokensUsed != 312 {
				t.Fatalf("usage = %d; must retain actual input plus output", result.TokensUsed)
			}
		})
	}
}

func TestLifeTurnRejectsUnrepresentableOutputCapBeforeExecution(t *testing.T) {
	for _, cap := range []int64{-1, math.MaxInt32 + 1} {
		ai := &fakeLifeTurnAI{}
		if _, err := validateAgentAutonomyMutationConfig(outputLimitTestRequest(cap).Autonomy.Config); err == nil {
			t.Fatalf("autonomy accepted invalid cap %d", cap)
		}
		if _, err := NewAIBackedLifeTrackExecutor(ai).ExecuteLifeTrackHook(context.Background(), outputLimitTestRequest(cap)); err == nil || len(ai.requests) != 0 {
			t.Fatalf("invalid cap %d reached execution: err=%v calls=%d", cap, err, len(ai.requests))
		}
	}
}

func TestLifeTurnUnsupportedConfiguredOutputCapDoesNotRetryWithoutLimit(t *testing.T) {
	ai := &fakeLifeTurnAI{err: grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED)}
	result, err := NewAIBackedLifeTrackExecutor(ai).ExecuteLifeTrackHook(context.Background(), outputLimitTestRequest(64))
	if result != nil || err == nil || len(ai.requests) != 1 || ai.requests[0].GetSpec().GetTextGenerate().GetMaxTokens() != 64 {
		t.Fatalf("configured cap failure must not fall back: result=%v err=%v calls=%d", result, err, len(ai.requests))
	}
	if executionErr, ok := err.(*lifeTurnExecutionError); !ok || executionErr.reasonCode != runtimev1.ReasonCode_AI_TEXT_BEHAVIOR_UNSUPPORTED {
		t.Fatalf("original reason lost: %v", err)
	}
}

func outputLimitTestRequest(cap int64) *lifeTurnRequest {
	return &lifeTurnRequest{
		Agent: &runtimev1.LocalAgentRecord{LocalAgentRef: "output-limit-agent"},
		State: &runtimev1.AgentStateProjection{ActiveUserId: "output-limit-user"},
		Hook:  &runtimev1.PendingHook{Intent: &runtimev1.HookIntent{IntentId: "output-limit-hook"}},
		Autonomy: &runtimev1.AgentAutonomyState{Config: &runtimev1.AgentAutonomyConfig{
			Mode: runtimev1.AgentAutonomyMode_AGENT_AUTONOMY_MODE_LOW, MaxTokensPerHook: cap,
		}},
		ExecutionBinding: committedConfigTestBinding,
	}
}

func TestLifeTurnModelTokenEstimateNeverBecomesUsage(t *testing.T) {
	result, err := decodeLifeTurnExecutorResult(`<life-turn><summary>ok</summary><tokens-used>9999</tokens-used></life-turn>`, 0)
	if err != nil || result.TokensUsed != 0 {
		t.Fatalf("model estimate must not become reported usage: result=%v err=%v", result, err)
	}
}
