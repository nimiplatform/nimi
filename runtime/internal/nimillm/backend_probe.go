package nimillm

import (
	"context"
	"fmt"
	"net/url"
	"sort"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// ProbeModel describes a model entry returned by provider model discovery.
type ProbeModel struct {
	ModelID      string
	ModelLabel   string
	Available    bool
	Capabilities []string
}

type openAIModelArchitecture struct {
	InputModalities  []string `json:"input_modalities"`
	Modality         string   `json:"modality"`
	OutputModalities []string `json:"output_modalities"`
}

type openAIModelRecord struct {
	ID           string                   `json:"id"`
	Name         string                   `json:"name"`
	DisplayName  string                   `json:"display_name"`
	Architecture *openAIModelArchitecture `json:"architecture"`
}

type openAIModelsResponse struct {
	Data []openAIModelRecord `json:"data"`
}

type anthropicModelsResponse struct {
	Data []struct {
		ID          string `json:"id"`
		DisplayName string `json:"display_name"`
		Type        string `json:"type"`
	} `json:"data"`
}

type fireworksModelRecord struct {
	Name               string `json:"name"`
	DisplayName        string `json:"displayName"`
	State              string `json:"state"`
	SupportsImageInput bool   `json:"supportsImageInput"`
	Status             struct {
		Code string `json:"code"`
	} `json:"status"`
	BaseModelDetails struct {
		ModelType string `json:"modelType"`
	} `json:"baseModelDetails"`
}

type fireworksModelsResponse struct {
	Models []fireworksModelRecord `json:"models"`
}

// ProbeConnector checks authenticated provider reachability without hydrating inventory state.
func (b *Backend) ProbeConnector(ctx context.Context) error {
	if b == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	if b.supportsCodexResponses() {
		// chatgpt.com/backend-api/codex model discovery expects the client_version
		// query parameter. Hermes uses the same probe shape.
		return b.probeGETAbsolute(ctx, strings.TrimSuffix(b.baseURL, "/")+"/models?client_version=1.0.0")
	}

	if normalizeProbeProviderToken(strings.TrimPrefix(strings.TrimSpace(b.Name), "cloud-")) == "fireworks" {
		modelsBaseURL, err := fireworksModelsBaseURL(b.baseURL)
		if err != nil {
			return grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
				Message: err.Error(),
			})
		}
		endpoint := strings.TrimSuffix(modelsBaseURL, "/") + "/v1/accounts/fireworks/models"
		return b.probeGETAbsolute(ctx, endpoint)
	}
	if b.supportsAnthropicMessages() {
		return b.probeGET(ctx, "/v1/models")
	}

	paths := []string{"/v1/models", "/models"}
	var lastErr error
	for _, path := range paths {
		if err := b.probeGET(ctx, path); err != nil {
			lastErr = err
			if !shouldRetryModelListPath(err) {
				return err
			}
			continue
		}
		return nil
	}
	if lastErr != nil {
		return lastErr
	}
	return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

// ListModels probes provider model discovery endpoints.
func (b *Backend) ListModels(ctx context.Context) ([]ProbeModel, error) {
	if b == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}

	if normalizeProbeProviderToken(strings.TrimPrefix(strings.TrimSpace(b.Name), "cloud-")) == "fireworks" {
		models, err := b.listFireworksModels(ctx)
		if err == nil {
			return models, nil
		}
		if !shouldRetryModelListPath(err) {
			return nil, err
		}
	}
	if b.supportsAnthropicMessages() {
		var payload anthropicModelsResponse
		if err := b.getJSON(ctx, "/v1/models", &payload); err != nil {
			return nil, err
		}
		return mapAnthropicProbeModels(payload), nil
	}

	paths := []string{"/v1/models", "/models"}
	var lastErr error
	for _, path := range paths {
		var payload openAIModelsResponse
		if err := b.getJSON(ctx, path, &payload); err != nil {
			lastErr = err
			if !shouldRetryModelListPath(err) {
				return nil, err
			}
			continue
		}
		return mapProbeModels(payload), nil
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
}

