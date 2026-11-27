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
		if err := response.Body.Close(); err != nil {
			t.Errorf("close response body: %v", err)
		}
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
			defer func() {
				if err := response.Body.Close(); err != nil {
					t.Errorf("close response body: %v", err)
				}
			}()
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
		if err := response.Body.Close(); err != nil {
			t.Errorf("close response body: %v", err)
		}
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
	if err := response.Body.Close(); err != nil {
		t.Errorf("close response body: %v", err)
	}
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

func TestSecuredHTTPDispatchesIsolateCredentialsWorkspacesAndConnectionsPerRequest(t *testing.T) {
	type observedReq struct {
		auth       string
		workspace  string
		remoteAddr string
		host       string
	}
	var observed []observedReq
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "" || r.Header.Get("X-DashScope-WorkSpace") != "" {
			t.Errorf("artifact redirect leaked credential or workspace: auth=%q ws=%q", r.Header.Get("Authorization"), r.Header.Get("X-DashScope-WorkSpace"))
		}
		_, _ = io.WriteString(w, "artifact-ok")
	}))
	defer target.Close()

	peer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect-artifact" {
			http.Redirect(w, r, target.URL+"/audio.wav", http.StatusFound)
			return
		}
		observed = append(observed, observedReq{
			auth:       r.Header.Get("Authorization"),
			workspace:  r.Header.Get("X-DashScope-WorkSpace"),
			remoteAddr: r.RemoteAddr,
			host:       r.Host,
		})
		_, _ = io.WriteString(w, "ok")
	}))
	defer peer.Close()

	ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	cases := []struct {
		auth      string
		workspace string
	}{
		{auth: "Bearer connector-a-key", workspace: "ws-alpha"},
		{auth: "Bearer connector-b-key", workspace: "ws-beta"},
		{auth: "Bearer connector-c-key", workspace: ""},
	}
	for _, tc := range cases {
		client, req, err := newSecuredHTTPRequest(ctx, http.MethodPost, peer.URL+"/api/v1/services/aigc/multimodal-generation/generation", nil)
		if err != nil {
			t.Fatalf("newSecuredHTTPRequest(%s): %v", tc.auth, err)
		}
		req.Header.Set("Authorization", tc.auth)
		if tc.workspace != "" {
			req.Header.Set("X-DashScope-WorkSpace", tc.workspace)
		}
		resp, err := client.Do(req)
		if err != nil {
			client.CloseIdleConnections()
			t.Fatalf("dispatch %s failed: %v", tc.auth, err)
		}
		_, _ = io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		client.CloseIdleConnections()
	}

	if len(observed) != 3 {
		t.Fatalf("observed requests = %d, want 3", len(observed))
	}
	for i, tc := range cases {
		if observed[i].auth != tc.auth || observed[i].workspace != tc.workspace {
			t.Fatalf("request %d leaked headers: got=%+v want auth=%q ws=%q", i, observed[i], tc.auth, tc.workspace)
		}
	}
	if observed[0].remoteAddr == observed[1].remoteAddr || observed[1].remoteAddr == observed[2].remoteAddr {
		t.Fatalf("expected fresh pinned transports per dispatch without cross-connector pooling: %+v", observed)
	}

	// Host header spoofing to a workspace hostname on a regional-validated transport is rejected.
	client, spoofedReq, err := newSecuredHTTPRequest(ctx, http.MethodPost, peer.URL+"/api/v1/services/aigc/multimodal-generation/generation", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer client.CloseIdleConnections()
	spoofedReq.Host = "ws-alpha.cn-beijing.maas.aliyuncs.com"
	if resp, err := client.Do(spoofedReq); err == nil {
		_ = resp.Body.Close()
		t.Fatal("expected mismatched Host header to be rejected")
	}

	// Cross-origin artifact redirect strips both Authorization and X-DashScope-WorkSpace.
	redirClient, redirReq, err := newSecuredHTTPRequest(ctx, http.MethodGet, peer.URL+"/redirect-artifact", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer redirClient.CloseIdleConnections()
	redirReq.Header.Set("Authorization", "Bearer connector-a-key")
	redirReq.Header.Set("X-DashScope-WorkSpace", "ws-alpha")
	redirResp, err := redirClient.Do(redirReq)
	if err != nil {
		t.Fatalf("artifact redirect failed: %v", err)
	}
	body, _ := io.ReadAll(redirResp.Body)
	_ = redirResp.Body.Close()
	if string(body) != "artifact-ok" {
		t.Fatalf("artifact redirect body = %q, want artifact-ok", string(body))
	}
}

func TestSecuredHTTPSameOriginSubsequentSendsAndRedirectsRevalidateCurrentAddressSet(t *testing.T) {
	var serverHits atomic.Int32
	var remoteAddrs []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		serverHits.Add(1)
		remoteAddrs = append(remoteAddrs, r.RemoteAddr)
		if r.Header.Get("Authorization") != "Bearer same-origin-token" {
			t.Errorf("same-origin credential missing on %s", r.URL.Path)
		}
		if r.URL.Path == "/redirect-start" {
			http.Redirect(w, r, "/redirect-same-origin", http.StatusFound)
			return
		}
		_, _ = io.WriteString(w, "ok:"+r.URL.Path)
	}))
	defer server.Close()

	// 1. Two subsequent same-origin sends on the SAME client MUST each re-validate
	//    the current destination address set AND use a fresh TCP connection; if DNS/policy
	//    changes to forbidden before send #3, send #3 fails closed without dialing stale IP.
	ctx := mediaAdapterEndpointPolicyContext(context.Background(), MediaAdapterConfig{AllowLoopbackEndpoint: true})
	client, err := newSecuredHTTPClient(ctx, server.URL, true)
	if err != nil {
		t.Fatalf("newSecuredHTTPClient: %v", err)
	}
	defer client.CloseIdleConnections()

	secured, ok := client.Transport.(*securedHTTPTransport)
	if !ok {
		t.Fatalf("expected *securedHTTPTransport, got %T", client.Transport)
	}
	var validations atomic.Int32
	var blockNext atomic.Bool
	rebindDenied := errors.New("dns rebound to forbidden link-local 169.254.169.254")
	secured.buildTransport = func(buildCtx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error) {
		validations.Add(1)
		if blockNext.Load() {
			return nil, rebindDenied
		}
		return securedProviderTransport(buildCtx, targetURL, allowLoopback)
	}

	for _, path := range []string{"/send-1", "/send-2"} {
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+path, nil)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Authorization", "Bearer same-origin-token")
		resp, err := client.Do(req)
		if err != nil {
			t.Fatalf("%s failed: %v", path, err)
		}
		body, _ := io.ReadAll(resp.Body)
		_ = resp.Body.Close()
		if string(body) != "ok:"+path {
			t.Fatalf("%s body = %q, want ok:%s", path, string(body), path)
		}
	}
	if validations.Load() != 2 || serverHits.Load() != 2 {
		t.Fatalf("expected 2 per-send destination validations and 2 hits, got validations=%d hits=%d", validations.Load(), serverHits.Load())
	}
	if len(remoteAddrs) != 2 || remoteAddrs[0] == remoteAddrs[1] {
		t.Fatalf("expected fresh TCP connections across subsequent same-origin sends, got %v", remoteAddrs)
	}

	// Simulate DNS/policy flipping to a forbidden address before send #3 on the same client.
	blockNext.Store(true)
	req3, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/send-3-blocked", nil)
	if err != nil {
		t.Fatal(err)
	}
	req3.Header.Set("Authorization", "Bearer same-origin-token")
	if resp, err := client.Do(req3); !errors.Is(err, rebindDenied) {
		if resp != nil {
			_ = resp.Body.Close()
		}
		t.Fatalf("expected same-origin send #3 to fail closed after DNS/policy drift, got err=%v", err)
	}
	if validations.Load() != 3 || serverHits.Load() != 2 {
		t.Fatalf("blocked send #3 must validate (3) without dialing stale IP (hits still 2): validations=%d hits=%d", validations.Load(), serverHits.Load())
	}

	// 2. Admitted same-origin GET redirect (/redirect-start -> /redirect-same-origin)
	//    MUST re-validate the destination address set before hop 2 AND fail closed if
	//    DNS/policy flips before hop 2, while succeeding with a fresh TCP conn when valid.
	for _, blockHop2 := range []bool{false, true} {
		t.Run(map[bool]string{false: "same-origin-redirect-allowed", true: "same-origin-redirect-rebound-blocked"}[blockHop2], func(t *testing.T) {
			remoteAddrs = nil
			serverHits.Store(0)
			validations.Store(0)
			blockNext.Store(false)

			rClient, err := newSecuredHTTPClient(ctx, server.URL+"/redirect-start", true)
			if err != nil {
				t.Fatal(err)
			}
			defer rClient.CloseIdleConnections()
			rTransport := rClient.Transport.(*securedHTTPTransport)
			rTransport.buildTransport = func(buildCtx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error) {
				n := validations.Add(1)
				if blockHop2 && n == 2 {
					return nil, rebindDenied
				}
				return securedProviderTransport(buildCtx, targetURL, allowLoopback)
			}

			req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/redirect-start", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set("Authorization", "Bearer same-origin-token")
			resp, err := rClient.Do(req)
			if blockHop2 {
				if !errors.Is(err, rebindDenied) {
					if resp != nil {
						_ = resp.Body.Close()
					}
					t.Fatalf("expected same-origin redirect hop 2 to fail closed on rebind, got err=%v", err)
				}
				if validations.Load() != 2 || serverHits.Load() != 1 {
					t.Fatalf("rebound same-origin redirect hop 2 must validate (2) without hitting server (1): validations=%d hits=%d", validations.Load(), serverHits.Load())
				}
				return
			}
			if err != nil {
				t.Fatalf("allowed same-origin redirect failed: %v", err)
			}
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if string(body) != "ok:/redirect-same-origin" {
				t.Fatalf("same-origin redirect body = %q", string(body))
			}
			if validations.Load() != 2 || serverHits.Load() != 2 {
				t.Fatalf("expected 2 validations and 2 hits across same-origin redirect, got validations=%d hits=%d", validations.Load(), serverHits.Load())
			}
			if len(remoteAddrs) != 2 || remoteAddrs[0] == remoteAddrs[1] {
				t.Fatalf("expected fresh TCP connection on same-origin redirect hop 2, got %v", remoteAddrs)
			}
		})
	}
}
