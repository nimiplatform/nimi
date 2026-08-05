package nimillm

import (
	"context"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// Provider identifies only the already-committed execution plane. Model,
// backend, route fallback, and availability selection are not provider API.
type Provider interface {
	Route() runtimev1.RoutePolicy
}

// SpeechStreamChunk is one provider-native TTS stream frame for audio.synthesize.
// Implementations must emit playable non-final audio before full synthesis
// completion to qualify as native realtime speech output.
type SpeechStreamChunk struct {
	Sequence      uint64
	MIMEType      string
	SampleRateHz  int32
	TraceID       string
	Bytes         []byte
	Finish        bool
	Usage         *runtimev1.UsageStats
	FailureReason runtimev1.ReasonCode
	FailureText   string
}

// StreamingSpeechProvider extends a provider/backend with native streaming TTS.
// This is still audio.synthesize execution truth, not a new capability token.
type StreamingSpeechProvider interface {
	StreamSynthesizeSpeech(
		ctx context.Context,
		modelID string,
		spec *runtimev1.SpeechSynthesizeScenarioSpec,
		scenarioExtensions map[string]any,
		onChunk func(SpeechStreamChunk) error,
	) (*runtimev1.UsageStats, runtimev1.FinishReason, error)
}

// RemoteTarget provides resolved credentials for a managed or inline remote call.
type RemoteTarget struct {
	ProviderType string // canonical provider ID
	Endpoint     string // resolved endpoint URL
	APIKey       string // decrypted API key
	Headers      map[string]string

	ConnectorID          string // Runtime-owned connector identity for catalog-bound execution
	RemoteModelCatalogID string // Runtime-owned remote catalog snapshot identity
	ProviderModelID      string // executable provider model ID resolved from catalog binding
	EndpointProfileID    string // endpoint profile identity resolved with the catalog binding
	ConnectorSnapshotID  string // connector snapshot identity resolved with the catalog binding
	InventorySnapshotID  string // inventory snapshot identity resolved with the catalog binding

	AllowLoopback bool // endpoint security policy for this target
}

// RouteDecisionInfo captures the routing decision for a model request.
type RouteDecisionInfo struct {
	BackendName string
}