func (b *Backend) listFireworksModels(ctx context.Context) ([]ProbeModel, error) {
	if b == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	modelsBaseURL, err := fireworksModelsBaseURL(b.baseURL)
	if err != nil {
		return nil, grpcerr.WithReasonCodeOptions(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE, grpcerr.ReasonOptions{
			Message: err.Error(),
		})
	}
	endpoint := strings.TrimSuffix(modelsBaseURL, "/") + "/v1/accounts/fireworks/models"
	var payload fireworksModelsResponse
	if err := b.getJSONAbsolute(ctx, endpoint, &payload); err != nil {
		return nil, err
	}
	return mapFireworksProbeModels(payload), nil
}

func fireworksModelsBaseURL(baseURL string) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(baseURL))
	if err != nil {
		return "", fmt.Errorf("parse fireworks base url: %w", err)
	}
	if parsed.Scheme == "" || parsed.Host == "" {
		return "", fmt.Errorf("fireworks base url must include scheme and host")
	}
	return parsed.Scheme + "://" + parsed.Host, nil
}

// ProbeHealth resolves provider health status from authenticated reachability, and
// optionally verifies that a specific model is present in live inventory.
func (b *Backend) ProbeHealth(ctx context.Context, modelID string) (runtimev1.TokenProviderHealthStatus, string) {
	targetModelID := strings.TrimSpace(modelID)
	if targetModelID == "" {
		if err := b.ProbeConnector(ctx); err != nil {
			return mapProbeHealthError(err)
		}
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY, "reachable"
	}

	models, err := b.ListModels(ctx)
	if err != nil {
		return mapProbeHealthError(err)
	}
	for _, item := range models {
		if strings.EqualFold(strings.TrimSpace(item.ModelID), targetModelID) {
			return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY, fmt.Sprintf("reachable (%d models)", len(models))
		}
	}
	return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED, fmt.Sprintf("model not found: %s", targetModelID)
}

func mapProbeModels(payload openAIModelsResponse) []ProbeModel {
	out := make([]ProbeModel, 0, len(payload.Data))
	seen := make(map[string]struct{}, len(payload.Data))
	for _, item := range payload.Data {
		modelID := strings.TrimSpace(item.ID)
		if modelID == "" {
			continue
		}
		if _, exists := seen[modelID]; exists {
			continue
		}
		seen[modelID] = struct{}{}
		modelLabel := strings.TrimSpace(item.DisplayName)
		if modelLabel == "" {
			modelLabel = strings.TrimSpace(item.Name)
		}
		if modelLabel == "" {
			modelLabel = modelID
		}
		out = append(out, ProbeModel{
			ModelID:      modelID,
			ModelLabel:   modelLabel,
			Available:    true,
			Capabilities: inferOpenAICompatibleProbeCapabilities(item),
		})
	}
	return out
}

func mapFireworksProbeModels(payload fireworksModelsResponse) []ProbeModel {
	out := make([]ProbeModel, 0, len(payload.Models))
	seen := make(map[string]struct{}, len(payload.Models))
	for _, item := range payload.Models {
		modelID := strings.TrimSpace(item.Name)
		if modelID == "" {
			continue
		}
		if _, exists := seen[modelID]; exists {
			continue
		}
		seen[modelID] = struct{}{}
		label := strings.TrimSpace(item.DisplayName)
		if label == "" {
			label = modelID
		}
		out = append(out, ProbeModel{
			ModelID:      modelID,
			ModelLabel:   label,
			Available:    fireworksModelAvailable(item),
			Capabilities: inferFireworksProbeCapabilities(item),
		})
	}
	return out
}

func mapAnthropicProbeModels(payload anthropicModelsResponse) []ProbeModel {
	out := make([]ProbeModel, 0, len(payload.Data))
	seen := make(map[string]struct{}, len(payload.Data))
	for _, item := range payload.Data {
		modelID := strings.TrimSpace(item.ID)
		if modelID == "" {
			continue
		}
		if _, exists := seen[modelID]; exists {
			continue
		}
		seen[modelID] = struct{}{}
		label := strings.TrimSpace(item.DisplayName)
		if label == "" {
			label = modelID
		}
		out = append(out, ProbeModel{
			ModelID:      modelID,
			ModelLabel:   label,
			Available:    true,
			Capabilities: []string{"text.generate"},
		})
	}
	return out
}

func fireworksModelAvailable(item fireworksModelRecord) bool {
	state := strings.TrimSpace(strings.ToUpper(item.State))
	switch state {
	case "", "STATE_UNSPECIFIED", "READY", "ACTIVE":
		return true
	case "DELETING", "DELETED", "FAILED":
		return false
	default:
		return strings.TrimSpace(strings.ToUpper(item.Status.Code)) == "OK"
	}
}

