package nimillm

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
)

type endpointTestTransport func(*http.Request) (*http.Response, error)

func (f endpointTestTransport) RoundTrip(request *http.Request) (*http.Response, error) {
	return f(request)
}

func TestSecuredHTTPSameOriginPreservesCredentialsWithExplicitDefaultPort(t *testing.T) {
	for _, pair := range [][2]string{{"https://example.test", "https://EXAMPLE.test:443/path"}, {"http://[::1]", "http://[::1]:80/path"}} {
		origin, _ := url.Parse(pair[0])
		request, _ := http.NewRequest(http.MethodGet, pair[1], nil)
		request.Header.Set("Authorization", "Bearer original")
		called := false
		transport := &securedHTTPTransport{origin: origin, initial: endpointTestTransport(func(req *http.Request) (*http.Response, error) {
			called = true
			if req.Header.Get("Authorization") != "Bearer original" {
				t.Error("same-origin credential stripped")
			}
			return &http.Response{StatusCode: http.StatusOK, Body: io.NopCloser(strings.NewReader("same-origin"))}, nil
		})}
		response, err := transport.RoundTrip(request)
		if err != nil || !called {
			t.Fatalf("default-port alias treated as a new destination: %v", err)
		}
		response.Body.Close()
	}
}

func TestArtifactRedirectRevalidatesDestination(t *testing.T) {
	for _, target := range []string{"http://169.254.169.254/forbidden", "https://169.254.169.254/forbidden"} {
		t.Run(target, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				http.Redirect(w, r, target, http.StatusFound)
			}))
			defer server.Close()
			ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
			body, _, _, err := openBinaryArtifactStream(ctx, server.URL+"/original")
			if body != nil {
				_ = body.Close()
			}
			if err == nil || requests.Load() != 1 {
				t.Fatalf("forbidden redirect dispatched: count=%d err=%v", requests.Load(), err)
			}
		})
	}
}

func TestSecuredHTTPRedirectUsesNewPortAndCurrentGate(t *testing.T) {
	for _, denied := range []bool{false, true} {
		t.Run(map[bool]string{false: "allowed", true: "revoked"}[denied], func(t *testing.T) {
			var targetRequests, admissions atomic.Int32
			target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				targetRequests.Add(1)
				if r.Header.Get("Authorization") != "" || r.Header.Get("X-Api-Key") != "" {
					t.Error("original credential crossed authority")
				}
				if r.URL.Path != "/artifact" || r.Header.Get("Range") != "bytes=0-9" {
					t.Error("artifact request changed")
				}
				_, _ = io.WriteString(w, "from-target")
			}))
			defer target.Close()
			var original *httptest.Server
			original = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/first" {
					http.Redirect(w, r, "/same-origin", http.StatusFound)
					return
				}
				if r.Header.Get("Authorization") != "Bearer original" {
					t.Error("same-origin credential lost")
				}
				http.Redirect(w, r, target.URL+"/artifact", http.StatusFound)
			}))
			defer original.Close()
			refusal := errors.New("current admission revoked")
			ctx := WithOutboundGate(context.Background(), func(_ context.Context, begin func() error) error {
				if admissions.Add(1) == 3 && denied {
					return refusal
				}
				return begin()
			})
			ctx = mediaAdapterEndpointPolicyContext(ctx, MediaAdapterConfig{AllowLoopbackEndpoint: true})
			client, req, err := newSecuredHTTPRequest(ctx, http.MethodGet, original.URL+"/first", nil)
			if err != nil {
				t.Fatal(err)
			}
			defer client.CloseIdleConnections()
			req.Header.Set("Authorization", "Bearer original")
			req.Header.Set("X-Api-Key", "secret")
			req.Header.Set("Range", "bytes=0-9")
			response, err := client.Do(req)
			if denied {
				if !errors.Is(err, refusal) || targetRequests.Load() != 0 {
					t.Fatalf("redirect bypassed gate: %v", err)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			defer response.Body.Close()
			body, err := io.ReadAll(response.Body)
			if err != nil || string(body) != "from-target" || targetRequests.Load() != 1 || admissions.Load() != 3 {
				t.Fatalf("redirect result=%q requests=%d admissions=%d err=%v", body, targetRequests.Load(), admissions.Load(), err)
			}
		})
	}
}

func TestSecuredHTTPRejectsHostOverrideAndKeepsControlRedirectDisabled(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		http.Redirect(w, r, "/next", http.StatusFound)
	}))
	defer server.Close()
	ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	client, req, err := newSecuredHTTPRequest(originalControlRequest(ctx), http.MethodGet, server.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	req.Host = "different.example"
	if response, err := client.Do(req); err == nil {
		response.Body.Close()
		t.Fatal("Host override accepted")
	}
	if calls.Load() != 0 {
		t.Fatal("mismatched Host reached server")
	}
	req.Host = ""
	response, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusFound || calls.Load() != 1 {
		t.Fatal("control request followed redirect")
	}
}

func TestSecuredHTTPRedirectUsesDestinationTLS(t *testing.T) {
	// The redirect destination is a real TLS peer. Its untrusted certificate must be
	// rejected at the new target, rather than accepting an initial transport's
	// TLS configuration. No fixture disables certificate verification.
	target := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("untrusted TLS reached HTTP")
		w.WriteHeader(200)
	}))
	defer target.Close()
	original := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, target.URL, http.StatusFound) }))
	defer original.Close()
	ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	client, req, err := newSecuredHTTPRequest(ctx, http.MethodGet, original.URL, nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	_, err = client.Do(req)
	var requestErr *url.Error
	if !errors.As(err, &requestErr) || !strings.Contains(err.Error(), "certificate") {
		t.Fatalf("target TLS not verified: %v", err)
	}
}
