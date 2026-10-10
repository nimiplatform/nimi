package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterFluxNative = "flux_native_adapter"

// ExecuteFluxImage executes an image generation scenario job against the Flux (Black Forest Labs) API.
// Flux uses async task-based generation: POST to submit, GET to poll.
func ExecuteFluxImage(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	ctx = originalControlRequest(ctx)
	baseURL := strings.TrimSuffix(strings.TrimSpace(cfg.BaseURL), "/")
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}

	if scenarioModal(req) != runtimev1.Modal_MODAL_IMAGE {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	spec := scenarioImageSpec(req)
	if spec == nil {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_INPUT_INVALID)
	}

	resolvedModel := strings.TrimSpace(modelResolved)
	if resolvedModel == "" {
		resolvedModel = "flux-pro-1.1"
	}
	payload := map[string]any{
		"prompt": strings.TrimSpace(spec.GetPrompt()),
	}
	if size := strings.TrimSpace(spec.GetSize()); size != "" {
		parts := strings.SplitN(size, "x", 2)
		if len(parts) == 2 {
			payload["width"] = parts[0]
			payload["height"] = parts[1]
		}
	}
	if aspectRatio := strings.TrimSpace(spec.GetAspectRatio()); aspectRatio != "" {
		payload["aspect_ratio"] = aspectRatio
	}
	if seed := spec.GetSeed(); seed != 0 {
		payload["seed"] = seed
	}

	submitPath := firstProviderEndpointPath([]string{"/v1/" + resolvedModel})
	if err := requireNativeTaskPublisher(ctx); err != nil {
		return nil, nil, "", err
	}
	headers := cloneMediaHeaders(cfg.Headers)
	if headers == nil {
		headers = map[string]string{}
	}
	headers["x-key"] = apiKey
	submitResp := map[string]any{}
	if err := DoJSONRequestWithHeaders(nativeCreateRequest(ctx), http.MethodPost, JoinURL(baseURL, submitPath), "", payload, &submitResp, headers); err != nil {
		return nil, nil, "", err
	}
	providerJobID := ExtractTaskIDFromAdapterPayload(AdapterFluxNative, submitResp)
	if providerJobID == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	pollingURL := ValueAsString(submitResp["polling_url"])
	if !validFluxPollingURL(baseURL, pollingURL, providerJobID, cfg.AllowLoopbackEndpoint) {
		return nil, nil, providerJobID, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	artifact := BinaryArtifact("image/png", nil, map[string]any{"adapter": AdapterFluxNative})
	ApplyImageSpecMetadata(artifact, spec)
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterFluxNative, TaskID: providerJobID, QueryPathTemplate: "/v1/get_result?id={task_id}", PollingURL: pollingURL, Artifact: artifact})
	return nil, nil, providerJobID, err
}

// BFL assigns a cluster-specific polling URL with the create receipt. Keep it
// frozen; credentials may follow only this exact task on the captured origin
// or from an official BFL API origin to another official API cluster.
// Protocol: https://docs.bfl.ai/quick_start/generating_images
func validFluxPollingURL(original, returned, id string, allowLoopback bool) bool {
	base, err := url.Parse(original)
	if err != nil {
		return false
	}
	query, err := url.Parse(returned)
	if err != nil || query.User != nil || query.Fragment != "" || query.RawPath != "" || query.Path != "/v1/get_result" {
		return false
	}
	values, err := url.ParseQuery(query.RawQuery)
	if err != nil || len(values) != 1 || len(values["id"]) != 1 || values.Get("id") != id || id == "" {
		return false
	}
	if query.Scheme != "https" {
		if !allowLoopback || query.Scheme != "http" || (query.Hostname() != "127.0.0.1" && query.Hostname() != "localhost" && query.Hostname() != "::1") {
			return false
		}
	}
	if base.Scheme == query.Scheme && base.Host == query.Host {
		return true
	}
	official := func(u *url.URL) bool {
		host := strings.ToLower(u.Hostname())
		return u.Scheme == "https" && (u.Port() == "" || u.Port() == "443") && (host == "api.bfl.ai" || (strings.HasPrefix(host, "api.") && strings.HasSuffix(host, ".bfl.ai")))
	}
	return official(base) && official(query)
}
