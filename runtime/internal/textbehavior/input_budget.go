package textbehavior

import (
	"context"
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// OwnedMediaInputBudget belongs to one captured invocation. Its limit is
// declared by that dialect; remaining includes native JSON and base64 costs.
type OwnedMediaInputBudget struct{ remaining int64 }

type MaterializationPlanner func(context.Context, *runtimev1.TextGenerateScenarioSpec, bool) (*runtimev1.TextGenerateScenarioSpec, *OwnedMediaInputBudget, error)

func NewOwnedMediaInputBudget(limit, overhead int64) (*OwnedMediaInputBudget, error) {
	if limit <= 0 || overhead < 0 || overhead > limit {
		return nil, inputBudgetExceeded()
	}
	return &OwnedMediaInputBudget{remaining: limit - overhead}, nil
}

func (b *OwnedMediaInputBudget) Reserve(size int64) error {
	if b == nil {
		return nil
	}
	if size <= 0 || size > math.MaxInt64/4*3-2 {
		return inputBudgetExceeded()
	}
	encoded := (size + 2) / 3 * 4
	if encoded > b.remaining {
		return inputBudgetExceeded()
	}
	b.remaining -= encoded
	return nil
}

type ownedMediaInputBudgetKey struct{}

func WithOwnedMediaInputBudget(ctx context.Context, budget *OwnedMediaInputBudget) context.Context {
	if budget == nil {
		return ctx
	}
	return context.WithValue(ctx, ownedMediaInputBudgetKey{}, budget)
}
func ReserveOwnedMediaInput(ctx context.Context, size int64) error {
	if ctx == nil {
		return nil
	}
	budget, _ := ctx.Value(ownedMediaInputBudgetKey{}).(*OwnedMediaInputBudget)
	return budget.Reserve(size)
}
func inputBudgetExceeded() error {
	return grpcerr.WithReasonCodeOptions(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID, grpcerr.ReasonOptions{Message: "The captured model's inline media request budget is exceeded", ActionHint: "use_smaller_owned_media_inputs"})
}
