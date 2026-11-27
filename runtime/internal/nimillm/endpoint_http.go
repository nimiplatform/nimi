package nimillm

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync/atomic"

	"google.golang.org/grpc/codes"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

type originalControlRequestKey struct{}

func originalControlRequest(ctx context.Context) context.Context {
	return context.WithValue(ctx, originalControlRequestKey{}, true)
}

func newSecuredHTTPRequest(ctx context.Context, method string, targetURL string, body io.Reader) (*http.Client, *http.Request, error) {
	client, err := newSecuredHTTPClient(ctx, targetURL, allowLoopbackProviderEndpointFromContext(ctx))
	if err != nil {
		return nil, nil, err
	}
	if exact, _ := ctx.Value(originalControlRequestKey{}).(bool); exact {
		client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	}
	request, err := http.NewRequestWithContext(ctx, method, targetURL, body)
	if err != nil {
		return nil, nil, MapProviderRequestError(err)
	}
	return client, request, nil
}

func newSecuredHTTPClient(ctx context.Context, targetURL string, allowLoopback bool) (*http.Client, error) {
	// Fail fast when the configured endpoint itself is forbidden before constructing a request.
	if err := validateSecuredProviderEndpoint(ctx, targetURL, allowLoopback); err != nil {
		return nil, err
	}
	client := httpClientWithOutboundGate(ctx, &http.Client{Timeout: defaultHTTPTimeout})
	origin, _ := url.Parse(strings.TrimSpace(targetURL)) // validated by endpointsec
	client.Transport = &securedHTTPTransport{origin: origin, allowLoopback: allowLoopback}
	return client, nil
}

func validateSecuredProviderEndpoint(ctx context.Context, targetURL string, allowLoopback bool) error {
	if err := endpointsec.ValidateEndpoint(ctx, targetURL, allowLoopback); err != nil {
		return grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			err,
			grpcerr.ReasonOptions{Message: "provider endpoint is not permitted"},
		)
	}
	return nil
}

func securedProviderTransport(ctx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error) {
	transport, err := endpointsec.NewPinnedTransport(ctx, targetURL, allowLoopback)
	if err != nil {
		return nil, grpcerr.WrapWithReasonCode(
			codes.FailedPrecondition,
			runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN,
			err,
			grpcerr.ReasonOptions{Message: "provider endpoint is not permitted"},
		)
	}
	return transport, nil
}

// Every outbound send (initial request, subsequent same-origin send, same-origin
// GET/HEAD redirect, or cross-origin artifact redirect) validates its actual
// destination and current address set immediately before sending and uses a
// fresh pinned one-shot transport without pooled cross-send reuse.
// @nimi-authority: rule.nimi.runtime.security-core.r034
// @nimi-authority: rule.nimi.runtime.security-core.r035
type securedHTTPTransport struct {
	origin          *url.URL
	initial         http.RoundTripper
	allowLoopback   bool
	initialConsumed atomic.Bool
	buildTransport  func(ctx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error)
}

func (t *securedHTTPTransport) newValidatedTransport(ctx context.Context, targetURL string) (*http.Transport, error) {
	builder := t.buildTransport
	if builder == nil {
		builder = securedProviderTransport
	}
	transport, err := builder(ctx, targetURL, t.allowLoopback)
	if err != nil {
		return nil, err
	}
	// Each send owns a fresh connection bound to its just-validated address set.
	// Use MaxIdleConnsPerHost = -1 so the single connection is never pooled
	// after completion without forcing a Connection: close request header that
	// alters server-side streaming body/disconnect handling.
	transport.MaxIdleConnsPerHost = -1
	return transport, nil
}

func (t *securedHTTPTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	if request.Host != "" && !strings.EqualFold(request.Host, request.URL.Host) {
		return nil, fmt.Errorf("provider request Host differs from its validated destination")
	}
	if t.origin != nil && sameProviderHTTPOrigin(request.URL, t.origin) {
		if t.initial != nil && !t.initialConsumed.Swap(true) {
			return httpClientWithOutboundGate(request.Context(), &http.Client{Transport: t.initial}).Transport.RoundTrip(request)
		}
		transport, err := t.newValidatedTransport(request.Context(), request.URL.String())
		if err != nil {
			return nil, err
		}
		return httpClientWithOutboundGate(request.Context(), &http.Client{Transport: transport}).Transport.RoundTrip(request)
	}
	transport, err := t.newValidatedTransport(request.Context(), request.URL.String())
	if err != nil {
		return nil, err
	}
	next := request.Clone(request.Context())
	next.Header = make(http.Header)
	// Connection credentials and provider-specific headers belong to the
	// original authority. Artifact redirects may carry their own signed URL.
	for _, name := range []string{"Accept", "Accept-Encoding", "Range", "If-Range"} {
		if values := request.Header.Values(name); len(values) > 0 {
			next.Header[name] = append([]string(nil), values...)
		}
	}
	return httpClientWithOutboundGate(next.Context(), &http.Client{Transport: transport}).Transport.RoundTrip(next)
}

func sameProviderHTTPOrigin(a, b *url.URL) bool {
	port := func(value *url.URL) string {
		if explicit := value.Port(); explicit != "" {
			return explicit
		}
		if strings.EqualFold(value.Scheme, "https") {
			return "443"
		}
		return "80"
	}
	return strings.EqualFold(a.Scheme, b.Scheme) && strings.EqualFold(a.Hostname(), b.Hostname()) && port(a) == port(b)
}

func (t *securedHTTPTransport) CloseIdleConnections() {
	if closer, ok := t.initial.(interface{ CloseIdleConnections() }); ok {
		closer.CloseIdleConnections()
	}
}
