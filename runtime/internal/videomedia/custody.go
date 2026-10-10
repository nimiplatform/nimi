package videomedia

import (
	"context"
	"io"
)

// FileCustody is supplied by the Runtime Job owner for bounded private media work.
// The codec can only fill or borrow those named slots, not mint a workspace.
type FileCustody interface {
	Write(context.Context, string, string, func(io.Writer) error) error
	Borrow(context.Context, string) (string, func(), error)
}
type fileCustodyKey struct{}

func WithFileCustody(ctx context.Context, files FileCustody) context.Context {
	return context.WithValue(ctx, fileCustodyKey{}, files)
}
