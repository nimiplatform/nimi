package nimillm

import (
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/endpointsec"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
)

func TestNewSecuredBackendRejectsInsecureEndpoint(t *testing.T) {
	backend := NewSecuredBackend("cloud-openai", "http://example.com", "k", 3*time.Second, false)
	if backend != nil {
		t.Fatal("expected secured backend to reject non-loopback HTTP endpoint")
	}
}

func TestNewSecuredBackendAllowsLoopbackEndpoint(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": "ok",
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     1,
				"completion_tokens": 1,
			},
		})
	}))
	defer func() { server.Close() }()

	backend := NewSecuredBackend("cloud-openai", server.URL, "", 3*time.Second, true)
	if backend == nil {
		t.Fatal("expected secured backend to allow loopback endpoint with allowLoopback=true")
	}

	text, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{
		{Role: "user", Content: "hello"},
	}, "", 0, 0, 0, textGenParams{})
	if err != nil {
		t.Fatalf("generate text failed: %v", err)
	}
	if text != "ok" {
		t.Fatalf("unexpected text output: %q", text)
	}
}

func TestCloudProviderWithTargetLoopbackPolicy(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/chat/completions" {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []map[string]any{
				{
					"finish_reason": "stop",
					"message": map[string]any{
						"content": "loopback-target-ok",
					},
				},
			},
			"usage": map[string]any{
				"prompt_tokens":     2,
				"completion_tokens": 2,
			},
		})
	}))
	defer func() { server.Close() }()

	provider := NewCloudProvider(CloudConfig{
		Providers:               map[string]ProviderCredentials{},
		HTTPTimeout:             3 * time.Second,
		EnforceEndpointSecurity: true,
		AllowLoopbackEndpoint:   false,
	})

	req := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hello"}},
	}

	_, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", req, "hello", &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        server.URL,
		ProviderModelID: "gpt-4o-mini",
		AllowLoopback:   false,
	}, textwire.Directives{})
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN || status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected a typed endpoint rejection when loopback is disabled, got: %v", err)
	}

	text, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", req, "hello", &RemoteTarget{
		ProviderType:    "openai",
		Endpoint:        server.URL,
		ProviderModelID: "gpt-4o-mini",
		AllowLoopback:   true,
	}, textwire.Directives{})
	if err != nil {
		t.Fatalf("expected success with loopback allowed: %v", err)
	}
	if text != "loopback-target-ok" {
		t.Fatalf("unexpected target text: %q", text)
	}
}

func TestDoJSONRequestRejectsForbiddenEndpoint(t *testing.T) {
	err := DoJSONRequest(context.Background(), http.MethodGet, "http://example.com/v1/models", "", nil, nil)
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected failed precondition, got: %v", err)
	}
}