func inferFireworksProbeCapabilities(item fireworksModelRecord) []string {
	modelType := strings.ToLower(strings.TrimSpace(item.BaseModelDetails.ModelType))
	if strings.Contains(modelType, "embedding") || strings.Contains(modelType, "rerank") {
		return nil
	}
	capabilities := []string{"text.generate"}
	if item.SupportsImageInput {
		capabilities = append(capabilities, "text.generate.vision")
	}
	return capabilities
}

func inferOpenAICompatibleProbeCapabilities(item openAIModelRecord) []string {
	inputs := normalizeProbeModalities(nil)
	outputs := normalizeProbeModalities(nil)
	if item.Architecture != nil {
		inputs = normalizeProbeModalities(item.Architecture.InputModalities)
		outputs = normalizeProbeModalities(item.Architecture.OutputModalities)
		if len(inputs) == 0 || len(outputs) == 0 {
			modalityInputs, modalityOutputs := parseArchitectureModality(item.Architecture.Modality)
			if len(inputs) == 0 {
				inputs = modalityInputs
			}
			if len(outputs) == 0 {
				outputs = modalityOutputs
			}
		}
	}

	capabilities := map[string]struct{}{}
	hasInput := func(target string) bool {
		_, ok := inputs[target]
		return ok
	}
	hasOutput := func(target string) bool {
		_, ok := outputs[target]
		return ok
	}

	if hasOutput("embeddings") {
		capabilities["text.embed"] = struct{}{}
	}
	if hasOutput("image") {
		capabilities["image.generate"] = struct{}{}
	}
	if hasOutput("video") {
		capabilities["video.generate"] = struct{}{}
	}
	if hasOutput("audio") {
		capabilities["audio.synthesize"] = struct{}{}
	}
	if hasOutput("text") {
		if hasInput("audio") && !hasInput("text") && !hasInput("image") && !hasInput("video") {
			capabilities["audio.transcribe"] = struct{}{}
		} else {
			capabilities["text.generate"] = struct{}{}
			if hasInput("image") || hasInput("video") {
				capabilities["text.generate.vision"] = struct{}{}
			}
		}
	}

	out := make([]string, 0, len(capabilities))
	for capability := range capabilities {
		out = append(out, capability)
	}
	sort.Strings(out)
	return out
}

func parseArchitectureModality(value string) (map[string]struct{}, map[string]struct{}) {
	parts := strings.SplitN(strings.TrimSpace(strings.ToLower(value)), "->", 2)
	if len(parts) != 2 {
		return normalizeProbeModalities(nil), normalizeProbeModalities(nil)
	}
	return parseModalitySide(parts[0]), parseModalitySide(parts[1])
}

func parseModalitySide(value string) map[string]struct{} {
	fields := strings.FieldsFunc(strings.TrimSpace(strings.ToLower(value)), func(r rune) bool {
		switch r {
		case '+', ',', '/', ' ':
			return true
		default:
			return false
		}
	})
	return normalizeProbeModalities(fields)
}

func normalizeProbeModalities(values []string) map[string]struct{} {
	out := make(map[string]struct{}, len(values))
	for _, value := range values {
		normalized := strings.TrimSpace(strings.ToLower(value))
		if normalized == "" {
			continue
		}
		switch normalized {
		case "embedding":
			normalized = "embeddings"
		case "speech":
			normalized = "audio"
		}
		out[normalized] = struct{}{}
	}
	return out
}

func mapProbeHealthError(err error) (runtimev1.TokenProviderHealthStatus, string) {
	st, ok := status.FromError(err)
	if !ok {
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE.String()
	}

	switch st.Code() {
	case codes.PermissionDenied:
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNAUTHORIZED, strings.TrimSpace(st.Message())
	case codes.NotFound:
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED, strings.TrimSpace(st.Message())
	case codes.InvalidArgument, codes.FailedPrecondition:
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED, strings.TrimSpace(st.Message())
	case codes.DeadlineExceeded:
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE, strings.TrimSpace(st.Message())
	default:
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNREACHABLE, strings.TrimSpace(st.Message())
	}
}

func shouldRetryModelListPath(err error) bool {
	st, ok := status.FromError(err)
	if !ok {
		return false
	}
	switch st.Code() {
	case codes.NotFound, codes.Unimplemented:
		return true
	default:
		return false
	}
}
