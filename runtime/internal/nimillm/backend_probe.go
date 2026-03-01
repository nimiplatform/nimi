package nimillm

import (
	"context"
	"fmt"
	"strings"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// ProbeModel describes a model entry returned by provider model discovery.
type ProbeModel struct {
	ModelID    string
	ModelLabel string
	Available  bool
}

type openAIModelsResponse struct {
	Data []struct {
		ID          string `json:"id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
	} `json:"data"`
}

// ListModels probes provider model discovery endpoints.
func (b *Backend) ListModels(ctx context.Context) ([]ProbeModel, error) {
	if b == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
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

// ProbeHealth resolves provider health status based on model-discovery reachability.
func (b *Backend) ProbeHealth(ctx context.Context, modelID string) (runtimev1.TokenProviderHealthStatus, string) {
	models, err := b.ListModels(ctx)
	if err != nil {
		return mapProbeHealthError(err)
	}

	targetModelID := strings.TrimSpace(modelID)
	if targetModelID != "" {
		for _, item := range models {
			if strings.EqualFold(strings.TrimSpace(item.ModelID), targetModelID) {
				return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY, fmt.Sprintf("reachable (%d models)", len(models))
			}
		}
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_UNSUPPORTED, fmt.Sprintf("model not found: %s", targetModelID)
	}

	if len(models) == 0 {
		return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_DEGRADED, "reachable (0 models)"
	}
	return runtimev1.TokenProviderHealthStatus_TOKEN_PROVIDER_HEALTH_STATUS_HEALTHY, fmt.Sprintf("reachable (%d models)", len(models))
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
			ModelID:    modelID,
			ModelLabel: modelLabel,
			Available:  true,
		})
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
