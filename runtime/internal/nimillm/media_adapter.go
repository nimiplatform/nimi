package nimillm

import (
	"context"

	"google.golang.org/protobuf/types/known/timestamppb"
)

// MediaAdapterConfig holds the credentials for a specific provider adapter.
type MediaAdapterConfig struct {
	BaseURL               string
	APIKey                string
	Headers               map[string]string
	AllowLoopbackEndpoint bool
}

type mediaAdapterEndpointPolicyContextKey struct{}

// WithMediaAdapterEndpointPolicy applies adapter-owned endpoint policy to
// shared HTTP helpers that are called outside a concrete adapter entry point.
func WithMediaAdapterEndpointPolicy(ctx context.Context, cfg MediaAdapterConfig) context.Context {
	return mediaAdapterEndpointPolicyContext(ctx, cfg)
}

func mediaAdapterEndpointPolicyContext(ctx context.Context, cfg MediaAdapterConfig) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	if !cfg.AllowLoopbackEndpoint {
		return ctx
	}
	return context.WithValue(ctx, mediaAdapterEndpointPolicyContextKey{}, true)
}

func allowLoopbackProviderEndpointFromContext(ctx context.Context) bool {
	if ctx == nil {
		return false
	}
	allow, _ := ctx.Value(mediaAdapterEndpointPolicyContextKey{}).(bool)
	return allow
}

// JobStateUpdater allows adapters to update async job polling state
// without depending on the services/ai package.
type JobStateUpdater interface {
	UpdatePollState(jobID string, providerJobID string, retryCount int32, nextPollAt *timestamppb.Timestamp, lastError string)
}
