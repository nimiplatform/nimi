package nimillm

import (
	"context"
	"encoding/json"
	"net/http"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/bedrocktarget"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.bedrock-native-routing
func (p *CloudProvider) probeBedrockConnector(ctx context.Context, endpoint, key string) error {
	base, err := bedrocktarget.Endpoint(endpoint)
	if err != nil {
		return grpcerr.WithReasonCode(codes.InvalidArgument, runtimev1.ReasonCode_AI_CONNECTOR_INVALID)
	}
	key, err = requireProviderAPIKey(key)
	if err != nil {
		return err
	}
	control := bedrocktarget.ControlEndpoint(base)
	backend := NewSecuredBackendWithHeaders("cloud-bedrock", control, key, nil, p.probeTimeout(), p.allowLoopbackEndpoint)
	if backend == nil {
		return grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	request, err := backend.newRequest(ctx, http.MethodGet, control, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+key)
	response, err := backend.do(request)
	if err != nil {
		return MapProviderRequestError(err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		var body map[string]any
		_ = json.NewDecoder(response.Body).Decode(&body)
		return MapProviderHTTPError(response.StatusCode, body)
	}
	var body struct {
		ModelSummaries json.RawMessage `json:"modelSummaries"`
	}
	if json.NewDecoder(response.Body).Decode(&body) != nil || len(body.ModelSummaries) == 0 || body.ModelSummaries[0] != '[' {
		return grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	return nil
}
