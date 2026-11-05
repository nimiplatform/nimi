package nimillm

import (
	"context"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

type modelUsageObserverKey struct{}

func WithModelUsageObserver(ctx context.Context, observer func([]*runtimev1.DesktopAIModelUsage)) context.Context {
	return context.WithValue(ctx, modelUsageObserverKey{}, observer)
}

func reportModelUsage(ctx context.Context, values []*runtimev1.DesktopAIModelUsage) {
	if observer, ok := ctx.Value(modelUsageObserverKey{}).(func([]*runtimev1.DesktopAIModelUsage)); ok && observer != nil {
		observer(values)
	}
}
