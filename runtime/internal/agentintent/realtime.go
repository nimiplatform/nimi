// Package agentintent carries the fixed Runtime-private self-intention seam.
// It exposes no App ingress, business tool registry or state owner.
package agentintent

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

const FunctionName = "nimi_self_intention"

type Handler func(context.Context, string) (string, error)
type contextKey struct{}
type usageContextKey struct{}
type UsageObserver func(string, *runtimev1.UsageStats)

func WithUsageObserver(ctx context.Context, observer UsageObserver) context.Context {
	return context.WithValue(ctx, usageContextKey{}, observer)
}
func UsageFromContext(ctx context.Context) UsageObserver {
	h, _ := ctx.Value(usageContextKey{}).(UsageObserver)
	return h
}

func WithHandler(ctx context.Context, handler Handler) context.Context {
	return context.WithValue(ctx, contextKey{}, handler)
}
func FromContext(ctx context.Context) Handler { h, _ := ctx.Value(contextKey{}).(Handler); return h }

func NativeTools(enabled bool) []any {
	if !enabled {
		return []any{}
	}
	return []any{map[string]any{
		"type": "function", "name": FunctionName,
		"description": `Optionally propose one persistent intention for your own life, never a user task, reminder, schedule, tool, recipient or configuration change. Change/abandon requires an experience with your own action, object and result; adopt omits it. Use exact existing activity_ref values. Wait for the actual result before confirming a change, and do not propose another change in the result reply.`,
		"parameters": map[string]any{"type": "object", "properties": map[string]any{
			"action":       map[string]any{"type": "string", "enum": []string{"adopt", "change", "pause", "resume", "abandon"}},
			"experience":   map[string]any{"type": "object", "properties": map[string]any{"action": map[string]any{"type": "string", "enum": []string{"create", "practice", "explore", "reflect"}}, "object": map[string]any{"type": "string", "maxLength": 80}, "result": map[string]any{"type": "string", "enum": []string{"direction_changed", "abandoned"}}, "outcome": map[string]any{"type": "string", "maxLength": 160}}, "required": []string{"action", "object", "result"}, "additionalProperties": false},
			"activity_ref": map[string]any{"type": "string", "description": "Exact existing activity_ref for change/pause/resume/abandon; omit for adopt."}, "title": map[string]any{"type": "string", "description": "Own direction name, required for adopt/change; omit otherwise."}, "kind": map[string]any{"type": "string", "description": "Required only for adopt; omit for existing intentions.", "enum": []string{"project", "routine"}},
		}, "required": []string{"action"}, "additionalProperties": false},
	}}
}
