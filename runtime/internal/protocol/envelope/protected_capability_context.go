package envelope

import (
	"context"
	"strings"
)

type protectedCapabilityContextKey struct{}

const (
	ProtectedDesktopAppID               = "nimi.desktop"
	ProtectedDesktopAuditReadCapability = "runtime.audit.desktop.read"
)

type validatedProtectedCapability struct {
	appID      string
	capability string
}

type protectedCapabilityContextValue struct {
	values []validatedProtectedCapability
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
	values := make([]validatedProtectedCapability, 0, 1)
	if existing, ok := ctx.Value(protectedCapabilityContextKey{}).(protectedCapabilityContextValue); ok {
		values = append(values, existing.values...)
	}
	for _, value := range values {
		if value.appID == normalizedAppID && value.capability == normalizedCapability {
			return ctx
		}
	}
	values = append(values, validatedProtectedCapability{appID: normalizedAppID, capability: normalizedCapability})
	return context.WithValue(ctx, protectedCapabilityContextKey{}, protectedCapabilityContextValue{values: values})
}

func HasValidatedProtectedCapability(ctx context.Context, appID string, capability string) bool {
	if ctx == nil {
		return false
	}
	value, ok := ctx.Value(protectedCapabilityContextKey{}).(protectedCapabilityContextValue)
	if !ok {
		return false
	}
	normalizedAppID := strings.TrimSpace(appID)
	normalizedCapability := strings.TrimSpace(capability)
	for _, candidate := range value.values {
		if candidate.appID == normalizedAppID && candidate.capability == normalizedCapability {
			return true
		}
	}
	return false
}
