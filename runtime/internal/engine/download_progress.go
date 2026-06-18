package engine

import "context"

type downloadProgressContextKey struct{}

// WithDownloadProgress attaches a byte-progress sink to Runtime-managed engine
// dependency materializers. Callers that cannot observe a subprocess download
// should not use this hook; heartbeat remains the honest projection there.
func WithDownloadProgress(ctx context.Context, progress func(bytesReceived, bytesTotal int64)) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if progress == nil {
		return ctx
	}
	return context.WithValue(ctx, downloadProgressContextKey{}, progress)
}

func downloadProgressFromContext(ctx context.Context) func(bytesReceived, bytesTotal int64) {
	if ctx == nil {
		return nil
	}
	progress, _ := ctx.Value(downloadProgressContextKey{}).(func(bytesReceived, bytesTotal int64))
	return progress
}

func ReportDownloadProgress(ctx context.Context, bytesReceived, bytesTotal int64) bool {
	progress := downloadProgressFromContext(ctx)
	if progress == nil {
		return false
	}
	progress(bytesReceived, bytesTotal)
	return true
}
