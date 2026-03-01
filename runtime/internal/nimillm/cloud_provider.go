package nimillm

import (
	"context"
	"strings"
	"sync"

	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/types/known/structpb"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
)

// knownProviders lists the canonical provider IDs in priority order for default routing.
var knownProviders = []string{"nimillm", "dashscope", "volcengine", "gemini", "deepseek", "openrouter", "minimax", "kimi", "glm"}

// prefixToProvider maps model-ID prefix segments to canonical provider IDs.
var prefixToProvider = map[string]string{
	"nimillm":    "nimillm",
	"aliyun":     "dashscope",
	"alibaba":    "dashscope",
	"dashscope":  "dashscope",
	"bytedance":  "volcengine",
	"byte":       "volcengine",
	"volcengine": "volcengine",
	"gemini":     "gemini",
	"minimax":    "minimax",
	"kimi":       "kimi",
	"moonshot":   "kimi",
	"glm":        "glm",
	"zhipu":      "glm",
	"bigmodel":   "glm",
	"deepseek":   "deepseek",
	"openrouter": "openrouter",
}

// hintToProvider maps modelregistry.ProviderHint to canonical provider IDs.
var hintToProvider = map[modelregistry.ProviderHint]string{
	modelregistry.ProviderHintNimiLLM:   "nimillm",
	modelregistry.ProviderHintAlibaba:   "dashscope",
	modelregistry.ProviderHintBytedance: "volcengine",
	modelregistry.ProviderHintGemini:    "gemini",
	modelregistry.ProviderHintMiniMax:   "minimax",
	modelregistry.ProviderHintKimi:      "kimi",
	modelregistry.ProviderHintGLM:       "glm",
}

// CloudProvider routes AI requests across multiple cloud backends.
type CloudProvider struct {
	backends  map[string]*Backend
	registry  *modelregistry.Registry
	health    *providerhealth.Tracker
	lastMu    sync.RWMutex
	lastRoute map[string]RouteDecisionInfo
}

// NewCloudProvider creates a CloudProvider from the given config.
func NewCloudProvider(cfg CloudConfig, registry *modelregistry.Registry, health *providerhealth.Tracker) *CloudProvider {
	backends := make(map[string]*Backend, len(cfg.Providers))
	for providerID, creds := range cfg.Providers {
		canonical := ResolveProviderAlias(providerID)
		backendName := "cloud-" + canonical
		b := NewBackend(backendName, creds.BaseURL, creds.APIKey, cfg.HTTPTimeout)
		if b != nil {
			backends[canonical] = b
		}
	}
	return &CloudProvider{
		backends: backends,
		registry: registry,
		health:   health,
	}
}

// BackendWithRequestCredentials returns a backend with overridden credentials from explicit endpoint+apiKey.
func (p *CloudProvider) BackendWithRequestCredentials(backend *Backend, endpoint string, apiKey string) *Backend {
	if backend == nil {
		return nil
	}
	endpoint = strings.TrimSpace(endpoint)
	apiKey = strings.TrimSpace(apiKey)
	if endpoint == "" && apiKey == "" {
		return backend
	}
	return backend.WithRequestOverrides(endpoint, apiKey)
}

// Route returns the route policy for cloud.
func (p *CloudProvider) Route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
}

// ResolveModelID resolves a raw model ID for cloud routing.
func (p *CloudProvider) ResolveModelID(raw string) string {
	modelID := strings.TrimSpace(strings.TrimPrefix(raw, "cloud/"))
	modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "token/"))
	if modelID == "" {
		return "cloud-default"
	}
	return modelID
}

// CheckModelAvailability checks if a model is available via cloud providers.
func (p *CloudProvider) CheckModelAvailability(modelID string) error {
	if err := CheckModelAvailabilityWithScope(modelID, runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API); err != nil {
		return err
	}
	_, _, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return nil
}

// GenerateText routes a text generation request to the appropriate backend.
func (p *CloudProvider) GenerateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	return p.GenerateTextWithTarget(ctx, modelID, req, inputText, nil)
}

// GenerateTextWithTarget routes a text generation request, optionally using a RemoteTarget override.
func (p *CloudProvider) GenerateTextWithTarget(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string, target *RemoteTarget) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	p.rememberDecision(modelID, backend.Name)
	text, usage, finish, err := backend.GenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens())
	if err != nil {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
	}
	return text, usage, finish, nil
}

// Embed routes an embedding request to the appropriate backend.
func (p *CloudProvider) Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	return FallbackEmbed(inputs), nil, nil
}

// EmbedWithTarget routes an embedding request, optionally using a RemoteTarget override.
func (p *CloudProvider) EmbedWithTarget(ctx context.Context, modelID string, inputs []string, target *RemoteTarget) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	if target != nil {
		backend := p.backendFromTarget(target)
		if backend == nil {
			return nil, nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
		}
		resolvedModelID := p.ResolveModelID(modelID)
		p.rememberDecision(modelID, backend.Name)
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	// Original Embed logic preserving explicit/default distinction
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	return FallbackEmbed(inputs), nil, nil
}

// StreamGenerateText routes a streaming text generation request.
func (p *CloudProvider) StreamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	return p.StreamGenerateTextWithTarget(ctx, modelID, req, onDelta, nil)
}

// StreamGenerateTextWithTarget routes a streaming request, optionally using a RemoteTarget override.
func (p *CloudProvider) StreamGenerateTextWithTarget(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error, target *RemoteTarget) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	p.rememberDecision(modelID, backend.Name)
	return backend.StreamGenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens(), onDelta)
}

