package nimillm

import (
	"context"
	"strings"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// CloudProvider executes only an exact caller-owned connector target. The
// backend map remains probe/configuration substrate; it is never ranked or
// selected from model text.
type CloudProvider struct {
	backends    map[string]*Backend
	httpTimeout time.Duration

	allowLoopbackEndpoint bool
}

// NewCloudProvider creates a CloudProvider from the given config.
func NewCloudProvider(cfg CloudConfig) *CloudProvider {
	backends := make(map[string]*Backend, len(cfg.Providers))
	for providerID, creds := range cfg.Providers {
		canonical := ResolveProviderAlias(providerID)
		if canonical == "" {
			continue
		}
		backendName := "cloud-" + canonical
		b := NewSecuredBackendWithHeaders(backendName, creds.BaseURL, creds.APIKey, creds.Headers, cfg.HTTPTimeout, cfg.AllowLoopbackEndpoint)
		if b != nil {
			backends[canonical] = b
		}
	}
	return &CloudProvider{
		backends:              backends,
		httpTimeout:           cfg.HTTPTimeout,
		allowLoopbackEndpoint: cfg.AllowLoopbackEndpoint,
	}
}

// Route returns the route policy for cloud.
func (p *CloudProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_CLOUD
}

// GenerateTextScenarioWithTarget executes one exact connector target.
func (p *CloudProvider) GenerateTextScenarioWithTarget(
	ctx context.Context,
	modelID string,
	spec *runtimev1.TextGenerateScenarioSpec,
	_ string,
	target *RemoteTarget,
) (string, []*runtimev1.ToolCall, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return "", nil, nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if target == nil {
		return "", nil, nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return "", nil, nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	text, toolCalls, usage, finish, err := backend.GenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens(), BuildTextGenParams(spec))
	if err != nil {
		return "", nil, nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	return text, toolCalls, usage, finish, nil
}

// EmbedWithTarget executes one exact connector target.
func (p *CloudProvider) EmbedWithTarget(ctx context.Context, modelID string, inputs []string, target *RemoteTarget) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	if target == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return nil, nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return backend.Embed(ctx, resolvedModelID, inputs)
}

// StreamGenerateTextScenarioWithTarget executes one exact connector target.
func (p *CloudProvider) StreamGenerateTextScenarioWithTarget(
	ctx context.Context,
	modelID string,
	spec *runtimev1.TextGenerateScenarioSpec,
	onDelta func(string) error,
	target *RemoteTarget,
) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if spec == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}
	if target == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return backend.StreamGenerateText(ctx, resolvedModelID, spec.GetInput(), spec.GetSystemPrompt(), spec.GetTemperature(), spec.GetTopP(), spec.GetMaxTokens(), BuildTextGenParams(spec), onDelta)
}

// ResolveMediaBackendWithTarget resolves one exact connector target.
func (p *CloudProvider) ResolveMediaBackendWithTarget(modelID string, target *RemoteTarget) (*Backend, string) {
	return p.resolveBackendForTarget(modelID, target)
}

// resolveBackendForTarget composes one exact provider/model target. It never
// parses model prefixes, consults registry hints, or chooses a configured
// backend by order.
func (p *CloudProvider) resolveBackendForTarget(modelID string, target *RemoteTarget) (*Backend, string) {
	if target == nil {
		return nil, ""
	}
	canonical := ResolveProviderAlias(target.ProviderType)
	if canonical == "" || canonical != target.ProviderType {
		return nil, ""
	}
	resolvedModelID, ok := resolveRemoteTargetModelID(modelID, target.ProviderModelID)
	if !ok {
		return nil, resolvedModelID
	}
	return p.backendFromTarget(target), resolvedModelID
}

func resolveRemoteTargetModelID(modelID string, boundProviderModelID string) (string, bool) {
	bound := strings.TrimSpace(boundProviderModelID)
	requested := strings.TrimSpace(modelID)
	if bound == "" || bound != boundProviderModelID || requested == "" || requested != modelID || requested != bound {
		return bound, false
	}
	return bound, true
}

// backendFromTarget creates an execution backend only from the exact target.
// Configured backends are probe substrate and can never contribute an endpoint,
// credential, or header to execution.
func (p *CloudProvider) backendFromTarget(target *RemoteTarget) *Backend {
	if target == nil || target.Endpoint == "" || target.Endpoint != strings.TrimSpace(target.Endpoint) {
		return nil
	}
	allowLoopback := p.allowLoopbackEndpoint || target.AllowLoopback
	return NewSecuredBackendWithHeaders(
		"cloud-"+target.ProviderType,
		target.Endpoint,
		target.APIKey,
		target.Headers,
		p.probeTimeout(),
		allowLoopback,
	)
}
