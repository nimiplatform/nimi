package nimillm

import (
	"context"
	"log/slog"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterBytedanceARKTask = "bytedance_ark_task_adapter"

func ExecuteBytedanceARKTask(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	baseURL := strings.TrimSpace(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey := strings.TrimSpace(cfg.APIKey)

	switch scenarioModal(req) {
	case runtimev1.Modal_MODAL_VIDEO:
		spec := scenarioVideoSpec(req)
		if spec == nil {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}
		submitPath := resolveBytedanceARKVideoSubmitPath()
		queryPathTemplate := resolveBytedanceARKVideoQueryPathTemplate()
		submitPayload, err := buildSeedanceVideoPayload(ctx, modelResolved, spec)
		if err != nil {
			return nil, nil, "", err
		}
		contentPayload := submitPayload["content"].([]map[string]any)
		if len(contentPayload) == 0 {
			return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
		}

		// Request content (including the user prompt) must not reach logs.
		slog.Debug("volcengine video submit",
			"url", JoinURL(baseURL, submitPath),
			"model", modelResolved,
		)
		if err := requireNativeTaskPublisher(ctx); err != nil {
			return nil, nil, "", err
		}
		ctx = originalControlRequest(ctx)
		submitResp := map[string]any{}
		if err := DoJSONRequest(nativeCreateRequest(ctx), http.MethodPost, JoinURL(baseURL, submitPath), apiKey, submitPayload, &submitResp); err != nil {
			slog.Warn("volcengine video submit failed", "error", err.Error())
			return nil, nil, "", err
		}
		providerJobID := ExtractTaskIDFromAdapterPayload(AdapterBytedanceARKTask, submitResp)
		if providerJobID == "" {
			return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
		}
		template := BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterBytedanceARKTask})
		_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterBytedanceARKTask, TaskID: providerJobID, Model: modelResolved, QueryPathTemplate: queryPathTemplate, Artifact: template})
		return nil, nil, providerJobID, err

	default:
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
}

// Provider-specific path resolvers (package-private)

func resolveBytedanceARKVideoSubmitPath() string {
	return firstProviderEndpointPath([]string{"/contents/generations/tasks"})
}

func resolveBytedanceARKVideoQueryPathTemplate() string {
	return resolveTaskQueryPathTemplate([]string{"/contents/generations/tasks/{task_id}"})
}
