package nimillm

import (
	"context"
	"strings"
	"sync"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
)

// CloudProvider routes AI requests across multiple cloud backends.
type CloudProvider struct {
	nimiLLM   *Backend
	alibaba   *Backend
	bytedance *Backend
	gemini    *Backend
	minimax   *Backend
	kimi      *Backend
	glm       *Backend
	registry  *modelregistry.Registry
	health    *providerhealth.Tracker
	lastMu    sync.RWMutex
	lastRoute map[string]RouteDecisionInfo
}

// NewCloudProvider creates a CloudProvider from the given config.
func NewCloudProvider(cfg CloudConfig, registry *modelregistry.Registry, health *providerhealth.Tracker) *CloudProvider {
	return &CloudProvider{
		nimiLLM:   NewBackend("cloud-nimillm", cfg.NimiLLMBaseURL, cfg.NimiLLMAPIKey, cfg.HTTPTimeout),
		alibaba:   NewBackend("cloud-alibaba", cfg.AlibabaBaseURL, cfg.AlibabaAPIKey, cfg.HTTPTimeout),
		bytedance: NewBackend("cloud-bytedance", cfg.BytedanceBaseURL, cfg.BytedanceAPIKey, cfg.HTTPTimeout),
		gemini:    NewBackend("cloud-gemini", cfg.GeminiBaseURL, cfg.GeminiAPIKey, cfg.HTTPTimeout),
		minimax:   NewBackend("cloud-minimax", cfg.MiniMaxBaseURL, cfg.MiniMaxAPIKey, cfg.HTTPTimeout),
		kimi:      NewBackend("cloud-kimi", cfg.KimiBaseURL, cfg.KimiAPIKey, cfg.HTTPTimeout),
		glm:       NewBackend("cloud-glm", cfg.GLMBaseURL, cfg.GLMAPIKey, cfg.HTTPTimeout),
		registry:  registry,
		health:    health,
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
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return nil
}

// GenerateText routes a text generation request to the appropriate backend.
func (p *CloudProvider) GenerateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		text, usage, finish, err := backend.GenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens())
		if err != nil {
			return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		return text, usage, finish, nil
	}
	return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// Embed routes an embedding request to the appropriate backend.
func (p *CloudProvider) Embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.Embed(ctx, resolvedModelID, inputs)
	}
	return FallbackEmbed(inputs), nil, nil
}

