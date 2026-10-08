package nimillm

import (
	"context"
	"math"
	"net/http"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.r025
// The native credits read authenticates the saved connector without creating a
// World, discovering resources, changing inventory or interpreting its budget.
func (p *CloudProvider) probeWorldLabsConnector(ctx context.Context, endpoint, rawAPIKey string, headers map[string]string) error {
	apiKey, err := requireProviderAPIKey(rawAPIKey)
	if err != nil {
		return err
	}
	ctx = mediaAdapterEndpointPolicyContext(ctx, MediaAdapterConfig{AllowLoopbackEndpoint: p.allowLoopbackEndpoint})
	requestHeaders := make(map[string]string, len(headers)+1)
	for key, value := range headers {
		if !strings.EqualFold(key, "WLT-Api-Key") {
			requestHeaders[key] = value
		}
	}
	requestHeaders["WLT-Api-Key"] = apiKey
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(ctx, http.MethodGet, JoinURL(endpoint, "/marble/v1/credits"), "", nil, &response, requestHeaders, p.probeTimeout()); err != nil {
		if reason, ok := grpcerr.ExtractReasonCode(err); ok && reason == runtimev1.ReasonCode_AI_MODEL_NOT_FOUND {
			return grpcerr.WithReasonCodeOptions(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_AUTH_FAILED, grpcerr.ReasonOptions{
				Message: "World Labs API account could not be accessed", ActionHint: "check_worldlabs_api_account_access", Metadata: map[string]string{"provider_http_status": "404"},
			})
		}
		return err
	}
	credits, valid := response["remaining_credits"].(float64)
	if !valid || math.IsNaN(credits) || math.IsInf(credits, 0) || credits < 0 {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}
