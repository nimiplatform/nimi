package runtimeagent

import (
	"context"
	"strings"

	"github.com/nimiplatform/nimi/runtime/internal/executionintent"
)

func withPublicChatExecutionIntent(ctx context.Context, binding publicChatExecutionBinding, capabilityContract string) context.Context {
	intent := executionintent.Intent{
		CapabilityContract: strings.TrimSpace(capabilityContract),
		Route:              binding.RoutePolicy,
	}
	if binding.TargetRef != nil {
		intent.CloudTarget = binding.TargetRef.GetCloud().Clone()
	}
	return executionintent.WithIntent(ctx, intent)
}
