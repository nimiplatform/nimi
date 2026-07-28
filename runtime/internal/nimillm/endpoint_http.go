package nimillm

import (
	"context"
	"io"
	"net/http"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func newSecuredHTTPRequest(ctx context.Context, method string, targetURL string, body io.Reader) (*http.Client, *http.Request, error) {
	client, err := newSecuredHTTPClient(ctx, targetURL, allowLoopbackProviderEndpointFromContext(ctx))
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, body)
	if err != nil {
		return nil, nil, MapProviderRequestError(err)
	}
	return client, request, nil
}

func newSecuredHTTPClient(ctx context.Context, targetURL string, allowLoopback bool) (*http.Client, error) {
	transport, err := endpointsec.NewPinnedTransport(ctx, targetURL, allowLoopback)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			err,
			grpcerr.ReasonOptions{Message: "provider endpoint is not permitted"},
		)
	}
	return &http.Client{
		Timeout:   defaultHTTPTimeout,
		Transport: transport,
	}, nil
}
