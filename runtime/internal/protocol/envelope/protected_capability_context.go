package envelope

import (
	"context"
	"strings"
)

type protectedCapabilityContextKey struct{}

type protectedCapabilityContextValue struct {
	appID      string
	capability string
}

func WithValidatedProtectedCapability(ctx context.Context, appID string, capability string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	normalizedAppID := strings.TrimSpace(appID)
	normalizedCapability := strings.TrimSpace(capability)
	if normalizedAppID == "" || normalizedCapability == "" {
		return ctx
	}
	return context.WithValue(ctx, protectedCapabilityContextKey{}, protectedCapabilityContextValue{
		appID:      normalizedAppID,
		capability: normalizedCapability,
	})
}

func HasValidatedProtectedCapability(ctx context.Context, appID string, capability string) bool {
	if ctx == nil {
		return false
	}
	value, ok := ctx.Value(protectedCapabilityContextKey{}).(protectedCapabilityContextValue)
	if !ok {
		return false
	}
	return value.appID == strings.TrimSpace(appID) && value.capability == strings.TrimSpace(capability)
}
