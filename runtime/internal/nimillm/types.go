package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// Provider is the exported interface for AI provider routing.
// Both CloudProvider and localProvider satisfy this interface.
// Sync media methods (GenerateImage, GenerateVideo, SynthesizeSpeech, Transcribe)
// are handled via Backend directly through the MediaBackendProvider interface.
type Provider interface {
	Route() runtimev1.RoutePolicy
	ResolveModelID(raw string) string
	CheckModelAvailability(modelID string) error
	GenerateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error)
	Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error)
}

// StreamingTextProvider extends Provider with streaming text generation.
type StreamingTextProvider interface {
	StreamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error)
}

// MediaBackendProvider exposes the underlying Backend for sync media operations.
// This replaces the sync media methods that were previously on the Provider interface.
type MediaBackendProvider interface {
	ResolveMediaBackend(modelID string) (*Backend, string)
}

// DecisionInfoProvider exposes routing decision metadata.
type DecisionInfoProvider interface {
	GetDecisionInfo(modelID string) (RouteDecisionInfo, bool)
}

// RemoteTarget provides resolved credentials for a managed or inline remote call.
type RemoteTarget struct {
	ProviderType string // canonical provider ID
	Endpoint     string // resolved endpoint URL
	APIKey       string // decrypted API key
}

// RouteDecisionInfo captures the routing decision for a model request.
type RouteDecisionInfo struct {
	BackendName    string
	HintAutoSwitch bool
	HintFrom       string
	HintTo         string
}
