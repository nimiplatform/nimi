package runtimeagent

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

func withPublicChatExecutionIntent(ctx context.Context, binding publicChatExecutionBinding, capabilityContract string) context.Context {
	capabilityContract = strings.TrimSpace(capabilityContract)
	captured := executionintent.Clone(binding.ExecutionIntent)
	if captured.CapabilityContract == capabilityContract && captured.Route == binding.RoutePolicy &&
		(captured.IsLocal() || captured.IsAIConfigCloud()) {
		return executionintent.WithIntent(ctx, captured)
	}
	// Local carries no private target. Cloud without an exact private AIConfig
	// intent stays intentionally incomplete and fails closed downstream.
	return executionintent.WithIntent(ctx, executionintent.Intent{
		CapabilityContract: capabilityContract,
		RequiredFeatures:   append([]string(nil), binding.RequiredFeatures...),
		Defaults:           clonePublicChatSelectedParams(binding.SelectedParams),
		Route:              binding.RoutePolicy,
	})
}