// ResolveMediaBackend returns the underlying Backend for sync media operations.
func (p *CloudProvider) ResolveMediaBackend(modelID string) (*Backend, string) {
	backend, resolvedModelID, _, _ := p.PickBackend(modelID)
	return backend, resolvedModelID
}

// ResolveMediaBackendWithTarget returns a backend for sync media operations,
// optionally using a RemoteTarget override for managed connector credentials.
func (p *CloudProvider) ResolveMediaBackendWithTarget(modelID string, target *RemoteTarget) (*Backend, string) {
	return p.resolveBackendForTarget(modelID, target)
}

// PickBackend selects the appropriate backend for a model ID.
// Returns (backend, resolvedModelID, isExplicit, isAvailable).
//
// Routing logic (simplified per NIMI-032 — no cross-provider fallback):
//  1. Model prefix routing: "dashscope/model-name" → lookup "dashscope"
//  2. Registry hint: model registered with ProviderHint → lookup that provider
//  3. Default: return first configured backend (nimillm preferred)
//  4. Provider unavailable → return UNAVAILABLE (no cross-provider fallback)
func (p *CloudProvider) PickBackend(modelID string) (*Backend, string, bool, bool) {
	id := strings.TrimSpace(modelID)
	if id == "" {
		if b := p.backends["nimillm"]; b != nil {
			return b, "cloud-default", false, true
		}
		return nil, "cloud-default", false, false
	}

	// 1. Model prefix routing.
	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			rest = "default"
		}
		if providerID, ok := prefixToProvider[prefix]; ok {
			b := p.backends[providerID]
			if b == nil || !p.isBackendHealthy(b.Name) {
				return nil, rest, true, false
			}
			return b, rest, true, true
		}
	}

	// 2. Registry hint routing.
	if p.registry != nil {
		if item, exists := p.registry.Get(id); exists {
			if providerID, ok := hintToProvider[item.ProviderHint]; ok {
				if b := p.backends[providerID]; b != nil && p.isBackendHealthy(b.Name) {
					hintFrom := string(item.ProviderHint)
					p.rememberHintDecision(id, hintFrom, providerID, false)
					return b, id, false, true
				}
			}
			// Hint provider unavailable — return UNAVAILABLE (NIMI-032: no cross-provider fallback).
			if item.ProviderHint != modelregistry.ProviderHintLocal && item.ProviderHint != modelregistry.ProviderHintUnknown {
				return nil, id, false, false
			}
		}
	}

	// 3. Default: first configured and healthy backend.
	for _, providerID := range knownProviders {
		if b := p.backends[providerID]; b != nil {
			if p.isBackendHealthy(b.Name) {
				p.rememberHintDecision(id, "", providerID, false)
				return b, id, false, true
			}
		}
	}

	// 4. No healthy backend — return first configured backend for error path.
	for _, providerID := range knownProviders {
		if b := p.backends[providerID]; b != nil {
			p.rememberHintDecision(id, "", providerID, false)
			return b, id, false, true
		}
	}

	return nil, id, false, false
}

func (p *CloudProvider) isBackendHealthy(name string) bool {
	if p.health == nil {
		return true
	}
	return p.health.IsHealthy(name)
}

func (p *CloudProvider) rememberDecision(modelID string, backendName string) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return
	}
	info, _ := p.GetDecisionInfo(key)
	info.BackendName = backendName
	p.lastMu.Lock()
	if p.lastRoute == nil {
		p.lastRoute = make(map[string]RouteDecisionInfo)
	}
	p.lastRoute[key] = info
	p.lastMu.Unlock()
}

func (p *CloudProvider) rememberHintDecision(modelID string, hintFrom string, hintTo string, switched bool) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return
	}
	p.lastMu.Lock()
	if p.lastRoute == nil {
		p.lastRoute = make(map[string]RouteDecisionInfo)
	}
	item := p.lastRoute[key]
	item.HintFrom = hintFrom
	item.HintTo = hintTo
	item.HintAutoSwitch = switched
	p.lastRoute[key] = item
	p.lastMu.Unlock()
}

// GetDecisionInfo retrieves the routing decision info for a model.
func (p *CloudProvider) GetDecisionInfo(modelID string) (RouteDecisionInfo, bool) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return RouteDecisionInfo{}, false
	}
	p.lastMu.RLock()
	item, exists := p.lastRoute[key]
	p.lastMu.RUnlock()
	return item, exists
}

// Backends returns the backend map for probe/inspection use.
func (p *CloudProvider) Backends() map[string]*Backend {
	return p.backends
}

// resolveBackendForTarget selects a backend for the given model, optionally overriding with a RemoteTarget.
func (p *CloudProvider) resolveBackendForTarget(modelID string, target *RemoteTarget) (*Backend, string) {
	if target != nil {
		backend := p.backendFromTarget(target)
		resolvedModelID := p.ResolveModelID(modelID)
		return backend, resolvedModelID
	}
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, resolvedModelID
	}
	return backend, resolvedModelID
}

// backendFromTarget creates a backend from a RemoteTarget.
func (p *CloudProvider) backendFromTarget(target *RemoteTarget) *Backend {
	// Try to find an existing backend and override it
	if canonical := ResolveProviderAlias(target.ProviderType); canonical != "" {
		if b := p.backends[canonical]; b != nil {
			return b.WithRequestOverrides(target.Endpoint, target.APIKey)
		}
	}
	// No existing backend, create a temporary one
	if target.Endpoint == "" {
		return nil
	}
	timeout := p.probeTimeout()
	return NewBackend("cloud-"+target.ProviderType, target.Endpoint, target.APIKey, timeout)
}
