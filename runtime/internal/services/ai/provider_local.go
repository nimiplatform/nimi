package ai

import (
	"context"
	"runtime"
	"strings"
	"sync"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/localrouting"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type localProvider struct {
	mu             sync.RWMutex
	llama          *nimillm.Backend
	media          *nimillm.Backend
	speech         *nimillm.Backend
	mediaDiffusers *nimillm.Backend
	sidecar        *nimillm.Backend
}

var localProviderGOOS = runtime.GOOS

func (p *localProvider) setBackend(providerID string, backend *nimillm.Backend) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	switch strings.ToLower(strings.TrimSpace(providerID)) {
	case "llama":
		p.llama = backend
	case "media":
		p.media = backend
	case "speech":
		p.speech = backend
	case "sidecar":
		p.sidecar = backend
	}
}

func (p *localProvider) backends() (*nimillm.Backend, *nimillm.Backend, *nimillm.Backend, *nimillm.Backend, *nimillm.Backend) {
	if p == nil {
		return nil, nil, nil, nil, nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.llama, p.media, p.speech, p.mediaDiffusers, p.sidecar
}

func (p *localProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}

func (p *localProvider) ResolveModelID(raw string) string {
	modelID := strings.TrimSpace(raw)
	if strings.HasPrefix(modelID, "local/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "local/"))
	}
	return modelID
}

func (p *localProvider) CheckModelAvailability(modelID string) error {
	_, _, explicit, ok := p.pickAvailabilityBackend(modelID)
	if explicit && !ok {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if !ok {
		return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return nil
}

func (p *localProvider) GenerateText(ctx context.Context, modelID string, spec *runtimev1.TextGenerateScenarioSpec, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return p.GenerateTextScenario(ctx, modelID, spec, inputText)
}

func (p *localProvider) GenerateTextScenario(
	ctx context.Context,
	modelID string,
	spec *runtimev1.TextGenerateScenarioSpec,
	_ string,
) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	backend, resolvedModelID, explicit, ok := p.pickTextBackend(modelID)
	if explicit && !ok {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		text, usage, finish, err := backend.GenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens())
		if err != nil {
			return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		return text, usage, finish, nil
	}
	return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (p *localProvider) Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickEmbeddingBackend(modelID)
	if explicit && !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	if !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return nil, nil, grpcerr.WithReasonCode(codes.Unimplemented, runtimev1.ReasonCode_AI_MODALITY_NOT_SUPPORTED)
}

// ResolveMediaBackend returns the underlying Backend for sync media operations.
func (p *localProvider) ResolveMediaBackend(modelID string) (*nimillm.Backend, string) {
	backend, resolvedModelID, _ := p.resolveMediaBackendForModal(modelID, runtimev1.Modal_MODAL_UNSPECIFIED)
	return backend, resolvedModelID
}

func (p *localProvider) StreamGenerateText(ctx context.Context, modelID string, spec *runtimev1.TextGenerateScenarioSpec, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	return p.StreamGenerateTextScenario(ctx, modelID, spec, onDelta)
}

func (p *localProvider) StreamGenerateTextScenario(
	ctx context.Context,
	modelID string,
	spec *runtimev1.TextGenerateScenarioSpec,
	onDelta func(string) error,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	backend, resolvedModelID, explicit, ok := p.pickTextBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		return backend.StreamGenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens(), onDelta)
	}
	return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (p *localProvider) StreamGenerateTextScenarioRich(
	ctx context.Context,
	modelID string,
	spec *runtimev1.TextGenerateScenarioSpec,
	handler nimillm.TextStreamEventHandler,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	return p.StreamGenerateTextScenario(ctx, modelID, spec, handler.OnText)
}

func (p *localProvider) pickAvailabilityBackend(modelID string) (*nimillm.Backend, string, bool, bool) {
	return p.pickCapabilityBackend(modelID, "text.generate", true)
}

func (p *localProvider) pickTextBackend(modelID string) (*nimillm.Backend, string, bool, bool) {
	return p.pickCapabilityBackend(modelID, "text.generate", false)
}

func (p *localProvider) pickEmbeddingBackend(modelID string) (*nimillm.Backend, string, bool, bool) {
	return p.pickCapabilityBackend(modelID, "text.embed", false)
}

func (p *localProvider) pickCapabilityBackend(modelID string, capability string, allowExplicitAvailability bool) (*nimillm.Backend, string, bool, bool) {
	llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend := p.backends()
	id := strings.TrimSpace(modelID)
	if id == "" {
		return nil, "", false, false
	}

	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			return nil, "", true, false
		}
		switch prefix {
		case "llama":
			if allowExplicitAvailability {
				return llamaBackend, rest, true, llamaBackend != nil
			}
			return explicitCapabilityBackend("llama", capability, llamaBackend, rest)
		case "media":
			if allowExplicitAvailability {
				return mediaBackend, rest, true, mediaBackend != nil
			}
			return explicitCapabilityBackend("media", capability, mediaBackend, rest)
		case "speech":
			if allowExplicitAvailability {
				return speechBackend, rest, true, speechBackend != nil
			}
			return explicitCapabilityBackend("speech", capability, speechBackend, rest)
		case "sidecar":
			if allowExplicitAvailability {
				return sidecarBackend, rest, true, sidecarBackend != nil
			}
			return explicitCapabilityBackend("sidecar", capability, sidecarBackend, rest)
		case "local":
			for _, provider := range orderedLocalProviders(capability) {
				if backend := backendForLocalProvider(provider, llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend); backend != nil {
					return backend, rest, true, true
				}
			}
			return nil, rest, true, false
		}
	}

	for _, provider := range orderedLocalProviders(capability) {
		if backend := backendForLocalProvider(provider, llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend); backend != nil {
			return backend, id, false, true
		}
	}
	return nil, id, false, false
}

