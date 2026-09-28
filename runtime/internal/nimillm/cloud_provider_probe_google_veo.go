package nimillm

import (
	"context"
	"net/http"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

// probeGoogleVeoConnector validates an exact read-only native model endpoint.
// Google Veo has no OpenAI-style /models route or Bearer authentication.
func (p *CloudProvider) probeGoogleVeoConnector(ctx context.Context, endpoint string, rawAPIKey string) error {
	if p == nil || strings.TrimSpace(endpoint) == "" {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	apiKey, err := requireProviderAPIKey(rawAPIKey)
	if err != nil {
		return err
	}
	ctx = mediaAdapterEndpointPolicyContext(ctx, MediaAdapterConfig{AllowLoopbackEndpoint: p.allowLoopbackEndpoint})
	target := JoinURL(endpoint, "/v1beta/models/"+googleVeoFastModel)
	response := map[string]any{}
	if err := DoJSONRequestWithHeadersAndTimeout(ctx, http.MethodGet, target, "", nil, &response, map[string]string{"x-goog-api-key": apiKey}, p.probeTimeout()); err != nil {
		return err
	}
	if strings.TrimSpace(ValueAsString(response["name"])) != "models/"+googleVeoFastModel {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	methods, ok := response["supportedGenerationMethods"].([]any)
	if !ok {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	for _, method := range methods {
		if ValueAsString(method) == "predictLongRunning" {
			return nil
		}
	}
	return grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_ROUTE_UNSUPPORTED)
}
