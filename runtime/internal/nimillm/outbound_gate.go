package nimillm

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptrace"
	"sync"
)

type OutboundGate func(context.Context, func() error) error
type outboundGateKey struct{}

func WithOutboundGate(ctx context.Context, gate OutboundGate) context.Context {
	return context.WithValue(ctx, outboundGateKey{}, gate)
}

type gatedHTTPTransport struct {
	transport *http.Transport
	gate      OutboundGate
}

type outboundHTTPResult struct {
	response *http.Response
	err      error
}

// RoundTrip enters the real transport while the owner guard is held. GetConn
// is the transport handoff, before dialing or waiting for response headers.
// Once handed off, a Connector mutation cannot retract this exact IO.
func (t *gatedHTTPTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	handed, released := make(chan struct{}), make(chan struct{})
	finished := make(chan outboundHTTPResult, 1)
	var once sync.Once
	traced := request.WithContext(httptrace.WithClientTrace(request.Context(), &httptrace.ClientTrace{GetConn: func(string) { once.Do(func() { close(handed) }); <-released }}))
	started := false
	var early *outboundHTTPResult
	err := t.gate(request.Context(), func() error {
		started = true
		go func() { response, err := t.transport.RoundTrip(traced); finished <- outboundHTTPResult{response, err} }()
		select {
		case <-handed:
			return nil
		case result := <-finished:
			early = &result
			return nil
		case <-request.Context().Done():
			return request.Context().Err()
		}
	})
	close(released)
	if !started {
		return nil, err
	}
	var result outboundHTTPResult
	if early != nil {
		result = *early
	} else {
		result = <-finished
	}
	if err != nil {
		if result.response != nil && result.response.Body != nil {
			_ = result.response.Body.Close()
		}
		return nil, err
	}
	return result.response, result.err
}

func (t *gatedHTTPTransport) CloseIdleConnections() { t.transport.CloseIdleConnections() }

func httpClientWithOutboundGate(ctx context.Context, client *http.Client) *http.Client {
	gate, ok := ctx.Value(outboundGateKey{}).(OutboundGate)
	if !ok || gate == nil {
		return client
	}
	cloned := *client
	redirect := client.CheckRedirect
	cloned.CheckRedirect = func(next *http.Request, via []*http.Request) error {
		if len(via) > 0 && via[0].Method != http.MethodGet && via[0].Method != http.MethodHead {
			return http.ErrUseLastResponse
		}
		if redirect != nil {
			return redirect(next, via)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	}
	transport := client.Transport
	if transport == nil {
		transport = http.DefaultTransport
	}
	if base, ok := transport.(*http.Transport); ok {
		// Each admitted Job HTTP request owns a fresh HTTP/1 connection. Go's
		// HTTP/1 retry path requires a reused connection; without reuse there
		// is no hidden POST/idempotency replay or unfenced GET retry. Pinned
		// provider transports already use HTTP/1; make that boundary explicit.
		owned := base.Clone()
		owned.DisableKeepAlives = true
		owned.Protocols = new(http.Protocols)
		owned.Protocols.SetHTTP1(true)
		if owned.TLSClientConfig != nil {
			owned.TLSClientConfig.NextProtos = []string{"http/1.1"}
		}
		cloned.Transport = &gatedHTTPTransport{transport: owned, gate: gate}
	} else {
		cloned.Transport = refusedJobTransport{}
	}
	return &cloned
}

type refusedJobTransport struct{}

func (refusedJobTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, fmt.Errorf("Job outbound transport has no guarded handoff")
}
