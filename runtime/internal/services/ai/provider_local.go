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
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type localProvider struct {
	mu        sync.RWMutex
	localai   *nimillm.Backend
	nexa      *nimillm.Backend
	nimimedia *nimillm.Backend
	sidecar   *nimillm.Backend
}

var localProviderGOOS = runtime.GOOS

func (p *localProvider) setBackend(providerID string, backend *nimillm.Backend) {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	switch strings.ToLower(strings.TrimSpace(providerID)) {
	case "localai":
		p.localai = backend
	case "nexa":
		p.nexa = backend
	case "nimi_media":
		p.nimimedia = backend
	case "sidecar":
		p.sidecar = backend
	}
}

func (p *localProvider) backends() (*nimillm.Backend, *nimillm.Backend, *nimillm.Backend, *nimillm.Backend) {
	if p == nil {
		return nil, nil, nil, nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.localai, p.nexa, p.nimimedia, p.sidecar
}

func (p *localProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL
}

func (p *localProvider) ResolveModelID(raw string) string {
	modelID := strings.TrimSpace(raw)
	if strings.HasPrefix(modelID, "local/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "local/"))
	}
	if strings.HasPrefix(modelID, "localai/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "localai/"))
	}
	if strings.HasPrefix(modelID, "nexa/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "nexa/"))
	}
	if strings.HasPrefix(modelID, "nimi_media/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "nimi_media/"))
	}
	if strings.HasPrefix(modelID, "sidecar/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "sidecar/"))
	}
	if strings.HasPrefix(modelID, "localsidecar/") {
		modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "localsidecar/"))
	}
	return modelID
}

func (p *localProvider) CheckModelAvailability(modelID string) error {
	_, _, explicit, ok, _ := p.pickAvailabilityBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickTextBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickTextBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickTextBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		return backend.StreamGenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens(), onDelta)
	}
	return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (p *localProvider) pickAvailabilityBackend(modelID string) (*nimillm.Backend, string, bool, bool, bool) {
	localAIBackend, nexaBackend, nimiMediaBackend, sidecarBackend := p.backends()
	id := strings.TrimSpace(modelID)
	if id == "" {
		return nil, "", false, false, false
	}

	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			return nil, "", true, false, prefix == "nexa"
		}
		switch prefix {
		case "localai":
			return localAIBackend, rest, true, localAIBackend != nil, false
		case "nexa":
			return nexaBackend, rest, true, nexaBackend != nil, true
		case "nimi_media":
			return nimiMediaBackend, rest, true, nimiMediaBackend != nil, false
		case "sidecar", "localsidecar":
			return sidecarBackend, rest, true, sidecarBackend != nil, false
		case "local":
			if localAIBackend != nil {
				return localAIBackend, rest, true, true, false
			}
			if nexaBackend != nil {
				return nexaBackend, rest, true, true, true
			}
			if nimiMediaBackend != nil {
				return nimiMediaBackend, rest, true, true, false
			}
			if sidecarBackend != nil {
				return sidecarBackend, rest, true, true, false
			}
			return nil, rest, true, false, false
		}
	}

	if localAIBackend != nil {
		return localAIBackend, id, false, true, false
	}
	if nexaBackend != nil {
		return nexaBackend, id, false, true, true
	}
	if nimiMediaBackend != nil {
		return nimiMediaBackend, id, false, true, false
	}
	if sidecarBackend != nil {
		return sidecarBackend, id, false, true, false
	}
	return nil, id, false, false, false
}

func (p *localProvider) pickTextBackend(modelID string) (*nimillm.Backend, string, bool, bool, bool) {
	localAIBackend, nexaBackend, _, sidecarBackend := p.backends()
	id := strings.TrimSpace(modelID)
	if id == "" {
		return nil, "", false, false, false
	}

	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			return nil, "", true, false, prefix == "nexa"
		}
		switch prefix {
		case "localai":
			return localAIBackend, rest, true, localAIBackend != nil, false
		case "nexa":
			return nexaBackend, rest, true, nexaBackend != nil, true
		case "nimi_media":
			return nil, rest, true, false, false
		case "sidecar", "localsidecar":
			return sidecarBackend, rest, true, sidecarBackend != nil, false
		case "local":
			if localAIBackend != nil {
				return localAIBackend, rest, true, true, false
			}
			if nexaBackend != nil {
				return nexaBackend, rest, true, true, true
			}
			if sidecarBackend != nil {
				return sidecarBackend, rest, true, true, false
			}
			return nil, rest, true, false, false
		}
	}

	if localAIBackend != nil {
		return localAIBackend, id, false, true, false
	}
	if nexaBackend != nil {
		return nexaBackend, id, false, true, true
	}
	if sidecarBackend != nil {
		return sidecarBackend, id, false, true, false
	}
	return nil, id, false, false, false
}

