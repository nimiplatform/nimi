package ai

import (
	"context"
	"strings"
	"sync"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/nimillm"
)

type localProvider struct {
	mu      sync.RWMutex
	localai *nimillm.Backend
	nexa    *nimillm.Backend
}

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
	}
}

func (p *localProvider) backends() (*nimillm.Backend, *nimillm.Backend) {
	if p == nil {
		return nil, nil
	}
	p.mu.RLock()
	defer p.mu.RUnlock()
	return p.localai, p.nexa
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
	return modelID
}

func (p *localProvider) CheckModelAvailability(modelID string) error {
	if err := nimillm.CheckModelAvailabilityWithScope(modelID, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL); err != nil {
		return err
	}
	_, _, explicit, ok, _ := p.pickBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	if !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
	}
	return nimillm.FallbackEmbed(inputs), nil, nil
}

// ResolveMediaBackend returns the underlying Backend for sync media operations.
func (p *localProvider) ResolveMediaBackend(modelID string) (*nimillm.Backend, string) {
	backend, resolvedModelID, _, _, _ := p.pickBackend(modelID)
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
	backend, resolvedModelID, explicit, ok, _ := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_MODEL_PROVIDER_MISMATCH)
	}
	if backend != nil {
		return backend.StreamGenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens(), onDelta)
	}
	return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_LOCAL_MODEL_UNAVAILABLE)
}

func (p *localProvider) pickBackend(modelID string) (*nimillm.Backend, string, bool, bool, bool) {
	localAIBackend, nexaBackend := p.backends()
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
		case "local":
			if localAIBackend != nil {
				return localAIBackend, rest, true, true, false
			}
			if nexaBackend != nil {
				return nexaBackend, rest, true, true, true
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
	return nil, id, false, false, false
}
