package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/modelregistry"
	"github.com/nimiplatform/nimi/runtime/internal/providerhealth"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/types/known/structpb"
	"strings"
	"sync"
)

type cloudProvider struct {
	litellm   *openAIBackend
	alibaba   *openAIBackend
	bytedance *openAIBackend
	registry  *modelregistry.Registry
	health    *providerhealth.Tracker
	lastMu    sync.RWMutex
	lastRoute map[string]routeDecisionInfo
}

func (p *cloudProvider) route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API
}

func (p *cloudProvider) resolveModelID(raw string) string {
	modelID := strings.TrimSpace(strings.TrimPrefix(raw, "cloud/"))
	modelID = strings.TrimSpace(strings.TrimPrefix(modelID, "token/"))
	if modelID == "" {
		return "cloud-default"
	}
	return modelID
}

func (p *cloudProvider) checkModelAvailability(modelID string) error {
	if err := checkModelAvailabilityWithScope(modelID, runtimev1.RoutePolicy_ROUTE_POLICY_TOKEN_API); err != nil {
		return err
	}
	_, _, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	return nil
}

func (p *cloudProvider) generateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		text, usage, finish, err := backend.generateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens())
		if err != nil {
			return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		return text, usage, finish, nil
	}
	text := fmt.Sprintf("[cloud:%s] %s", modelID, normalizeFallbackText(inputText))
	return text, estimateUsage(inputText, text), runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

func (p *cloudProvider) embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.embed(ctx, resolvedModelID, inputs)
	}
	return fallbackEmbed(inputs), nil, nil
}

func (p *cloudProvider) generateImage(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.generateImage(ctx, resolvedModelID, prompt)
	}
	payload := []byte(fmt.Sprintf("cloud:image:%s:%s", modelID, prompt))
	return payload, artifactUsage(prompt, payload, 180), nil
}

func (p *cloudProvider) generateVideo(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.generateVideo(ctx, resolvedModelID, prompt)
	}
	payload := []byte(fmt.Sprintf("cloud:video:%s:%s", modelID, prompt))
	return payload, artifactUsage(prompt, payload, 420), nil
}

func (p *cloudProvider) synthesizeSpeech(ctx context.Context, modelID string, text string) ([]byte, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.synthesizeSpeech(ctx, resolvedModelID, text)
	}
	payload := []byte(fmt.Sprintf("cloud:audio:%s:%s", modelID, text))
	return payload, artifactUsage(text, payload, 120), nil
}

func (p *cloudProvider) transcribe(ctx context.Context, modelID string, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return "", nil, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.transcribe(ctx, resolvedModelID, audio, mimeType)
	}
	text := fmt.Sprintf("cloud transcription %d bytes (%s)", len(audio), mimeType)
	return text, &runtimev1.UsageStats{
		InputTokens:  maxInt64(1, int64(len(audio)/256)),
		OutputTokens: estimateTokens(text),
		ComputeMs:    maxInt64(10, int64(len(audio)/64)),
	}, nil
}

func (p *cloudProvider) streamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	backend, resolvedModelID, explicit, ok := p.pickBackend(modelID)
	if explicit && !ok {
		return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, status.Error(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String())
	}
	if backend != nil {
		p.rememberDecision(modelID, backend.name)
		return backend.streamGenerateText(ctx, resolvedModelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens(), onDelta)
	}

	inputText := composeInputText(req.GetSystemPrompt(), req.GetInput())
	outputText := fmt.Sprintf("[cloud:%s] %s", modelID, normalizeFallbackText(inputText))
	for _, chunk := range splitText(outputText, 24) {
		if onDelta != nil {
			if err := onDelta(chunk); err != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
			}
		}
	}
	return estimateUsage(inputText, outputText), runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