func (p *localProvider) resolveMediaBackendForModal(modelID string, modal runtimev1.Modal) (*nimillm.Backend, string, string) {
	localAIBackend, nexaBackend, nimiMediaBackend, sidecarBackend := p.backends()
	id := strings.TrimSpace(modelID)
	if id == "" {
		return nil, "", ""
	}
	if backend, resolved, providerType, ok := p.resolveExplicitMediaBackend(id, modal, localAIBackend, nexaBackend, nimiMediaBackend, sidecarBackend); ok {
		return backend, resolved, providerType
	}

	if localProviderGOOS == "windows" {
		switch modal {
		case runtimev1.Modal_MODAL_IMAGE, runtimev1.Modal_MODAL_VIDEO:
			if nimiMediaBackend != nil {
				return nimiMediaBackend, id, "nimi_media"
			}
		case runtimev1.Modal_MODAL_TTS, runtimev1.Modal_MODAL_STT:
			if nexaBackend != nil {
				return nexaBackend, id, "nexa"
			}
		}
	}

	switch modal {
	case runtimev1.Modal_MODAL_MUSIC:
		if sidecarBackend != nil {
			return sidecarBackend, id, "sidecar"
		}
		if localAIBackend != nil {
			return localAIBackend, id, "localai"
		}
	case runtimev1.Modal_MODAL_TTS, runtimev1.Modal_MODAL_STT:
		if localAIBackend != nil {
			return localAIBackend, id, "localai"
		}
		if nexaBackend != nil {
			return nexaBackend, id, "nexa"
		}
	case runtimev1.Modal_MODAL_IMAGE, runtimev1.Modal_MODAL_VIDEO:
		if localAIBackend != nil {
			return localAIBackend, id, "localai"
		}
		if nimiMediaBackend != nil {
			return nimiMediaBackend, id, "nimi_media"
		}
		if nexaBackend != nil {
			return nexaBackend, id, "nexa"
		}
	default:
		if localAIBackend != nil {
			return localAIBackend, id, "localai"
		}
		if nexaBackend != nil {
			return nexaBackend, id, "nexa"
		}
		if nimiMediaBackend != nil {
			return nimiMediaBackend, id, "nimi_media"
		}
		if sidecarBackend != nil {
			return sidecarBackend, id, "sidecar"
		}
	}
	return nil, id, ""
}

func (p *localProvider) resolveExplicitMediaBackend(
	modelID string,
	modal runtimev1.Modal,
	localAIBackend *nimillm.Backend,
	nexaBackend *nimillm.Backend,
	nimiMediaBackend *nimillm.Backend,
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
	switch prefix {
	case "localai":
		return localAIBackend, rest, "localai", true
	case "nexa":
		return nexaBackend, rest, "nexa", true
	case "nimi_media":
		return nimiMediaBackend, rest, "nimi_media", true
	case "sidecar", "localsidecar":
		return sidecarBackend, rest, "sidecar", true
	case "local":
		if localProviderGOOS == "windows" {
			switch modal {
			case runtimev1.Modal_MODAL_IMAGE, runtimev1.Modal_MODAL_VIDEO:
				if nimiMediaBackend != nil {
					return nimiMediaBackend, rest, "nimi_media", true
				}
			case runtimev1.Modal_MODAL_TTS, runtimev1.Modal_MODAL_STT:
				if nexaBackend != nil {
					return nexaBackend, rest, "nexa", true
				}
			}
		}
		if localAIBackend != nil {
			return localAIBackend, rest, "localai", true
		}
		if nexaBackend != nil {
			return nexaBackend, rest, "nexa", true
		}
		if nimiMediaBackend != nil {
			return nimiMediaBackend, rest, "nimi_media", true
		}
		if sidecarBackend != nil {
			return sidecarBackend, rest, "sidecar", true
		}
		return nil, rest, "", true
	default:
		return nil, "", "", false
	}
}
