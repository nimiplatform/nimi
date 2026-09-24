package localexecution

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

// TextDecisionResult is the typed outcome of one captured Local text.decide
// invocation together with Runtime-measured usage facts.
type TextDecisionResult struct {
	Result      *runtimev1.TextDecisionResult
	InputTokens int64
	ComputeMS   int64
}

// TextDecisionExecutionHost executes only immutable captured decision plans in
// its private supervised Worker. It never selects routes, models or devices.
type TextDecisionExecutionHost interface {
	ExecuteTextDecision(context.Context, *capabilitydriver.TextDecisionInvocationPlan) (TextDecisionResult, error)
}
