package ai

import (
	"context"
	"fmt"
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/types/known/structpb"
	"strings"
)

type localProvider struct {
	backend *openAIBackend
}

func (p *localProvider) route() runtimev1.RoutePolicy {
	return runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME
}

func (p *localProvider) resolveModelID(raw string) string {
	modelID := strings.TrimSpace(strings.TrimPrefix(raw, "local/"))
	if modelID == "" {
		return "local-model"
	}
	return modelID
}

func (p *localProvider) checkModelAvailability(modelID string) error {
	return checkModelAvailabilityWithScope(modelID, runtimev1.RoutePolicy_ROUTE_POLICY_LOCAL_RUNTIME)
}

func (p *localProvider) generateText(ctx context.Context, modelID string, req *runtimev1.GenerateRequest, inputText string) (string, *runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if p.backend != nil {
		text, usage, finish, err := p.backend.generateText(ctx, modelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens())
		if err != nil {
			return "", nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
		}
		return text, usage, finish, nil
	}
	text := fmt.Sprintf("[local:%s] %s", modelID, normalizeFallbackText(inputText))
	return text, estimateUsage(inputText, text), runtimev1.FinishReason_FINISH_REASON_STOP, nil
}

func (p *localProvider) embed(ctx context.Context, modelID string, inputs []string) ([]*structpb.ListValue, *runtimev1.UsageStats, error) {
	if p.backend != nil {
		return p.backend.embed(ctx, modelID, inputs)
	}
	return fallbackEmbed(inputs), nil, nil
}

func (p *localProvider) generateImage(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	if p.backend != nil {
		return p.backend.generateImage(ctx, modelID, prompt)
	}
	payload := []byte(fmt.Sprintf("local:image:%s:%s", modelID, prompt))
	return payload, artifactUsage(prompt, payload, 180), nil
}

func (p *localProvider) generateVideo(ctx context.Context, modelID string, prompt string) ([]byte, *runtimev1.UsageStats, error) {
	if p.backend != nil {
		return p.backend.generateVideo(ctx, modelID, prompt)
	}
	payload := []byte(fmt.Sprintf("local:video:%s:%s", modelID, prompt))
	return payload, artifactUsage(prompt, payload, 420), nil
}

func (p *localProvider) synthesizeSpeech(ctx context.Context, modelID string, text string) ([]byte, *runtimev1.UsageStats, error) {
	if p.backend != nil {
		return p.backend.synthesizeSpeech(ctx, modelID, text)
	}
	payload := []byte(fmt.Sprintf("local:audio:%s:%s", modelID, text))
	return payload, artifactUsage(text, payload, 120), nil
}

func (p *localProvider) transcribe(ctx context.Context, modelID string, audio []byte, mimeType string) (string, *runtimev1.UsageStats, error) {
	if p.backend != nil {
		return p.backend.transcribe(ctx, modelID, audio, mimeType)
	}
	text := fmt.Sprintf("local transcription %d bytes (%s)", len(audio), mimeType)
	return text, &runtimev1.UsageStats{
		InputTokens:  maxInt64(1, int64(len(audio)/256)),
		OutputTokens: estimateTokens(text),
		ComputeMs:    maxInt64(10, int64(len(audio)/64)),
	}, nil
}

func (p *localProvider) streamGenerateText(ctx context.Context, modelID string, req *runtimev1.StreamGenerateRequest, onDelta func(string) error) (*runtimev1.UsageStats, runtimev1.FinishReason, error) {
	if p.backend != nil {
		return p.backend.streamGenerateText(ctx, modelID, req.GetInput(), req.GetSystemPrompt(), req.GetTemperature(), req.GetTopP(), req.GetMaxTokens(), onDelta)
	}
	inputText := composeInputText(req.GetSystemPrompt(), req.GetInput())
	outputText := fmt.Sprintf("[local:%s] %s", modelID, normalizeFallbackText(inputText))
	for _, chunk := range splitText(outputText, 24) {
		if onDelta != nil {
			if err := onDelta(chunk); err != nil {
				return nil, runtimev1.FinishReason_FINISH_REASON_ERROR, err
			}
		}
	}
	return estimateUsage(inputText, outputText), runtimev1.FinishReason_FINISH_REASON_STOP, nil
}