func orderedLocalProviders(capability string) []string {
	return append([]string(nil), localrouting.PreferenceOrder(localProviderGOOS, capability)...)
}

func backendForLocalProvider(
	provider string,
	llamaBackend *nimillm.Backend,
	mediaBackend *nimillm.Backend,
	speechBackend *nimillm.Backend,
	mediaDiffusersBackend *nimillm.Backend,
	sidecarBackend *nimillm.Backend,
) *nimillm.Backend {
	switch strings.ToLower(strings.TrimSpace(provider)) {
	case "llama":
		return llamaBackend
	case "media":
		return mediaBackend
	case "speech":
		return speechBackend
	case "sidecar":
		return sidecarBackend
	default:
		return nil
	}
}

func (p *localProvider) resolveMediaBackendForModal(modelID string, modal runtimev1.Modal) (*nimillm.Backend, string, string) {
	llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend := p.backends()
	id := strings.TrimSpace(modelID)
	if id == "" {
		return nil, "", ""
	}
	if backend, resolved, providerType, ok := p.resolveExplicitMediaBackend(id, modal, llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend); ok {
		return backend, resolved, providerType
	}

	for _, provider := range orderedLocalProviders(localRoutingCapabilityForModal(modal)) {
		if provider == "media" && mediaBackend == nil && mediaDiffusersBackend != nil {
			return mediaDiffusersBackend, id, "media"
		}
		if backend := backendForLocalProvider(provider, llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend); backend != nil {
			return backend, id, provider
		}
	}
	return nil, id, ""
}

func (p *localProvider) resolveExplicitMediaBackend(
	modelID string,
	modal runtimev1.Modal,
	llamaBackend *nimillm.Backend,
	mediaBackend *nimillm.Backend,
	speechBackend *nimillm.Backend,
	mediaDiffusersBackend *nimillm.Backend,
	sidecarBackend *nimillm.Backend,
) (*nimillm.Backend, string, string, bool) {
	segments := strings.SplitN(strings.TrimSpace(modelID), "/", 2)
	if len(segments) != 2 {
		return nil, "", "", false
	}
	prefix := strings.ToLower(strings.TrimSpace(segments[0]))
	rest := strings.TrimSpace(segments[1])
	if rest == "" {
		return nil, "", "", true
	}
	capability := localRoutingCapabilityForModal(modal)
	switch prefix {
	case "llama":
		backend, resolved, providerType := explicitMediaBackend("llama", capability, llamaBackend, rest)
		return backend, resolved, providerType, true
	case "media":
		backend, resolved, providerType := explicitMediaBackend("media", capability, mediaBackend, rest)
		if backend == nil && mediaDiffusersBackend != nil && localrouting.ProviderSupportsCapability("media", capability) {
			return mediaDiffusersBackend, rest, "media", true
		}
		return backend, resolved, providerType, true
	case "speech":
		backend, resolved, providerType := explicitMediaBackend("speech", capability, speechBackend, rest)
		return backend, resolved, providerType, true
	case "sidecar":
		backend, resolved, providerType := explicitMediaBackend("sidecar", capability, sidecarBackend, rest)
		return backend, resolved, providerType, true
	case "local":
		for _, provider := range orderedLocalProviders(capability) {
			if provider == "media" && mediaBackend == nil && mediaDiffusersBackend != nil {
				return mediaDiffusersBackend, rest, "media", true
			}
			if backend := backendForLocalProvider(provider, llamaBackend, mediaBackend, speechBackend, mediaDiffusersBackend, sidecarBackend); backend != nil {
				return backend, rest, provider, true
			}
		}
		return nil, rest, "", true
	default:
		return nil, "", "", false
	}
}

func explicitCapabilityBackend(provider string, capability string, backend *nimillm.Backend, modelID string) (*nimillm.Backend, string, bool, bool) {
	if !localrouting.ProviderSupportsCapability(provider, capability) {
		return nil, modelID, true, false
	}
	return backend, modelID, true, backend != nil
}

func explicitMediaBackend(provider string, capability string, backend *nimillm.Backend, modelID string) (*nimillm.Backend, string, string) {
	if !localrouting.ProviderSupportsCapability(provider, capability) {
		return nil, modelID, provider
	}
	return backend, modelID, provider
}
