package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const AdapterFluxNative = "flux_native_adapter"

// ExecuteFluxMedia submits the selected image or video task to the BFL API.
// Flux uses async task-based generation: POST to submit, GET to poll.
func ExecuteFluxMedia(
	ctx context.Context,
	cfg MediaAdapterConfig,
	updater JobStateUpdater,
	jobID string,
	req *runtimev1.SubmitScenarioJobRequest,
	modelResolved string,
) ([]*runtimev1.ScenarioArtifact, *runtimev1.UsageStats, string, error) {
	ctx = mediaAdapterEndpointPolicyContext(ctx, cfg)
	ctx = originalControlRequest(ctx)
	baseURL := fluxNativeBaseURL(cfg.BaseURL)
	if baseURL == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(cfg.APIKey)
	if err != nil {
		return nil, nil, "", err
	}

	resolvedModel := strings.TrimSpace(modelResolved)
	if resolvedModel == "" {
		return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MODEL_NOT_FOUND)
	}
	var payload map[string]any
	var artifact *runtimev1.ScenarioArtifact
	if scenarioModal(req) == runtimev1.Modal_MODAL_VIDEO && resolvedModel == "flux-3-video" {
		payload, err = flux3VideoPayload(ctx, req.GetSpec().GetVideoGenerate())
		artifact = BinaryArtifact("video/mp4", nil, map[string]any{"adapter": AdapterFluxNative})
	} else if spec := scenarioImageSpec(req); scenarioModal(req) == runtimev1.Modal_MODAL_IMAGE && spec != nil {
		artifact = BinaryArtifact("image/jpeg", nil, map[string]any{"adapter": AdapterFluxNative})
		if capabilitydriver.IsFlux3ImageModel(resolvedModel) {
			payload, err = flux3ImagePayload(ctx, spec, resolvedModel)
		} else {
			payload = map[string]any{"prompt": strings.TrimSpace(spec.GetPrompt())}
			if size := strings.TrimSpace(spec.GetSize()); size != "" {
				parts := strings.Split(size, "x")
				if len(parts) != 2 {
					return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
				}
				w, e1 := strconv.Atoi(parts[0])
				h, e2 := strconv.Atoi(parts[1])
				if e1 != nil || e2 != nil || w <= 0 || h <= 0 {
					return nil, nil, "", grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_MEDIA_OPTION_UNSUPPORTED)
				}
				payload["width"], payload["height"] = w, h
			}
			if spec.GetAspectRatio() != "" {
				payload["aspect_ratio"] = spec.GetAspectRatio()
			}
			if spec.Seed != nil {
				payload["seed"] = spec.GetSeed()
			}
		}
	} else {
		return nil, nil, "", grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
	}
	if err != nil {
		return nil, nil, "", err
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
	_, err = publishNativeTask(ctx, &NativeTaskReceipt{Version: 1, Adapter: AdapterFluxNative, TaskID: providerJobID, Model: resolvedModel, QueryPathTemplate: "/v1/get_result?id={task_id}", PollingURL: pollingURL, Artifact: artifact})
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
	if err != nil || query.User != nil || query.Fragment != "" || query.RawPath != "" {
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
		expected, e := url.Parse(JoinURL(fluxNativeBaseURL(original), "/v1/get_result"))
		return e == nil && query.Path == expected.Path
	}
	official := func(u *url.URL) bool {
		host := strings.ToLower(u.Hostname())
		return u.Scheme == "https" && (u.Port() == "" || u.Port() == "443") && (host == "api.bfl.ai" || (strings.HasPrefix(host, "api.") && strings.HasSuffix(host, ".bfl.ai")))
	}
	return official(base) && official(query) && query.Path == "/v1/get_result"
}

// Only normalize a documented service-base suffix; keep custom gateway paths.
func fluxNativeBaseURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return raw
	}
	u.Path = strings.TrimSuffix(strings.TrimRight(u.Path, "/"), "/v1")
	if u.RawPath != "" {
		u.RawPath = strings.TrimSuffix(strings.TrimRight(u.RawPath, "/"), "/v1")
	}
	return u.String()
}
