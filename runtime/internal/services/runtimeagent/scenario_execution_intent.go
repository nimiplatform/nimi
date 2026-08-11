package runtimeagent

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
)

func withPublicChatExecutionIntent(ctx context.Context, binding publicChatExecutionBinding, capabilityContract string) context.Context {
	capabilityContract = strings.TrimSpace(capabilityContract)
	captured := executionintent.Clone(binding.ExecutionIntent)
	if captured.CapabilityContract == capabilityContract && captured.Route == binding.RoutePolicy &&
		(captured.IsLocal() || captured.IsAIConfigCloud()) {
		ctx = executionintent.WithIntent(ctx, captured)
		if captured.IsLocal() && binding.LocalExecution != nil {
			ctx = localexecution.WithSelectedLocalExecution(ctx, binding.LocalExecution)
		}
		return ctx
	}
	// Local carries no private target. Cloud without an exact private AIConfig
	// intent stays intentionally incomplete and fails closed downstream.
	fallback := executionintent.Intent{
		CapabilityContract: capabilityContract,
		RequiredFeatures:   append([]string(nil), binding.RequiredFeatures...),
		Defaults:           clonePublicChatSelectedParams(binding.SelectedParams),
		Route:              binding.RoutePolicy,
	}
	ctx = executionintent.WithIntent(ctx, fallback)
	if fallback.IsLocal() && binding.LocalAIConfigIntent && binding.LocalExecution != nil {
		ctx = localexecution.WithSelectedLocalExecution(ctx, binding.LocalExecution)
	}
	return ctx
}