// GenerateImage routes an image generation request.
func (p *CloudProvider) GenerateImage(ctx context.Context, modelID string, spec *runtimev1.ImageGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.GenerateImage(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// GenerateVideo routes a video generation request.
func (p *CloudProvider) GenerateVideo(ctx context.Context, modelID string, spec *runtimev1.VideoGenerationSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.GenerateVideo(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// SynthesizeSpeech routes a speech synthesis request.
func (p *CloudProvider) SynthesizeSpeech(ctx context.Context, modelID string, spec *runtimev1.SpeechSynthesisSpec) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.SynthesizeSpeech(ctx, resolvedModelID, spec)
	}
	return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// Transcribe routes a transcription request.
func (p *CloudProvider) Transcribe(ctx context.Context, modelID string, spec *runtimev1.SpeechTranscriptionSpec, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return "", nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.Transcribe(ctx, resolvedModelID, spec, audio, mimeType)
	}
	return "", nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// StreamGenerateText routes a streaming text generation request.
func (p *CloudProvider) StreamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok := p.PickBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	backend = p.applyRequestCredentials(ctx, backend)
	if backend != nil {
		p.rememberDecision(modelID, backend.Name)
		return backend.StreamGenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens(), onDelta)
	}
	return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
}

// PickBackend selects the appropriate backend for a model ID.
// Returns (backend, resolvedModelID, isExplicit, isAvailable).
func (p *CloudProvider) PickBackend(modelID string) (*Backend, string, bool, bool) {
	id := strings.TrimSpace(modelID)
	if id == "" {
		if p.nimiLLM != nil {
			return p.nimiLLM, "cloud-default", false, true
		}
		return nil, "cloud-default", false, false
	}

	segments := strings.SplitN(id, "/", 2)
	if len(segments) == 2 {
		prefix := strings.ToLower(strings.TrimSpace(segments[0]))
		rest := strings.TrimSpace(segments[1])
		if rest == "" {
			rest = "default"
		}

		switch prefix {
		case "nimillm":
			if p.nimiLLM == nil || !p.isBackendHealthy("cloud-nimillm") {
				return nil, rest, true, false
			}
			return p.nimiLLM, rest, true, true
		case "aliyun", "alibaba":
			if p.alibaba == nil || !p.isBackendHealthy("cloud-alibaba") {
				return nil, rest, true, false
			}
			return p.alibaba, rest, true, true
		case "bytedance", "byte":
			if p.bytedance == nil || !p.isBackendHealthy("cloud-bytedance") {
				return nil, rest, true, false
			}
			return p.bytedance, rest, true, true
		case "gemini":
			if p.gemini == nil || !p.isBackendHealthy("cloud-gemini") {
				return nil, rest, true, false
			}
			return p.gemini, rest, true, true
		case "minimax":
			if p.minimax == nil || !p.isBackendHealthy("cloud-minimax") {
				return nil, rest, true, false
			}
			return p.minimax, rest, true, true
		case "kimi", "moonshot":
			if p.kimi == nil || !p.isBackendHealthy("cloud-kimi") {
				return nil, rest, true, false
			}
			return p.kimi, rest, true, true
		case "glm", "zhipu", "bigmodel":
			if p.glm == nil || !p.isBackendHealthy("cloud-glm") {
				return nil, rest, true, false
			}
			return p.glm, rest, true, true
		}
	}

	if p.registry != nil {
		if item, exists := p.registry.Get(id); exists {
			hintFrom := string(item.ProviderHint)
			switch item.ProviderHint {
			case modelregistry.ProviderHintNimiLLM:
				if p.nimiLLM != nil && p.isBackendHealthy("cloud-nimillm") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintNimiLLM), false)
					return p.nimiLLM, id, false, true
				}
			case modelregistry.ProviderHintAlibaba:
				if p.alibaba != nil && p.isBackendHealthy("cloud-alibaba") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintAlibaba), false)
					return p.alibaba, id, false, true
				}
			case modelregistry.ProviderHintBytedance:
				if p.bytedance != nil && p.isBackendHealthy("cloud-bytedance") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintBytedance), false)
					return p.bytedance, id, false, true
				}
			case modelregistry.ProviderHintGemini:
				if p.gemini != nil && p.isBackendHealthy("cloud-gemini") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintGemini), false)
					return p.gemini, id, false, true
				}
			case modelregistry.ProviderHintMiniMax:
				if p.minimax != nil && p.isBackendHealthy("cloud-minimax") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintMiniMax), false)
					return p.minimax, id, false, true
				}
			case modelregistry.ProviderHintKimi:
				if p.kimi != nil && p.isBackendHealthy("cloud-kimi") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintKimi), false)
					return p.kimi, id, false, true
				}
			case modelregistry.ProviderHintGLM:
				if p.glm != nil && p.isBackendHealthy("cloud-glm") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintGLM), false)
					return p.glm, id, false, true
				}
			case modelregistry.ProviderHintLocal, modelregistry.ProviderHintUnknown:
			}
			fallbackHint := p.firstHealthyHint()
			if fallbackHint != modelregistry.ProviderHintUnknown {
				if fallbackBackend, ok := p.backendForHint(fallbackHint); ok {
					p.registry.Upsert(modelregistry.Entry{
						ModelID:      item.ModelID,
						Version:      item.Version,
						Status:       item.Status,
						Capabilities: append([]string(nil), item.Capabilities...),
						LastHealthAt: item.LastHealthAt,
						Source:       item.Source,
						ProviderHint: fallbackHint,
					})
					p.rememberHintDecision(id, hintFrom, string(fallbackHint), true)
					return fallbackBackend, id, false, true
				}
			}
		}
	}

	if p.nimiLLM != nil {
		if p.isBackendHealthy("cloud-nimillm") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintNimiLLM), false)
			return p.nimiLLM, id, false, true
		}
	}
	if p.alibaba != nil {
		if p.isBackendHealthy("cloud-alibaba") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintAlibaba), false)
			return p.alibaba, id, false, true
		}
	}
	if p.bytedance != nil {
		if p.isBackendHealthy("cloud-bytedance") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintBytedance), false)
			return p.bytedance, id, false, true
		}
	}
	if p.gemini != nil {
		if p.isBackendHealthy("cloud-gemini") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintGemini), false)
			return p.gemini, id, false, true
		}
	}
	if p.minimax != nil {
		if p.isBackendHealthy("cloud-minimax") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintMiniMax), false)
			return p.minimax, id, false, true
		}
	}
	if p.kimi != nil {
		if p.isBackendHealthy("cloud-kimi") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintKimi), false)
			return p.kimi, id, false, true
		}
	}
	if p.glm != nil {
		if p.isBackendHealthy("cloud-glm") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintGLM), false)
			return p.glm, id, false, true
		}
	}

	// No healthy backend, return first configured backend so caller gets concrete provider error path.
	if p.nimiLLM != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintNimiLLM), false)
		return p.nimiLLM, id, false, true
	}
	if p.alibaba != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintAlibaba), false)
		return p.alibaba, id, false, true
	}
	if p.bytedance != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintBytedance), false)
		return p.bytedance, id, false, true
	}
	if p.gemini != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintGemini), false)
		return p.gemini, id, false, true
	}
	if p.minimax != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintMiniMax), false)
		return p.minimax, id, false, true
	}
	if p.kimi != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintKimi), false)
		return p.kimi, id, false, true
	}
	if p.glm != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintGLM), false)
		return p.glm, id, false, true
	}
	return nil, id, false, false
}

