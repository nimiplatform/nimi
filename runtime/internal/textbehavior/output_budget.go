package textbehavior

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
)

type internalOutputBudgetKey struct{}

// @nimi-authority: rule.nimi.runtime.ai-provider.internal-output-budget
// WithInternalOutputBudget carries a Runtime-owned output reservation, such as
// an Agent turn's context-budget reserve or a Runtime task's output budget,
// from an in-process Runtime owner to text execution. It is not caller intent:
// TextGenerateScenarioSpec.max_tokens remains the caller's hard limit, while
// this budget becomes a provider output limit only where the exact resolved
// target accepts one. External callers cannot set it.
func WithInternalOutputBudget(ctx context.Context, tokens int32) context.Context {
	if ctx == nil || tokens <= 0 {
		return ctx
	}
	return context.WithValue(ctx, internalOutputBudgetKey{}, tokens)
}

func internalOutputBudget(ctx context.Context) int32 {
	if ctx == nil {
		return 0
	}
	tokens, _ := ctx.Value(internalOutputBudgetKey{}).(int32)
	return tokens
}

// ApplyInternalOutputBudget returns the request to send to the resolved
// target. A caller max_tokens is kept exactly, even where the target rejects
// it, so the adapter fails it before dispatch. Otherwise the Runtime budget is
// sent as the output limit when the target's serializer admits one, and
// stays an internal reservation when it does not; timeout, cancellation and
// output completeness checks are unchanged either way. Serialization is a pure
// local check against the adapter's own rules; nothing is dispatched.
func ApplyInternalOutputBudget(
	ctx context.Context,
	spec *runtimev1.TextGenerateScenarioSpec,
	serialize RequestSerializer,
	stream bool,
) *runtimev1.TextGenerateScenarioSpec {
	budget := internalOutputBudget(ctx)
	if spec == nil || spec.MaxTokens != nil || budget <= 0 {
		return spec
	}
	limited, _ := proto.Clone(spec).(*runtimev1.TextGenerateScenarioSpec)
	if limited == nil {
		return spec
	}
	limited.MaxTokens = proto.Int32(budget)
	if serialize == nil {
		// A target without a behavior adapter uses its base protocol, which
		// always carries an output limit.
		return limited
	}
	if _, err := serialize(cloneSpec(limited), stream); err != nil {
		// The unchanged request goes on, so any failure it has surfaces as
		// its own reason rather than as the Runtime budget.
		return spec
	}
	return limited
}