func TestCloudProviderReusedTemplateProbeValidatesCurrentAddressSetPerSend(t *testing.T) {
	type observedProbe struct {
		server     string
		remoteAddr string
		auth       string
		workspace  string
	}
	var mu sync.Mutex
	var observed []observedProbe
	record := func(name string, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		observed = append(observed, observedProbe{
			server:     name,
			remoteAddr: r.RemoteAddr,
			auth:       r.Header.Get("Authorization"),
			workspace:  r.Header.Get("X-DashScope-WorkSpace"),
		})
	}
	writeModels := func(w http.ResponseWriter) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"data":[]}`)
	}

	serverA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record("A", r)
		writeModels(w)
	}))
	defer serverA.Close()

	serverB := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		record("B", r)
		writeModels(w)
	}))
	defer serverB.Close()

	provider := NewCloudProvider(CloudConfig{
		Providers: map[string]ProviderCredentials{
			"openai": {
				BaseURL: serverA.URL,
				APIKey:  "cred-A",
				Headers: map[string]string{"X-DashScope-WorkSpace": "ws-A"},
			},
		},
		HTTPTimeout:             3 * time.Second,
		EnforceEndpointSecurity: true,
		AllowLoopbackEndpoint:   true,
	})

	template, _, err := provider.ResolveProbeBackend("openai", "", "", nil)
	if err != nil || template == nil {
		t.Fatalf("expected cached template backend: err=%v", err)
	}
	if same := template.WithRequestOverridesAndHeadersWithPolicy(serverA.URL, "cred-A", map[string]string{"X-DashScope-WorkSpace": "ws-A"}, true); same != template {
		t.Fatal("expected identical overrides to reuse template instance")
	}
	secured, ok := template.client.Transport.(*securedHTTPTransport)
	if !ok {
		t.Fatalf("expected secured backend transport *securedHTTPTransport, got %T", template.client.Transport)
	}

	var sendStep atomic.Int32
	pinnedTo := func(buildCtx context.Context, addr string) (*http.Transport, error) {
		tr, err := securedProviderTransport(buildCtx, "http://"+addr, true)
		if err != nil {
			return nil, err
		}
		tr.DialContext = func(dialCtx context.Context, network, _ string) (net.Conn, error) {
			return (&net.Dialer{Timeout: 3 * time.Second}).DialContext(dialCtx, network, addr)
		}
		return tr, nil
	}
	secured.buildTransport = func(buildCtx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error) {
		switch sendStep.Add(1) {
		case 1:
			return pinnedTo(buildCtx, serverA.Listener.Addr().String())
		case 2:
			// Simulate DNS rotating to serverB while the template backend is reused.
			return pinnedTo(buildCtx, serverB.Listener.Addr().String())
		default:
			// Simulate DNS rebinding to a forbidden link-local address before send #3.
			return securedProviderTransport(buildCtx, "http://169.254.169.254/v1/models", false)
		}
	}

	if err := provider.ProbeConnector(context.Background(), "openai", "", "", nil); err != nil {
		t.Fatalf("template probe #1 failed: %v", err)
	}
	if err := provider.ProbeConnector(context.Background(), "openai", "", "", nil); err != nil {
		t.Fatalf("template probe #2 after DNS rotation failed: %v", err)
	}
	err = provider.ProbeConnector(context.Background(), "openai", "", "", nil)
	if err == nil {
		t.Fatal("expected template probe #3 after DNS rebind to fail closed")
	}
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("expected FailedPrecondition on forbidden rebind, got code=%v err=%v", status.Code(err), err)
	}
	if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN {
		t.Fatalf("expected AI_PROVIDER_ENDPOINT_FORBIDDEN, got ok=%v reason=%v err=%v", ok, reason, err)
	}

	// Probe with a second Connector's endpoint/credential/workspace must stay isolated.
	if err := provider.ProbeConnector(context.Background(), "openai", serverB.URL, "cred-B", map[string]string{"X-DashScope-WorkSpace": "ws-B"}); err != nil {
		t.Fatalf("isolated connector probe #4 failed: %v", err)
	}

	mu.Lock()
	defer mu.Unlock()
	if len(observed) != 3 {
		t.Fatalf("expected 3 delivered probes (A, B rotated, B isolated; rebind blocked before dial), got %d: %+v", len(observed), observed)
	}
	if observed[0].server != "A" || observed[0].auth != "Bearer cred-A" || observed[0].workspace != "ws-A" {
		t.Fatalf("unexpected probe #1 observation: %+v", observed[0])
	}
	if observed[1].server != "B" || observed[1].auth != "Bearer cred-A" || observed[1].workspace != "ws-A" {
		t.Fatalf("expected probe #2 to dial rotated current address set (B) instead of stale A: %+v", observed[1])
	}
	if observed[2].server != "B" || observed[2].auth != "Bearer cred-B" || observed[2].workspace != "ws-B" {
		t.Fatalf("expected probe #4 to keep Connector B credentials/workspace isolated: %+v", observed[2])
	}
	if observed[0].remoteAddr == observed[1].remoteAddr || observed[1].remoteAddr == observed[2].remoteAddr {
		t.Fatalf("expected fresh non-pooled connections per send, got %+v", observed)
	}
}

func TestSecuredBackendPerSendPinningIdentityRedirectsAndJobGate(t *testing.T) {
	t.Run("PerSendPinningTLSIdentityAndHostValidation", func(t *testing.T) {
		var remoteAddrs []string
		var mu sync.Mutex
		var hits atomic.Int32
		tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			hits.Add(1)
			mu.Lock()
			remoteAddrs = append(remoteAddrs, r.RemoteAddr)
			mu.Unlock()
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"tls-ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		}))
		defer tlsServer.Close()

		parsedTLS, err := url.Parse(tlsServer.URL)
		if err != nil {
			t.Fatal(err)
		}
		baseTLS := tlsServer.Client().Transport.(*http.Transport).TLSClientConfig
		backend := NewSecuredBackendWithHeaders("cloud-openai", tlsServer.URL, "tls-cred", nil, 3*time.Second, true)
		if backend == nil {
			t.Fatal("expected secured HTTPS loopback backend")
		}
		secured, ok := backend.client.Transport.(*securedHTTPTransport)
		if !ok {
			t.Fatalf("expected *securedHTTPTransport, got %T", backend.client.Transport)
		}
		var verifiedServerNames []string
		var blockNext atomic.Bool
		secured.buildTransport = func(buildCtx context.Context, targetURL string, allowLoopback bool) (*http.Transport, error) {
			if blockNext.Load() {
				return securedProviderTransport(buildCtx, "https://169.254.169.254/v1/chat/completions", false)
			}
			pinned, err := endpointsec.NewPinnedTransport(buildCtx, targetURL, allowLoopback)
			if err != nil {
				return nil, err
			}
			if pinned.TLSClientConfig == nil || pinned.TLSClientConfig.ServerName != parsedTLS.Hostname() {
				t.Errorf("expected pinned TLS ServerName=%q, got %+v", parsedTLS.Hostname(), pinned.TLSClientConfig)
			}
			verifiedServerNames = append(verifiedServerNames, pinned.TLSClientConfig.ServerName)
			// Trust the local test CA while preserving the pinned ServerName and DialContext.
			pinned.TLSClientConfig.RootCAs = baseTLS.RootCAs
			return pinned, nil
		}

		for i := 0; i < 2; i++ {
			text, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{
				{Role: "user", Content: "ping"},
			}, "", 0, 0, 0, textGenParams{})
			if err != nil || text != "tls-ok" {
				t.Fatalf("HTTPS send #%d failed: text=%q err=%v", i+1, text, err)
			}
		}
		if len(verifiedServerNames) != 2 || len(remoteAddrs) != 2 || remoteAddrs[0] == remoteAddrs[1] {
			t.Fatalf("expected 2 fresh pinned TLS sends, serverNames=%v remoteAddrs=%v", verifiedServerNames, remoteAddrs)
		}

		// Mismatched HTTP Host must be rejected before dialing.
		spoofReq, err := backend.newRequest(context.Background(), http.MethodGet, tlsServer.URL+"/v1/models", nil)
		if err != nil {
			t.Fatal(err)
		}
		spoofReq.Host = "spoofed.example.com"
		if resp, err := backend.do(spoofReq); err == nil {
			_ = resp.Body.Close()
			t.Fatal("expected mismatched Host header to be rejected")
		}
		if hits.Load() != 2 {
			t.Fatalf("spoofed Host dialed server: hits=%d", hits.Load())
		}

		// Rebind before send #3 fails closed with AI_PROVIDER_ENDPOINT_FORBIDDEN.
		blockNext.Store(true)
		_, _, _, _, err = backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{
			{Role: "user", Content: "blocked"},
		}, "", 0, 0, 0, textGenParams{})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN || status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FailedPrecondition/AI_PROVIDER_ENDPOINT_FORBIDDEN on rebind, got code=%v reason=%v err=%v", status.Code(err), reason, err)
		}
		if hits.Load() != 2 {
			t.Fatalf("rebound send dialed stale address: hits=%d", hits.Load())
		}
	})

	t.Run("CrossOriginDecodeMediaStripsCredentialsAndBlocksForbiddenRedirect", func(t *testing.T) {
		var cdnHits atomic.Int32
		cdn := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			cdnHits.Add(1)
			if r.Header.Get("Authorization") != "" || r.Header.Get("X-DashScope-WorkSpace") != "" {
				t.Errorf("cross-origin media download leaked connector headers: auth=%q ws=%q", r.Header.Get("Authorization"), r.Header.Get("X-DashScope-WorkSpace"))
			}
			_, _ = io.WriteString(w, "png-bytes")
		}))
		defer cdn.Close()

		api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.Header.Get("Authorization") != "Bearer connector-secret" || r.Header.Get("X-DashScope-WorkSpace") != "ws-alpha" {
				t.Errorf("same-origin request lost connector headers: auth=%q ws=%q", r.Header.Get("Authorization"), r.Header.Get("X-DashScope-WorkSpace"))
			}
			switch r.URL.Path {
			case "/redir-cdn":
				http.Redirect(w, r, cdn.URL+"/from-redir.png", http.StatusFound)
			case "/redir-forbidden":
				http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusFound)
			default:
				http.NotFound(w, r)
			}
		}))
		defer api.Close()

		backend := NewSecuredBackendWithHeaders("cloud-openai", api.URL, "connector-secret", map[string]string{"X-DashScope-WorkSpace": "ws-alpha"}, 3*time.Second, true)
		if backend == nil {
			t.Fatal("expected secured backend")
		}

		// Direct cross-origin DecodeMedia pins actual CDN host and strips connector credentials.
		direct, err := backend.DecodeMedia(context.Background(), "", cdn.URL+"/direct.png")
		if err != nil || string(direct) != "png-bytes" {
			t.Fatalf("direct cross-origin DecodeMedia failed: body=%q err=%v", string(direct), err)
		}
		// Redirected cross-origin DecodeMedia keeps same-origin credentials on hop 1 and strips on hop 2.
		redirected, err := backend.DecodeMedia(context.Background(), "", api.URL+"/redir-cdn")
		if err != nil || string(redirected) != "png-bytes" {
			t.Fatalf("redirected cross-origin DecodeMedia failed: body=%q err=%v", string(redirected), err)
		}
		if cdnHits.Load() != 2 {
			t.Fatalf("expected 2 CDN hits, got %d", cdnHits.Load())
		}
		// Forbidden redirect fails closed with AI_PROVIDER_ENDPOINT_FORBIDDEN.
		_, err = backend.DecodeMedia(context.Background(), "", api.URL+"/redir-forbidden")
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN || status.Code(err) != codes.FailedPrecondition {
			t.Fatalf("expected FailedPrecondition/AI_PROVIDER_ENDPOINT_FORBIDDEN on forbidden redirect, got code=%v reason=%v err=%v", status.Code(err), reason, err)
		}
	})

	t.Run("PostDoesNotReplayOnRedirectOrMidFlightDrop", func(t *testing.T) {
		for _, mode := range []string{"redirect", "drop"} {
			t.Run(mode, func(t *testing.T) {
				var hits atomic.Int32
				server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					hits.Add(1)
					if mode == "redirect" {
						w.Header().Set("Location", "/redirected")
						w.WriteHeader(http.StatusTemporaryRedirect)
						return
					}
					if hijacker, ok := w.(http.Hijacker); ok {
						if conn, _, err := hijacker.Hijack(); err == nil {
							_ = conn.Close()
							return
						}
					}
					w.WriteHeader(http.StatusBadGateway)
				}))
				defer server.Close()

				backend := NewSecuredBackendWithHeaders("cloud-openai", server.URL, "cred", nil, 3*time.Second, true)
				if backend == nil {
					t.Fatal("expected secured backend")
				}
				_, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{
					{Role: "user", Content: "no-replay"},
				}, "", 0, 0, 0, textGenParams{})
				if err == nil {
					t.Fatalf("expected error in mode %s", mode)
				}
				if hits.Load() != 1 {
					t.Fatalf("mode %s replayed POST: hits=%d", mode, hits.Load())
				}
			})
		}
	})

	t.Run("JobOutboundGateCoexistsWithSecuredBackend", func(t *testing.T) {
		var serverHits atomic.Int32
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serverHits.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"choices":[{"finish_reason":"stop","message":{"content":"gated-ok"}}],"usage":{"prompt_tokens":1,"completion_tokens":1}}`)
		}))
		defer server.Close()

		backend := NewSecuredBackendWithHeaders("cloud-openai", server.URL, "cred", nil, 3*time.Second, true)
		if backend == nil {
			t.Fatal("expected secured backend")
		}

		var gateCalls atomic.Int32
		allowedCtx := WithOutboundGate(context.Background(), func(_ context.Context, begin func() error) error {
			gateCalls.Add(1)
			return begin()
		})
		text, _, _, _, err := backend.GenerateText(allowedCtx, "gpt-4o-mini", []*runtimev1.ChatMessage{
			{Role: "user", Content: "gated-allow"},
		}, "", 0, 0, 0, textGenParams{})
		if err != nil || text != "gated-ok" {
			t.Fatalf("expected gated secured backend call to succeed, text=%q err=%v", text, err)
		}
		if gateCalls.Load() != 1 || serverHits.Load() != 1 {
			t.Fatalf("expected gateCalls=1 serverHits=1, got gate=%d hits=%d", gateCalls.Load(), serverHits.Load())
		}

		revokedErr := grpcerr.WithReasonCode(codes.FailedPrecondition, runtimev1.ReasonCode_AI_CONNECTOR_DISABLED)
		revokedCtx := WithOutboundGate(context.Background(), func(_ context.Context, _ func() error) error {
			gateCalls.Add(1)
			return revokedErr
		})
		_, _, _, _, err = backend.GenerateText(revokedCtx, "gpt-4o-mini", []*runtimev1.ChatMessage{
			{Role: "user", Content: "gated-deny"},
		}, "", 0, 0, 0, textGenParams{})
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_CONNECTOR_DISABLED {
			t.Fatalf("expected AI_CONNECTOR_DISABLED on revoked gate, got ok=%v reason=%v err=%v", ok, reason, err)
		}
		if gateCalls.Load() != 2 || serverHits.Load() != 1 {
			t.Fatalf("revoked gate must not dial server: gate=%d hits=%d", gateCalls.Load(), serverHits.Load())
		}
	})
}