func (p *CloudProvider) isBackendHealthy(name string) bool {
	if p.health == nil {
		return true
	}
	return p.health.IsHealthy(name)
}

func (p *CloudProvider) firstHealthyHint() modelregistry.ProviderHint {
	if p.nimiLLM != nil && p.isBackendHealthy("cloud-nimillm") {
		return modelregistry.ProviderHintNimiLLM
	}
	if p.alibaba != nil && p.isBackendHealthy("cloud-alibaba") {
		return modelregistry.ProviderHintAlibaba
	}
	if p.bytedance != nil && p.isBackendHealthy("cloud-bytedance") {
		return modelregistry.ProviderHintBytedance
	}
	if p.gemini != nil && p.isBackendHealthy("cloud-gemini") {
		return modelregistry.ProviderHintGemini
	}
	if p.minimax != nil && p.isBackendHealthy("cloud-minimax") {
		return modelregistry.ProviderHintMiniMax
	}
	if p.kimi != nil && p.isBackendHealthy("cloud-kimi") {
		return modelregistry.ProviderHintKimi
	}
	if p.glm != nil && p.isBackendHealthy("cloud-glm") {
		return modelregistry.ProviderHintGLM
	}
	return modelregistry.ProviderHintUnknown
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

func (p *CloudProvider) backendForHint(hint modelregistry.ProviderHint) (*Backend, bool) {
	switch hint {
	case modelregistry.ProviderHintNimiLLM:
		if p.nimiLLM != nil && p.isBackendHealthy("cloud-nimillm") {
			return p.nimiLLM, true
		}
	case modelregistry.ProviderHintAlibaba:
		if p.alibaba != nil && p.isBackendHealthy("cloud-alibaba") {
			return p.alibaba, true
		}
	case modelregistry.ProviderHintBytedance:
		if p.bytedance != nil && p.isBackendHealthy("cloud-bytedance") {
			return p.bytedance, true
		}
	case modelregistry.ProviderHintGemini:
		if p.gemini != nil && p.isBackendHealthy("cloud-gemini") {
			return p.gemini, true
		}
	case modelregistry.ProviderHintMiniMax:
		if p.minimax != nil && p.isBackendHealthy("cloud-minimax") {
			return p.minimax, true
		}
	case modelregistry.ProviderHintKimi:
		if p.kimi != nil && p.isBackendHealthy("cloud-kimi") {
			return p.kimi, true
		}
	case modelregistry.ProviderHintGLM:
		if p.glm != nil && p.isBackendHealthy("cloud-glm") {
			return p.glm, true
		}
	}
	return nil, false
}

// applyRequestCredentials extracts gRPC metadata credentials and applies overrides.
// The gRPC metadata extraction stays in services/ai layer, but when called from
// there with extracted endpoint+apiKey, we use BackendWithRequestCredentials.
func (p *CloudProvider) applyRequestCredentials(ctx context.Context, backend *Backend) *Backend {
	if backend == nil {
		return nil
	}
	apiKey, endpoint, ok := RequestInjectedCredentials(ctx)
	if !ok {
		return backend
	}
	return backend.WithRequestOverrides(endpoint, apiKey)
}

// RequestInjectedCredentials extracts provider credentials from gRPC metadata.
// This is a convenience re-export; the actual extraction logic uses gRPC metadata.
var RequestInjectedCredentials = defaultRequestInjectedCredentials

func defaultRequestInjectedCredentials(_ context.Context) (apiKey string, endpoint string, ok bool) {
	return "", "", false
}