func (p *cloudProvider) pickBackend(modelID string) (*openAIBackend, string, bool, bool) {
	id := strings.TrimSpace(modelID)
	if id == "" {
		if p.litellm != nil {
			return p.litellm, "cloud-default", false, true
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
		case "litellm":
			if p.litellm == nil || !p.isBackendHealthy("cloud-litellm") {
				return nil, rest, true, false
			}
			return p.litellm, rest, true, true
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
		}
	}

	if p.registry != nil {
		if item, exists := p.registry.Get(id); exists {
			hintFrom := string(item.ProviderHint)
			switch item.ProviderHint {
			case modelregistry.ProviderHintLiteLLM:
				if p.litellm != nil && p.isBackendHealthy("cloud-litellm") {
					p.rememberHintDecision(id, hintFrom, string(modelregistry.ProviderHintLiteLLM), false)
					return p.litellm, id, false, true
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

	if p.litellm != nil {
		if p.isBackendHealthy("cloud-litellm") {
			p.rememberHintDecision(id, "", string(modelregistry.ProviderHintLiteLLM), false)
			return p.litellm, id, false, true
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

	// No healthy backend, return first configured backend so caller gets concrete provider error path.
	if p.litellm != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintLiteLLM), false)
		return p.litellm, id, false, true
	}
	if p.alibaba != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintAlibaba), false)
		return p.alibaba, id, false, true
	}
	if p.bytedance != nil {
		p.rememberHintDecision(id, "", string(modelregistry.ProviderHintBytedance), false)
		return p.bytedance, id, false, true
	}
	return nil, id, false, false
}

func (p *cloudProvider) isBackendHealthy(name string) bool {
	if p.health == nil {
		return true
	}
	return p.health.IsHealthy(name)
}

func (p *cloudProvider) firstHealthyHint() modelregistry.ProviderHint {
	if p.litellm != nil && p.isBackendHealthy("cloud-litellm") {
		return modelregistry.ProviderHintLiteLLM
	}
	if p.alibaba != nil && p.isBackendHealthy("cloud-alibaba") {
		return modelregistry.ProviderHintAlibaba
	}
	if p.bytedance != nil && p.isBackendHealthy("cloud-bytedance") {
		return modelregistry.ProviderHintBytedance
	}
	return modelregistry.ProviderHintUnknown
}

func (p *cloudProvider) rememberDecision(modelID string, backendName string) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return
	}
	info, _ := p.getDecisionInfo(key)
	info.BackendName = backendName
	p.lastMu.Lock()
	if p.lastRoute == nil {
		p.lastRoute = make(map[string]routeDecisionInfo)
	}
	p.lastRoute[key] = info
	p.lastMu.Unlock()
}

func (p *cloudProvider) rememberHintDecision(modelID string, hintFrom string, hintTo string, switched bool) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return
	}
	p.lastMu.Lock()
	if p.lastRoute == nil {
		p.lastRoute = make(map[string]routeDecisionInfo)
	}
	item := p.lastRoute[key]
	item.HintFrom = hintFrom
	item.HintTo = hintTo
	item.HintAutoSwitch = switched
	p.lastRoute[key] = item
	p.lastMu.Unlock()
}

func (p *cloudProvider) getDecisionInfo(modelID string) (routeDecisionInfo, bool) {
	key := strings.TrimSpace(modelID)
	if key == "" {
		return routeDecisionInfo{}, false
	}
	p.lastMu.RLock()
	item, exists := p.lastRoute[key]
	p.lastMu.RUnlock()
	return item, exists
}

func (p *cloudProvider) backendForHint(hint modelregistry.ProviderHint) (*openAIBackend, bool) {
	switch hint {
	case modelregistry.ProviderHintLiteLLM:
		if p.litellm != nil && p.isBackendHealthy("cloud-litellm") {
			return p.litellm, true
		}
	case modelregistry.ProviderHintAlibaba:
		if p.alibaba != nil && p.isBackendHealthy("cloud-alibaba") {
			return p.alibaba, true
		}
	case modelregistry.ProviderHintBytedance:
		if p.bytedance != nil && p.isBackendHealthy("cloud-bytedance") {
			return p.bytedance, true
		}
	}
	return nil, false
}
