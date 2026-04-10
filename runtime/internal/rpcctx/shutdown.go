package rpcctx

import (
	"context"
	"errors"
	"sync/atomic"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

type shutdownSignalKey struct{}

type ShutdownSignal struct {
	serverShutdown atomic.Bool
}

func WithShutdownSignal(parent context.Context) (context.Context, *ShutdownSignal) {
	signal := &ShutdownSignal{}
	return context.WithValue(parent, shutdownSignalKey{}, signal), signal
}

func (s *ShutdownSignal) MarkServerShutdown() {
	if s == nil {
		return
	}
	s.serverShutdown.Store(true)
}

func WasServerShutdown(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	signal, _ := ctx.Value(shutdownSignalKey{}).(*ShutdownSignal)
	return signal != nil && signal.serverShutdown.Load()
}

func ServerShutdownError() error {
	return status.Error(codes.Canceled, "runtime shutting down")
}

func ContextDoneError(ctx context.Context) error {
	if ctx == nil {
		return nil
	}
	if WasServerShutdown(ctx) {
		return ServerShutdownError()
	}
	if errors.Is(ctx.Err(), context.Canceled) {
		return nil
	}
	return ctx.Err()
}
