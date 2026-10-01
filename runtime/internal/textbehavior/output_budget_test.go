package textbehavior

import (
	"context"
	"errors"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

func TestApplyInternalOutputBudget(t *testing.T) {
	admitsLimit := func(*runtimev1.TextGenerateScenarioSpec, bool) (SerializedRequest, error) {
		return SerializedRequest{}, nil
	}
	rejectsLimit := func(spec *runtimev1.TextGenerateScenarioSpec, _ bool) (SerializedRequest, error) {
		if spec.MaxTokens != nil {
			return SerializedRequest{}, errors.New("generation controls are unsupported")
		}
		return SerializedRequest{}, nil
	}
	budgeted := WithInternalOutputBudget(context.Background(), 4096)
	for _, test := range []struct {
		name      string
		ctx       context.Context
		caller    *int32
		serialize RequestSerializer
		want      *int32
	}{
		{name: "base protocol receives the budget", ctx: budgeted, want: proto.Int32(4096)},
		{name: "adapter that admits a limit receives the budget", ctx: budgeted, serialize: admitsLimit, want: proto.Int32(4096)},
		{name: "adapter without output limits keeps the budget internal", ctx: budgeted, serialize: rejectsLimit},
		{name: "caller hard limit is kept exactly", ctx: budgeted, caller: proto.Int32(300), serialize: admitsLimit, want: proto.Int32(300)},
		{name: "caller hard limit is never dropped for a target that rejects it", ctx: budgeted, caller: proto.Int32(300), serialize: rejectsLimit, want: proto.Int32(300)},
		{name: "no budget leaves the request unchanged", ctx: context.Background(), serialize: admitsLimit},
		{name: "a non-positive budget is not carried", ctx: WithInternalOutputBudget(context.Background(), 0)},
	} {
		t.Run(test.name, func(t *testing.T) {
			spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}}, MaxTokens: test.caller}
			original := proto.Clone(spec)
			got := ApplyInternalOutputBudget(test.ctx, spec, test.serialize, true)
			switch {
			case test.want == nil && got.MaxTokens != nil:
				t.Fatalf("max_tokens = %d, want none", got.GetMaxTokens())
			case test.want != nil && (got.MaxTokens == nil || got.GetMaxTokens() != *test.want):
				t.Fatalf("max_tokens = %v, want %d", got.MaxTokens, *test.want)
			}
			if !proto.Equal(spec, original) {
				t.Fatal("the caller's request was mutated")
			}
		})
	}
}
