package nimillm

import "context"

type streamSimulationKey struct{}

// WithStreamSimulationFlag wires a request-scoped marker that backend fallbacks
// can set when stream output is simulated from a non-stream response.
func WithStreamSimulationFlag(ctx context.Context, flag *bool) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if flag == nil {
		return ctx
	}
	return context.WithValue(ctx, streamSimulationKey{}, flag)
}

// MarkStreamSimulated marks the current request as using simulated stream.
func MarkStreamSimulated(ctx context.Context) {
	if ctx == nil {
		return
	}
	flag, ok := ctx.Value(streamSimulationKey{}).(*bool)
	if !ok || flag == nil {
		return
	}
	*flag = true
}
