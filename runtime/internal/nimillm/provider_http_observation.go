package nimillm

import (
	"context"
	"crypto/tls"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptrace"
	"regexp"
	"sync"
	"time"
)

// providerRequestIDHeaders name the response headers in which providers return
// their own request identifier; the value identifies one request to the
// provider and carries no credential.
var providerRequestIDHeaders = []string{"x-request-id", "request-id", "x-goog-request-id"}

var providerRequestIDPattern = regexp.MustCompile(`^[A-Za-z0-9_.:-]{1,128}$`)

// providerHTTPObservation records how far one provider request got through
// connect, TLS, request write and first response byte, for diagnostics. It
// keeps only the backend name, method, path, phase timings, connection reuse,
// status, the provider request ID and a failure class: never a header value,
// credential, address, query or body.
type providerHTTPObservation struct {
	mu                                   sync.Mutex
	backend, method, path                string
	resolve                              time.Duration
	start                                time.Time
	connectStart, connectDone            time.Time
	tlsStart, tlsDone, written, response time.Time
	reused                               bool
}

// observeProviderHTTP starts one observation. resolve is how long the backend
// took to resolve and pin its endpoint before this request, or zero.
func observeProviderHTTP(backend string, resolve time.Duration, request *http.Request) (*http.Request, *providerHTTPObservation) {
	observation := &providerHTTPObservation{backend: backend, method: request.Method, path: request.URL.Path, resolve: resolve, start: time.Now()}
	set := func(field *time.Time) {
		observation.mu.Lock()
		if field.IsZero() {
			*field = time.Now()
		}
		observation.mu.Unlock()
	}
	trace := &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			observation.mu.Lock()
			observation.reused = info.Reused
			observation.mu.Unlock()
		},
		ConnectStart:         func(string, string) { set(&observation.connectStart) },
		ConnectDone:          func(_, _ string, err error) { markDone(observation, &observation.connectDone, err) },
		TLSHandshakeStart:    func() { set(&observation.tlsStart) },
		TLSHandshakeDone:     func(_ tls.ConnectionState, err error) { markDone(observation, &observation.tlsDone, err) },
		WroteRequest:         func(info httptrace.WroteRequestInfo) { markDone(observation, &observation.written, info.Err) },
		GotFirstResponseByte: func() { set(&observation.response) },
	}
	return request.WithContext(httptrace.WithClientTrace(request.Context(), trace)), observation
}

// markDone records a phase as completed only when it succeeded.
func markDone(observation *providerHTTPObservation, field *time.Time, err error) {
	if err != nil {
		return
	}
	observation.mu.Lock()
	if field.IsZero() {
		*field = time.Now()
	}
	observation.mu.Unlock()
}

// phase names the furthest transport phase the request completed.
func (observation *providerHTTPObservation) phase() string {
	switch {
	case !observation.response.IsZero():
		return "response"
	case !observation.written.IsZero():
		return "awaiting_response"
	case !observation.tlsDone.IsZero(), observation.reused:
		return "writing_request"
	case !observation.connectDone.IsZero():
		return "tls_handshake"
	case !observation.connectStart.IsZero():
		return "connect"
	default:
		return "before_connect"
	}
}

func (observation *providerHTTPObservation) attributes() []any {
	observation.mu.Lock()
	defer observation.mu.Unlock()
	since := func(from, to time.Time) int64 {
		if from.IsZero() || to.IsZero() {
			return -1
		}
		return to.Sub(from).Milliseconds()
	}
	return []any{
		"backend", observation.backend, "method", observation.method, "path", observation.path,
		"phase", observation.phase(), "elapsed_ms", time.Since(observation.start).Milliseconds(),
		"resolve_ms", observation.resolve.Milliseconds(),
		"connect_ms", since(observation.connectStart, observation.connectDone),
		"tls_ms", since(observation.tlsStart, observation.tlsDone),
		"first_byte_ms", since(observation.start, observation.response),
		"conn_reused", observation.reused,
	}
}

// finish logs a failed request or a provider error status at warning level,
// a completed request at info level (one line, like the other Runtime latency
// observations) and a caller-canceled request at debug level.
func (observation *providerHTTPObservation) finish(response *http.Response, err error) {
	attributes := observation.attributes()
	switch {
	case errors.Is(err, context.Canceled):
		slog.Debug("provider http request canceled", attributes...)
	case err != nil:
		slog.Warn("provider http request failed", append(attributes, "failure_class", ProviderRequestFailureClass(err))...)
	case response.StatusCode >= 400:
		slog.Warn("provider http error status", append(attributes, "status", response.StatusCode, "request_id", providerRequestID(response.Header))...)
	default:
		slog.Info("provider http observation", append(attributes, "status", response.StatusCode, "request_id", providerRequestID(response.Header))...)
	}
}

func providerRequestID(header http.Header) string {
	for _, name := range providerRequestIDHeaders {
		if value := header.Get(name); providerRequestIDPattern.MatchString(value) {
			return value
		}
	}
	return ""
}

// logProviderStreamFailure records a response stream that broke after the
// provider accepted the request, with the time since the request started. A
// caller cancellation is not a provider failure.
func logProviderStreamFailure(backend string, path string, started time.Time, err error) {
	if errors.Is(err, context.Canceled) {
		return
	}
	slog.Warn("provider response stream failed", "backend", backend, "path", path,
		"elapsed_ms", time.Since(started).Milliseconds(), "failure_class", ProviderRequestFailureClass(err))
}

// endpointResolutionFailureClass names, for diagnostics only, why a provider
// endpoint could not be resolved and pinned before any request.
func endpointResolutionFailureClass(err error) string {
	var dnsErr *net.DNSError
	switch {
	case errors.As(err, &dnsErr) && dnsErr.IsTimeout:
		return "dns-timeout"
	case errors.As(err, &dnsErr) && dnsErr.IsNotFound:
		return "dns-not-found"
	case errors.As(err, &dnsErr):
		return "dns"
	default:
		return "endpoint-policy"
	}
}
