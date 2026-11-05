package nimillm

import (
	"context"
	"net/http"
	"net/url"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
	"google.golang.org/protobuf/proto"
)

const lumaAgentsQueryPath = "/v1/generations/{task_id}"

func lumaAgentsBaseURL(raw string) string {
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

func observeLumaAgents(ctx context.Context, cfg MediaAdapterConfig, r *NativeTaskReceipt, generationType, outputType string) (*NativeTaskObservation, bool, error) {
	response := map[string]any{}
	err := DoJSONRequestWithHeaders(ctx, http.MethodGet, JoinURL(lumaAgentsBaseURL(cfg.BaseURL), ResolveTaskQueryPath(r.QueryPathTemplate, r.TaskID)), cfg.APIKey, nil, &response, cfg.Headers)
	if err != nil {
		return nil, false, err
	}
	invalid := grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	if ValueAsString(response["id"]) != r.TaskID || ValueAsString(response["model"]) != r.Model || ValueAsString(response["type"]) != generationType {
		return nil, false, invalid
	}
	switch ValueAsString(response["state"]) {
	case "queued", "processing":
		return nil, false, nil
	case "failed":
		reason := runtimev1.ReasonCode_AI_PROVIDER_INTERNAL
		code := codes.Internal
		switch ValueAsString(response["failure_code"]) {
		case "content_moderated":
			reason = runtimev1.ReasonCode_AI_CONTENT_FILTER_BLOCKED
			code = codes.PermissionDenied
		case "budget_exhausted":
			reason = runtimev1.ReasonCode_AI_PROVIDER_RATE_LIMITED
			code = codes.ResourceExhausted
		}
		return nil, true, grpcerr.WithReasonCode(code, reason)
	case "completed":
	default:
		return nil, false, invalid
	}
	rows, ok := response["output"].([]any)
	if !ok || len(rows) != 1 {
		return nil, false, invalid
	}
	row, ok := rows[0].(map[string]any)
	if !ok || ValueAsString(row["type"]) != outputType || !validNativeVideoArtifactURL(ValueAsString(row["url"])) {
		return nil, false, invalid
	}
	artifact := proto.Clone(r.Artifact).(*runtimev1.ScenarioArtifact)
	artifact.Uri = ValueAsString(row["url"])
	artifact.SizeBytes = 0
	artifact.Sha256 = ""
	return &NativeTaskObservation{Artifacts: []*runtimev1.ScenarioArtifact{artifact}}, true, nil
}
