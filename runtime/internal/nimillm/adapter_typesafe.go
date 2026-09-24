package nimillm

import (
	"bytes"
	"context"
	"io"
	"net/http"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

const (
	typeSafeProviderID = "typesafe"
	// TypeSafeSystemOnePath is the fixed System One resource below the exact
	// Connector endpoint (default https://api.typesafe.ai).
	TypeSafeSystemOnePath        = "/v1/systemone"
	maxTypeSafeErrorBodyDrainLen = 64 << 10
)

// DecideWithTarget transports one already-mapped text.decide body to the
// exact Connector target and returns the raw 2xx provider body. It never
// selects a provider, model, endpoint, credential, retry or fallback, and it
// never interprets provider error text.
func (p *CloudProvider) DecideWithTarget(ctx context.Context, modelID string, body []byte, target *RemoteTarget) ([]byte, error) {
	if p == nil || target == nil || len(body) == 0 || target.ProviderType != typeSafeProviderID {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONFIG_INVALID)
	}
	backend, _ := p.resolveBackendForTarget(modelID, target)
	if backend == nil {
		return nil, grpcerr.WithReasonCode(codes.Unavailable, runtimev1.ReasonCode_AI_PROVIDER_UNAVAILABLE)
	}
	return backend.postTypeSafeSystemOne(ctx, body)
}

func (b *Backend) postTypeSafeSystemOne(ctx context.Context, body []byte) ([]byte, error) {
	request, err := b.newRequest(ctx, http.MethodPost, b.baseURL+TypeSafeSystemOnePath, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := b.do(request)
	if err != nil {
		return nil, MapProviderRequestError(err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maxTypeSafeErrorBodyDrainLen))
		// The status alone selects the typed reason; provider error text is
		// neither parsed nor propagated.
		return nil, MapProviderHTTPError(response.StatusCode, nil)
	}
	raw, err := readLimitedResponseBody(response.Body, maxJSONOrBinaryResponseBytes)
	if err != nil {
		return nil, providerResponseReadError(err)
	}
	return raw, nil
}
