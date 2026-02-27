package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
)

// Provider is the exported interface for AI provider routing.
// Both CloudProvider and localProvider satisfy this interface.
type Provider interface {
	Route() runtimev1.RoutePolicy
	ResolveModelID(raw string) string
	CheckModelAvailability(modelID string) error
	GenerateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error)
	Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error)
	GenerateImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerationSpec) ([]byte, *runtimev1.UsageStats, error)
	GenerateVideo(ctx context.Context, modelID string, spec *runtimev1.VideoGenerationSpec) ([]byte, *runtimev1.UsageStats, error)
	SynthesizeSpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesisSpec) ([]byte, *runtimev1.UsageStats, error)
	Transcribe(ctx context.Context, modelID string, spec *runtimev1.SpeechTranscriptionSpec, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error)
}

// StreamingTextProvider extends Provider with streaming text generation.
type StreamingTextProvider interface {
	StreamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error)
}

// DecisionInfoProvider exposes routing decision metadata.
type DecisionInfoProvider interface {
	GetDecisionInfo(modelID string) (RouteDecisionInfo, bool)
}

// RouteDecisionInfo captures the routing decision for a model request.
type RouteDecisionInfo struct {
	BackendName    string
	HintAutoSwitch bool
	HintFrom       string
	HintTo         string
}
