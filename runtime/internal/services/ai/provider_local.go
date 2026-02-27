package ai

import (
	"context"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

type localProvider struct {
	localai *nimillm.Backend
	nexa    *nimillm.Backend
}

func (p *localProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
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
	if modelID == "" {
		return "local-model"
	}
	return modelID
}

func (p *localProvider) CheckModelAvailability(modelID string) error {
	if err := nimillm.CheckModelAvailabilityWithScope(modelID, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME); err != nil {
		return err
	}
	_, _, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return nil
}

func (p *localProvider) GenerateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		text, usage, finish, err := backend.GenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens())
		if err != nil {
			return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		return text, usage, finish, nil
	}
	return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	return nimillm.FallbackEmbed(inputs), nil, nil
}

func (p *localProvider) GenerateImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		return backend.GenerateImage(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) GenerateVideo(ctx context.Context, modelID string, spec *runtimev1.VideoGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok, usingNexa := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if usingNexa {
		return nil, nil, status.Error(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED.String())
	}
	if backend != nil {
		return backend.GenerateVideo(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) SynthesizeSpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesisSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		return backend.SynthesizeSpeech(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) Transcribe(ctx context.Context, modelID string, spec *runtimev1.SpeechTranscriptionSpec, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return "", nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		return backend.Transcribe(ctx, resolvedModelID, spec, audio, mimeType)
	}
	return "", nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) StreamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		return backend.StreamGenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens(), onDelta)
	}
	return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

func (p *localProvider) pickBackend(modelID string) (*nimillm.Backend, string, bool, bool, bool) {
	id := strings.TrimSpace(modelID)
	if id == "" {
		if p.localai != nil {
			return p.localai, "local-model", false, true, false
		}
		if p.nexa != nil {
			return p.nexa, "local-model", false, true, true
		}
		return nil, "local-model", false, false, false
	}

	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			rest = "local-model"
		}
		switch prefix {
		case "localai":
			return p.localai, rest, true, p.localai != nil, false
		case "nexa":
			return p.nexa, rest, true, p.nexa != nil, true
		case "local":
			if p.localai != nil {
				return p.localai, rest, true, true, false
			}
			if p.nexa != nil {
				return p.nexa, rest, true, true, true
			}
			return nil, rest, true, false, false
		}
	}

	if p.localai != nil {
		return p.localai, id, false, true, false
	}
	if p.nexa != nil {
		return p.nexa, id, false, true, true
	}
	return nil, id, false, false, false
}
