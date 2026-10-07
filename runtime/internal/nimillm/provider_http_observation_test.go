package nimillm

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func captureProviderLogs(t *testing.T) *bytes.Buffer {
	t.Helper()
	var buffer bytes.Buffer
	previous := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(&buffer, &slog.HandlerOptions{Level: slog.LevelDebug})))
	t.Cleanup(func() { slog.SetDefault(previous) })
	return &buffer
}

func TestWorldLabsJSONObservationIdentifiesTransportStageWithoutSensitiveData(t *testing.T) {
	logs := captureProviderLogs(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/drop" {
			conn, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = conn.Close()
			return
		}
		w.WriteHeader(http.StatusPaymentRequired)
		_, _ = w.Write([]byte(`{"detail":"private provider body"}`))
	}))
	defer server.Close()
	ctx := WithMediaAdapterEndpointPolicy(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	for _, path := range []string{"/drop", "/credits"} {
		var result map[string]any
		err := doJSONRequestWithHeadersAndObservation(ctx, http.MethodPost, server.URL+path+"?token=private-query", "", map[string]any{"world_prompt": "private prompt"}, &result, map[string]string{"WLT-Api-Key": "private-credential"}, time.Second, AdapterWorldLabsNative)
		if err == nil {
			t.Fatal("failed provider request succeeded")
		}
	}
	text := logs.String()
	for _, want := range []string{"backend=worldlabs_world_adapter", "phase=awaiting_response", "failure_class=", "status=402"} {
		if !strings.Contains(text, want) {
			t.Fatalf("missing %q: %s", want, text)
		}
	}
	for _, secret := range []string{"private-query", "private prompt", "private-credential", "private provider body"} {
		if strings.Contains(text, secret) {
			t.Fatalf("sensitive provider diagnostic leaked %q", secret)
		}
	}
}

// A provider failure names how far the request got, the status and the
// provider's request ID, and never the credential, query or body.
func TestProviderHTTPObservationRecordsPhasesWithoutSecrets(t *testing.T) {
	const apiKey = "sk-test-credential-value" // pragma: allowlist secret
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/overloaded":
			w.Header().Set("x-request-id", "req_abc123")
			w.WriteHeader(529)
			_, _ = w.Write([]byte(`{"error":{"type":"overloaded_error","message":"secret body text"}}`))
		case "/v1/drop":
			connection, _, err := w.(http.Hijacker).Hijack()
			if err == nil {
				_ = connection.Close()
			}
		default:
			w.Header().Set("request-id", "req_ok_1")
			_, _ = w.Write([]byte(`{}`))
		}
	}))
	t.Cleanup(server.Close)
	logs := captureProviderLogs(t)
	backend := newBackend("cloud-test", server.URL, apiKey, nil, 5*time.Second, server.Client().Transport, false, true)

	send := func(ctx context.Context, path string) {
		t.Helper()
		request, err := backend.newRequest(ctx, http.MethodPost, server.URL+path+"?key="+apiKey, strings.NewReader(`{"prompt":"secret prompt"}`))
		if err != nil {
			t.Fatal(err)
		}
		if response, err := backend.do(request); err == nil {
			_ = response.Body.Close()
		}
	}
	send(context.Background(), "/v1/overloaded")
	send(context.Background(), "/v1/drop")
	send(context.Background(), "/v1/ok")
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	send(canceled, "/v1/ok")

	text := logs.String()
	for _, want := range []string{
		`msg="provider http error status" backend=cloud-test method=POST path=/v1/overloaded phase=response`,
		"status=529 request_id=req_abc123",
		`msg="provider http request failed" backend=cloud-test method=POST path=/v1/drop phase=awaiting_response`,
		`msg="provider http observation" backend=cloud-test method=POST path=/v1/ok phase=response`,
		"status=200 request_id=req_ok_1",
		`msg="provider http request canceled"`,
	} {
		if !strings.Contains(text, want) {
			t.Errorf("logs lack %q:\n%s", want, text)
		}
	}
	for _, secret := range []string{apiKey, "secret prompt", "secret body text", "key="} {
		if strings.Contains(text, secret) {
			t.Fatalf("logs contain %q:\n%s", secret, text)
		}
	}
	if strings.Count(text, "provider http request failed") != 1 {
		t.Fatalf("a caller cancellation was logged as a provider failure:\n%s", text)
	}
}

func TestEndpointResolutionFailureClassSeparatesDNSFromPolicy(t *testing.T) {
	for _, test := range []struct {
		err  error
		want string
	}{
		{&net.DNSError{Err: "timeout", Name: "api.example.com", IsTimeout: true}, "dns-timeout"},
		{&net.DNSError{Err: "no such host", Name: "api.example.com", IsNotFound: true}, "dns-not-found"},
		{&net.DNSError{Err: "server misbehaving", Name: "api.example.com"}, "dns"},
		{errors.New("endpointsec: no safe IP found"), "endpoint-policy"},
	} {
		if got := endpointResolutionFailureClass(test.err); got != test.want {
			t.Errorf("class(%v) = %q, want %q", test.err, got, test.want)
		}
	}
}
