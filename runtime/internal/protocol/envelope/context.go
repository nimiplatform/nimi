package envelope

import "context"

type metadataContextKey struct{}

func WithMetadata(ctx context.Context, meta Metadata) context.Context {
	return context.WithValue(ctx, metadataContextKey{}, meta)
}

func MetadataFromContext(ctx context.Context) (Metadata, bool) {
	meta, ok := ctx.Value(metadataContextKey{}).(Metadata)
	return meta, ok
}
