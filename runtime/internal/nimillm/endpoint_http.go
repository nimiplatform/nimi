package nimillm

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func newSecuredHTTPRequest(ctx context.Context, method string, targetURL string, body io.Reader) (*http.Client, *http.Request, error) {
	allowLoopback := allowLoopbackForTargetURL(targetURL)
	client, err := newSecuredHTTPClient(targetURL, allowLoopback)
	if err != nil {
		return nil, nil, err
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, body)
	if err != nil {
		return nil, nil, MapProviderRequestError(err)
	}
	return client, request, nil
}

func newSecuredHTTPClient(targetURL string, allowLoopback bool) (*http.Client, error) {
	if err := endpointsec.ValidateEndpoint(targetURL, allowLoopback); err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}
	transport, err := endpointsec.NewPinnedTransport(targetURL, allowLoopback)
	if err != nil {
		return nil, grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN)
	}
	return &http.Client{
		Timeout:   defaultHTTPTimeout,
		Transport: transport,
	}, nil
}

func allowLoopbackForTargetURL(targetURL string) bool {
	parsed, err := url.Parse(strings.TrimSpace(targetURL))
	if err != nil {
		return false
	}
	host := strings.ToLower(strings.TrimSpace(parsed.Hostname()))
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
