package nimillm

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/http/httptrace"
	"net/url"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"github.com/nimiplatform/nimi/runtime/internal/textwire"
)

type funcEndpointResolver func(ctx context.Context, host string) ([]string, error)

func (f funcEndpointResolver) LookupHost(ctx context.Context, host string) ([]string, error) {
	return f(ctx, host)
}

func generateTestTLSBundle(t testing.TB, dnsNames ...string) (*x509.CertPool, *x509.Certificate, tls.Certificate) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "nimi-d3-test-ca"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}
	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	caCert, err := x509.ParseCertificate(caDER)
	if err != nil {
		t.Fatal(err)
	}

	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	commonName := "localhost"
	if len(dnsNames) > 0 {
		commonName = dnsNames[0]
	}
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: commonName},
		DNSNames:     dnsNames,
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, caCert, &leafKey.PublicKey, caKey)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	pool.AddCert(caCert)
	return pool, caCert, tls.Certificate{
		Certificate: [][]byte{leafDER, caDER},
		PrivateKey:  leafKey,
	}
}

func writeOpenAIChatOK(w http.ResponseWriter, content string) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"choices": []map[string]any{
			{
				"finish_reason": "stop",
				"message":       map[string]any{"content": content},
			},
		},
		"usage": map[string]any{
			"prompt_tokens":     2,
			"completion_tokens": 3,
		},
	})
}

func writeOpenAIStreamOK(w http.ResponseWriter, content string) {
	w.Header().Set("Content-Type", "text/event-stream")
	flusher, _ := w.(http.Flusher)
	_, _ = fmt.Fprintf(w, "data: {\"choices\":[{\"delta\":{\"content\":%q},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":2,\"completion_tokens\":3}}\n\n", content)
	if flusher != nil {
		flusher.Flush()
	}
	_, _ = io.WriteString(w, "data: [DONE]\n\n")
}

func writeOpenAIEmbedOK(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"data": []map[string]any{
			{"index": 0, "embedding": []float64{0.25, 0.75}},
		},
		"usage": map[string]any{"prompt_tokens": 2, "total_tokens": 2},
	})
}

type tlsConnStats struct {
	newConns    atomic.Int32
	closedConns atomic.Int32
	requests    atomic.Int32
	mu          sync.Mutex
	remoteAddrs []string
	sniNames    []string
	protos      []string
}

func newTrackedTLSProviderServer(t testing.TB, dnsNames []string, handler http.HandlerFunc) (*httptest.Server, *x509.CertPool, *x509.Certificate, *tlsConnStats, string) {
	t.Helper()
	caPool, caCert, cert := generateTestTLSBundle(t, dnsNames...)
	stats := &tlsConnStats{}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		stats.requests.Add(1)
		stats.mu.Lock()
		stats.remoteAddrs = append(stats.remoteAddrs, r.RemoteAddr)
		if r.TLS != nil {
			stats.sniNames = append(stats.sniNames, r.TLS.ServerName)
		}
		stats.protos = append(stats.protos, r.Proto)
		stats.mu.Unlock()
		handler(w, r)
	}))
	server.EnableHTTP2 = true
	server.TLS = &tls.Config{
		Certificates: []tls.Certificate{cert},
		MinVersion:   tls.VersionTLS12,
	}
	server.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		switch state {
		case http.StateNew:
			stats.newConns.Add(1)
		case http.StateClosed:
			stats.closedConns.Add(1)
		}
	}
	server.StartTLS()
	_, port, err := net.SplitHostPort(server.Listener.Addr().String())
	if err != nil {
		server.Close()
		t.Fatal(err)
	}
	return server, caPool, caCert, stats, port
}

// TestCloudOutboundPoolReusesTLSConnectionForIdenticalBoundary proves that
// consecutive target-bound CloudProvider POST dispatches (sync text, stream
// text, and embeddings) with the exact same destination, TLS identity,
// Connector, workspace, and credential reuse a single HTTP/1.1 TCP+TLS
// connection (1 handshake vs N handshakes on the one-shot baseline).
//
// Scope of proof: this controlled local loopback TLS test proves exact
// connection reuse, HTTP/1.1 ALPN pinning, TLS handshake elimination, and
// controlled local TLS latency reduction. Real internet net RTT/P95 savings
// against live cloud providers remain NOT-VERIFIED without live provider auth.
func TestCloudOutboundPoolReusesTLSConnectionForIdenticalBoundary(t *testing.T) {
	const host = "api.openai.test"
	const requestCount = 10

	server, caPool, _, stats, port := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/chat/completions":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if stream, _ := body["stream"].(bool); stream {
				writeOpenAIStreamOK(w, "stream-ok")
				return
			}
			writeOpenAIChatOK(w, "sync-ok")
		case "/v1/embeddings":
			writeOpenAIEmbedOK(w)
		default:
			http.NotFound(w, r)
		}
	})
	defer server.Close()

	provider := NewCloudProvider(CloudConfig{
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	})
	defer provider.CloseIdleConnections()
	provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, lookupHost string) ([]string, error) {
		if strings.EqualFold(lookupHost, host) {
			return []string{"127.0.0.1"}, nil
		}
		return nil, fmt.Errorf("unexpected host %q", lookupHost)
	})
	provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
		return caPool, "test-ca-primary"
	}

	target := &RemoteTarget{
		ProviderType:    "openai",
		ConnectorID:     "conn-alpha",
		Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
		APIKey:          "sk-alpha-secret",
		Headers:         map[string]string{"OpenAI-Organization": "org-alpha"},
		ProviderModelID: "gpt-4o-mini",
		AllowLoopback:   true,
	}
	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "ping"}},
	}

	var reusedCount, tlsHandshakes atomic.Int32
	tracedCtx := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
		GotConn: func(info httptrace.GotConnInfo) {
			if info.Reused {
				reusedCount.Add(1)
			}
		},
		TLSHandshakeStart: func() {
			tlsHandshakes.Add(1)
		},
	})

	var pooledTotal time.Duration
	var coldDuration time.Duration
	for i := 0; i < requestCount; i++ {
		start := time.Now()
		text, _, _, _, err := provider.GenerateTextScenarioWithTarget(tracedCtx, "gpt-4o-mini", spec, "", target, textwire.Directives{})
		elapsed := time.Since(start)
		if err != nil || text != "sync-ok" {
			t.Fatalf("pooled sync request #%d failed: text=%q err=%v", i+1, text, err)
		}
		if i == 0 {
			coldDuration = elapsed
		}
		pooledTotal += elapsed
	}

	// Stream text and batched embeddings on the exact same boundary must also reuse the warm TLS connection.
	var streamed strings.Builder
	_, _, err := provider.StreamGenerateTextScenarioWithTarget(tracedCtx, "gpt-4o-mini", spec, func(part string) error {
		streamed.WriteString(part)
		return nil
	}, target, textwire.Directives{})
	if err != nil || streamed.String() != "stream-ok" {
		t.Fatalf("pooled stream request failed: text=%q err=%v", streamed.String(), err)
	}
	vectors, _, err := provider.EmbedWithTarget(tracedCtx, "gpt-4o-mini", []string{"hello"}, nil, capabilitydriver.CloudEmbedProtocolCompatibleV1, runtimev1.TextEmbedPurpose_TEXT_EMBED_PURPOSE_UNSPECIFIED, target)
	if err != nil || len(vectors) != 1 {
		t.Fatalf("pooled embed request failed: len=%d err=%v", len(vectors), err)
	}

	totalRequests := int32(requestCount + 2)
	if stats.requests.Load() != totalRequests {
		t.Fatalf("server requests = %d, want %d", stats.requests.Load(), totalRequests)
	}
	if stats.newConns.Load() != 1 {
		t.Fatalf("expected exactly 1 TCP+TLS connection across %d requests, got %d", totalRequests, stats.newConns.Load())
	}
	if tlsHandshakes.Load() != 1 {
		t.Fatalf("expected exactly 1 TLS handshake across %d requests, got %d", totalRequests, tlsHandshakes.Load())
	}
	if reusedCount.Load() != totalRequests-1 {
		t.Fatalf("expected %d reused connections, got %d", totalRequests-1, reusedCount.Load())
	}
	stats.mu.Lock()
	for i, sni := range stats.sniNames {
		if sni != host {
			t.Fatalf("request %d SNI = %q, want %q", i, sni, host)
		}
	}
	for i, proto := range stats.protos {
		if proto != "HTTP/1.1" {
			t.Fatalf("request %d negotiated %q, want HTTP/1.1 (no HTTP/2 pool)", i, proto)
		}
	}
	stats.mu.Unlock()

	// Compare against one-shot baseline (no pool) on the same local TLS server.
	baselineServer, baselineCA, _, baselineStats, baselinePort := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "oneshot-ok")
	})
	defer baselineServer.Close()

	var oneShotHandshakes atomic.Int32
	oneShotTrace := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
		TLSHandshakeStart: func() { oneShotHandshakes.Add(1) },
	})
	oneShotURL := "https://" + net.JoinHostPort(host, baselinePort) + "/v1"
	origin := mustParseURL(t, oneShotURL)
	oneShotBackend := newBackend("cloud-openai", oneShotURL, "sk-alpha-secret", nil, 5*time.Second, &securedHTTPTransport{
		origin:        origin,
		allowLoopback: true,
		buildTransport: func(ctx context.Context, _ string, _ bool) (*http.Transport, error) {
			protocols := new(http.Protocols)
			protocols.SetHTTP1(true)
			return &http.Transport{
				Protocols: protocols,
				DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
					return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(dialCtx, network, net.JoinHostPort("127.0.0.1", baselinePort))
				},
				TLSClientConfig: &tls.Config{
					MinVersion: tls.VersionTLS12,
					ServerName: host,
					RootCAs:    baselineCA,
					NextProtos: []string{"http/1.1"},
				},
			}, nil
		},
	}, true, true)

	var oneShotTotal time.Duration
	for i := 0; i < requestCount; i++ {
		start := time.Now()
		text, _, _, _, err := oneShotBackend.GenerateText(oneShotTrace, "gpt-4o-mini", spec.GetInput(), "", 0, 0, 0, textGenParams{})
		if err != nil || text != "oneshot-ok" {
			t.Fatalf("one-shot request #%d failed: text=%q err=%v", i+1, text, err)
		}
		oneShotTotal += time.Since(start)
	}
	if baselineStats.newConns.Load() != requestCount || oneShotHandshakes.Load() != requestCount {
		t.Fatalf("one-shot baseline expected %d conns/handshakes, got conns=%d handshakes=%d",
			requestCount, baselineStats.newConns.Load(), oneShotHandshakes.Load())
	}

	t.Logf("controlled local TLS (%d requests): pooled conns=%d handshakes=%d cold=%v total=%v | one-shot conns=%d handshakes=%d total=%v",
		requestCount, stats.newConns.Load(), tlsHandshakes.Load(), coldDuration, pooledTotal,
		baselineStats.newConns.Load(), oneShotHandshakes.Load(), oneShotTotal)
}

// TestCloudOutboundPoolIsolatesEverySecurityBoundary verifies that two requests
// NEVER share a connection when ANY security-relevant boundary differs:
// connector ID, API credential, workspace header, org header, host/SNI, port,
// TLS profile, scheme, or pinned peer IP.
func TestCloudOutboundPoolIsolatesEverySecurityBoundary(t *testing.T) {
	const hostA = "alpha.provider.test"
	const hostB = "beta.provider.test"

	serverA, caPoolA, _, statsA, portA := newTrackedTLSProviderServer(t, []string{hostA, hostB}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "ok-a")
	})
	defer serverA.Close()

	serverB, caPoolB, _, statsB, portB := newTrackedTLSProviderServer(t, []string{hostA}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "ok-b")
	})
	defer serverB.Close()

	httpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "ok-http")
	}))
	defer httpServer.Close()

	var currentTLSProfile atomic.Value
	currentTLSProfile.Store("ca-profile-1")

	provider := NewCloudProvider(CloudConfig{
		HTTPTimeout:           5 * time.Second,
		AllowLoopbackEndpoint: true,
	})
	defer provider.CloseIdleConnections()
	provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, lookupHost string) ([]string, error) {
		switch strings.ToLower(lookupHost) {
		case hostA, hostB, "127.0.0.1", "localhost":
			return []string{"127.0.0.1"}, nil
		default:
			return nil, fmt.Errorf("unexpected host %q", lookupHost)
		}
	})
	provider.connPool.tlsConfigForOrigin = func(_, _, port string) (*x509.CertPool, string) {
		if port == portB {
			return caPoolB, "ca-server-b"
		}
		profile := currentTLSProfile.Load().(string)
		return caPoolA, profile
	}

	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "isolate"}},
	}
	send := func(name string, target *RemoteTarget) (reused bool) {
		t.Helper()
		ctx := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
			GotConn: func(info httptrace.GotConnInfo) { reused = info.Reused },
		})
		_, _, _, _, err := provider.GenerateTextScenarioWithTarget(ctx, "gpt-4o-mini", spec, "", target, textwire.Directives{})
		if err != nil {
			t.Fatalf("%s failed: %v", name, err)
		}
		return reused
	}

	baseURL := "https://" + net.JoinHostPort(hostA, portA) + "/v1"
	baseTarget := &RemoteTarget{
		ProviderType:    "openai",
		ConnectorID:     "conn-1",
		Endpoint:        baseURL,
		APIKey:          "key-1",
		Headers:         map[string]string{"X-DashScope-WorkSpace": "ws-1"},
		ProviderModelID: "gpt-4o-mini",
		AllowLoopback:   true,
	}

	// 1. Prime base target (cold) and confirm identical target reuses it.
	if send("base-cold", baseTarget) {
		t.Fatal("cold base request unexpectedly reused a connection")
	}
	if !send("base-warm", baseTarget) {
		t.Fatal("identical boundary failed to reuse warm connection")
	}

	// 2. Different ConnectorID (even with identical endpoint, key, workspace).
	diffConnector := *baseTarget
	diffConnector.ConnectorID = "conn-2"
	if send("diff-connector", &diffConnector) {
		t.Fatal("different ConnectorID shared a connection")
	}

	// 3. Different credential (APIKey) on same ConnectorID.
	diffKey := *baseTarget
	diffKey.APIKey = "key-2"
	if send("diff-key", &diffKey) {
		t.Fatal("different API credential shared a connection")
	}

	// 4. Different workspace header on same ConnectorID and key.
	diffWorkspace := *baseTarget
	diffWorkspace.Headers = map[string]string{"X-DashScope-WorkSpace": "ws-2"}
	if send("diff-workspace", &diffWorkspace) {
		t.Fatal("different workspace header shared a connection")
	}

	// 5. Empty workspace header vs non-empty workspace header.
	noWorkspace := *baseTarget
	noWorkspace.Headers = nil
	if send("no-workspace", &noWorkspace) {
		t.Fatal("missing workspace header shared a connection with workspace-scoped connection")
	}

	// 6. Different organization header.
	diffOrg := *baseTarget
	diffOrg.Headers = map[string]string{"X-DashScope-WorkSpace": "ws-1", "OpenAI-Organization": "org-b"}
	if send("diff-org", &diffOrg) {
		t.Fatal("different organization header shared a connection")
	}

	// 7. Different hostname/SNI resolving to the EXACT same peer IP and port (r035).
	diffHost := *baseTarget
	diffHost.Endpoint = "https://" + net.JoinHostPort(hostB, portA) + "/v1"
	if send("diff-host", &diffHost) {
		t.Fatal("different hostname/SNI shared a connection on same peer IP")
	}

	// 8. Different TLS profile on the same host/port/connector/key.
	currentTLSProfile.Store("ca-profile-2")
	if send("diff-tls-profile", baseTarget) {
		t.Fatal("different TLS config profile shared a connection")
	}

	// 9. Different port on the same hostname.
	diffPort := *baseTarget
	diffPort.Endpoint = "https://" + net.JoinHostPort(hostA, portB) + "/v1"
	if send("diff-port", &diffPort) {
		t.Fatal("different port shared a connection")
	}
	if statsB.newConns.Load() != 1 {
		t.Fatalf("serverB newConns = %d, want 1", statsB.newConns.Load())
	}

	// 10. Different scheme (http vs https).
	httpTarget := *baseTarget
	httpTarget.Endpoint = httpServer.URL + "/v1"
	if send("diff-scheme-http", &httpTarget) {
		t.Fatal("http scheme shared a connection with https")
	}

	// Server A received: base (1 conn, 2 reqs) + 7 distinct boundaries = 8 distinct TCP+TLS conns.
	if got := statsA.newConns.Load(); got != 8 {
		t.Fatalf("serverA newConns = %d, want 8 distinct isolated connections", got)
	}

	// Verify unique remote addresses across the distinct boundaries on serverA.
	statsA.mu.Lock()
	uniqueAddrs := make(map[string]struct{})
	for _, addr := range statsA.remoteAddrs {
		uniqueAddrs[addr] = struct{}{}
	}
	statsA.mu.Unlock()
	if len(uniqueAddrs) != 8 {
		t.Fatalf("expected 8 unique client TCP endpoints on serverA, got %d", len(uniqueAddrs))
	}
}

// TestCloudOutboundPoolNeverReplaysNonIdempotentPostOnBrokenIdleConnection
// verifies Go stdlib's isReplayable hazard (Idempotency-Key + GetBody) and
// proves our pooled HTTP/1.1 transport NEVER silently replays a dispatched POST
// on a dropped/broken reused connection, both with and without Idempotency-Key
// or X-Idempotency-Key headers.
func TestCloudOutboundPoolNeverReplaysNonIdempotentPostOnBrokenIdleConnection(t *testing.T) {
	// First prove the Go stdlib hazard that our guard defends against: raw
	// http.Transport WILL replay a POST with bytes.NewReader (non-nil GetBody)
	// and Idempotency-Key when the server drops a reused keep-alive connection.
	t.Run("GoStdlibHazardControlWithoutGuard", func(t *testing.T) {
		var postHits atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/prime" {
				_, _ = io.WriteString(w, "ok")
				return
			}
			hit := postHits.Add(1)
			_, _ = io.Copy(io.Discard, r.Body)
			if hit == 1 {
				conn, _, err := w.(http.Hijacker).Hijack()
				if err == nil {
					_ = conn.Close()
				}
				return
			}
			_, _ = io.WriteString(w, "replayed")
		}))
		defer srv.Close()

		tr := &http.Transport{MaxIdleConnsPerHost: 2}
		defer tr.CloseIdleConnections()
		client := &http.Client{Transport: tr}

		prime, err := client.Get(srv.URL + "/prime")
		if err != nil {
			t.Fatal(err)
		}
		_, _ = io.Copy(io.Discard, prime.Body)
		_ = prime.Body.Close()

		req, _ := http.NewRequest(http.MethodPost, srv.URL+"/create", bytes.NewReader([]byte(`{"op":"bill"}`)))
		req.Header.Set("Idempotency-Key", "idem-1")
		resp, err := client.Do(req)
		if resp != nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
		if err != nil || postHits.Load() != 2 {
			t.Fatalf("expected raw Go http.Transport with GetBody+Idempotency-Key to replay (hits=2), got hits=%d err=%v", postHits.Load(), err)
		}
	})

	// Now prove our bounded CloudProvider pool NEVER replays on any header mode.
	for _, tc := range []struct {
		name    string
		headers map[string]string
	}{
		{name: "no-idempotency-header", headers: nil},
		{name: "with-Idempotency-Key", headers: map[string]string{"Idempotency-Key": "idem-post-1"}},
		{name: "with-X-Idempotency-Key", headers: map[string]string{"X-Idempotency-Key": "x-idem-post-1"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			const host = "replay-guard.provider.test"
			var postCount atomic.Int32
			server, caPool, _, stats, port := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
				n := postCount.Add(1)
				_, _ = io.Copy(io.Discard, r.Body)
				if n == 1 {
					writeOpenAIChatOK(w, "primed")
					return
				}
				// Request #2 arrived on the reused TLS connection: read request, then
				// abruptly drop the socket without replying (uncertain dispatch!).
				conn, _, err := w.(http.Hijacker).Hijack()
				if err != nil {
					t.Errorf("hijack failed: %v", err)
					return
				}
				_ = conn.Close()
			})
			defer server.Close()

			provider := NewCloudProvider(CloudConfig{
				HTTPTimeout:           5 * time.Second,
				AllowLoopbackEndpoint: true,
			})
			defer provider.CloseIdleConnections()
			provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
				return []string{"127.0.0.1"}, nil
			})
			provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
				return caPool, "replay-ca"
			}

			target := &RemoteTarget{
				ProviderType:    "openai",
				ConnectorID:     "conn-replay",
				Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
				APIKey:          "sk-replay",
				Headers:         tc.headers,
				ProviderModelID: "gpt-4o-mini",
				AllowLoopback:   true,
			}
			spec := &runtimev1.TextGenerateScenarioSpec{
				Input: []*runtimev1.ChatMessage{{Role: "user", Content: "charge once"}},
			}

			// Request #1 primes the warm TLS connection.
			text, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
			if err != nil || text != "primed" {
				t.Fatalf("prime request failed: text=%q err=%v", text, err)
			}

			// Request #2 reuses that warm TLS connection and is dropped after receipt.
			var reusedSecond atomic.Bool
			traceCtx := httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{
				GotConn: func(info httptrace.GotConnInfo) {
					if info.Reused {
						reusedSecond.Store(true)
					}
				},
			})
			_, _, _, _, err = provider.GenerateTextScenarioWithTarget(traceCtx, "gpt-4o-mini", spec, "", target, textwire.Directives{})
			if err == nil {
				t.Fatal("dropped uncertain POST unexpectedly succeeded")
			}
			if !reusedSecond.Load() {
				t.Fatal("request #2 did not exercise the reused connection path")
			}
			if postCount.Load() != 2 {
				t.Fatalf("uncertain POST was silently replayed! total server POSTs=%d (want 2: 1 prime + 1 failed)", postCount.Load())
			}
			if stats.newConns.Load() != 1 {
				t.Fatalf("replay attempt opened a second connection: newConns=%d, want 1", stats.newConns.Load())
			}
		})
	}
}

// TestCloudOutboundPoolRecoversCleanlyAfterIdleServerClose proves that when a
// server gracefully closes an idle connection before the next request starts,
// the next request dials a fresh connection cleanly without duplicate delivery.
func TestCloudOutboundPoolRecoversCleanlyAfterIdleServerClose(t *testing.T) {
	const host = "idle-close.provider.test"
	var mu sync.Mutex
	var serverConns []net.Conn
	server, caPool, _, stats, port := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "ok")
	})
	baseConnState := server.Config.ConnState
	server.Config.ConnState = func(c net.Conn, s http.ConnState) {
		if baseConnState != nil {
			baseConnState(c, s)
		}
		if s == http.StateIdle {
			mu.Lock()
			serverConns = append(serverConns, c)
			mu.Unlock()
		}
	}
	defer server.Close()

	provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
	defer provider.CloseIdleConnections()
	provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
		return []string{"127.0.0.1"}, nil
	})
	provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
		return caPool, "idle-ca"
	}

	target := &RemoteTarget{
		ProviderType:    "openai",
		ConnectorID:     "conn-idle",
		Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
		APIKey:          "sk-idle",
		ProviderModelID: "gpt-4o-mini",
		AllowLoopback:   true,
	}
	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}

	if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{}); err != nil {
		t.Fatalf("request #1 failed: %v", err)
	}
	// Close the idle socket from the server side and give client readLoop a moment to observe FIN.
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		n := len(serverConns)
		mu.Unlock()
		if n > 0 {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	for _, c := range serverConns {
		_ = c.Close()
	}
	mu.Unlock()
	time.Sleep(50 * time.Millisecond)

	text, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
	if err != nil || text != "ok" {
		t.Fatalf("request #2 after server idle close failed: text=%q err=%v", text, err)
	}
	if stats.requests.Load() != 2 || stats.newConns.Load() != 2 {
		t.Fatalf("expected 2 requests on 2 connections, got requests=%d conns=%d", stats.requests.Load(), stats.newConns.Load())
	}
}

// TestCloudOutboundPoolEnforcesSSRFRebindingRotationHostAndRedirectGuards proves
// that per-request DNS/SSRF validation, DNS IP rotation, multi-IP failover,
// TLS certificate verification, Host header integrity, redirect blocking, and
// OutboundGate fencing remain 100% intact with pooled reuse enabled.
func TestCloudOutboundPoolEnforcesSSRFRebindingRotationHostAndRedirectGuards(t *testing.T) {
	t.Run("DNSRebindingBlocksReuseAndEvictsStalePoolEntry", func(t *testing.T) {
		const host = "rebind.provider.test"
		server, caPool, _, stats, port := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
			writeOpenAIChatOK(w, "ok")
		})
		defer server.Close()

		for _, forbiddenIP := range []string{"169.254.169.254", "fe80::1", "fc00::1", "0.0.0.0"} {
			t.Run(forbiddenIP, func(t *testing.T) {
				var resolvedIP atomic.Value
				resolvedIP.Store([]string{"127.0.0.1"})

				provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
				defer provider.CloseIdleConnections()
				provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
					return resolvedIP.Load().([]string), nil
				})
				provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
					return caPool, "rebind-ca"
				}

				target := &RemoteTarget{
					ProviderType:    "openai",
					ConnectorID:     "conn-rebind",
					Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
					APIKey:          "sk-rebind",
					ProviderModelID: "gpt-4o-mini",
					AllowLoopback:   true,
				}
				// Hold one resolved Backend across sends to test RoundTrip-level revalidation directly!
				backend, _ := provider.resolveBackendForTarget("gpt-4o-mini", target)
				if backend == nil {
					t.Fatal("expected backend before rebind")
				}
				hitsBefore := stats.requests.Load()
				if _, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{{Role: "user", Content: "warm"}}, "", 0, 0, 0, textGenParams{}); err != nil {
					t.Fatalf("warm request failed: %v", err)
				}
				if provider.connPool.entryCount() != 1 {
					t.Fatalf("expected 1 pooled entry after warm request, got %d", provider.connPool.entryCount())
				}

				// DNS now rebinds to forbidden IP.
				resolvedIP.Store([]string{forbiddenIP})
				_, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", []*runtimev1.ChatMessage{{Role: "user", Content: "blocked"}}, "", 0, 0, 0, textGenParams{})
				if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_PROVIDER_ENDPOINT_FORBIDDEN || status.Code(err) != codes.FailedPrecondition {
					t.Fatalf("rebind to %s did not fail closed with AI_PROVIDER_ENDPOINT_FORBIDDEN: code=%v reason=%v err=%v", forbiddenIP, status.Code(err), reason, err)
				}
				if stats.requests.Load() != hitsBefore+1 {
					t.Fatalf("rebound request hit stale pooled peer! hits=%d want %d", stats.requests.Load(), hitsBefore+1)
				}
				if provider.connPool.entryCount() != 0 {
					t.Fatalf("rebound origin idle entry was not evicted: entries=%d", provider.connPool.entryCount())
				}
			})
		}
	})

	t.Run("DNSRotationRefusesStalePeerIPAndMultiIPFailoverPinsActualPeer", func(t *testing.T) {
		const host = "rotate.provider.test"
		server1, _, caCert1, stats1, port1 := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
			writeOpenAIChatOK(w, "from-peer-1")
		})
		defer server1.Close()

		server2, _, caCert2, stats2, port2 := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
			writeOpenAIChatOK(w, "from-peer-2")
		})
		defer server2.Close()

		// Trust both test CAs under the same profile so TLS verification still runs cleanly across rotated peers.
		combinedCA := x509.NewCertPool()
		combinedCA.AddCert(caCert1)
		combinedCA.AddCert(caCert2)

		// Use synthetic public-range IPs mapped by dialFn to server1 / server2 to simulate real multi-IP failover and DNS IP rotation.
		const ipDead = "203.0.113.1"
		const ipPeer1 = "203.0.113.10"
		const ipPeer2 = "203.0.113.20"

		var currentIPs atomic.Value
		currentIPs.Store([]string{ipDead, ipPeer1})

		var dialedMu sync.Mutex
		var dialedTargets []string

		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: false})
		defer provider.CloseIdleConnections()
		provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
			return currentIPs.Load().([]string), nil
		})
		provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
			return combinedCA, "combined-ca"
		}
		baseDialer := &net.Dialer{Timeout: 3 * time.Second}
		provider.connPool.dialFn = func(ctx context.Context, network, addr string) (net.Conn, error) {
			dialedMu.Lock()
			dialedTargets = append(dialedTargets, addr)
			dialedMu.Unlock()
			ip, _, _ := net.SplitHostPort(addr)
			switch ip {
			case ipDead:
				return nil, errors.New("simulated unreachable IP")
			case ipPeer1:
				return baseDialer.DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port1))
			case ipPeer2:
				return baseDialer.DialContext(ctx, network, net.JoinHostPort("127.0.0.1", port2))
			default:
				return nil, fmt.Errorf("unexpected dial IP %s", ip)
			}
		}

		target := &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     "conn-rotate",
			Endpoint:        "https://" + host + "/v1",
			APIKey:          "sk-rotate",
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   false,
		}
		spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}

		// 1. Cold multi-IP failover: ipDead fails -> connects to ipPeer1 and pins ipPeer1.
		text, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
		if err != nil || text != "from-peer-1" {
			t.Fatalf("failover send #1 failed: text=%q err=%v", text, err)
		}

		// 2. DNS returns shuffled set still containing ipPeer1 ([ipPeer2, ipPeer1]) -> reuses pinned ipPeer1!
		currentIPs.Store([]string{ipPeer2, ipPeer1})
		text, _, _, _, err = provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
		if err != nil || text != "from-peer-1" {
			t.Fatalf("warm send #2 with ipPeer1 still validated failed: text=%q err=%v", text, err)
		}
		if stats1.newConns.Load() != 1 || stats1.requests.Load() != 2 {
			t.Fatalf("expected peer1 reuse (1 conn, 2 reqs), got conns=%d reqs=%d", stats1.newConns.Load(), stats1.requests.Load())
		}

		// 3. DNS rotates completely to [ipPeer2] (ipPeer1 removed from validated set) -> MUST refuse ipPeer1 reuse and dial ipPeer2!
		currentIPs.Store([]string{ipPeer2})
		text, _, _, _, err = provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
		if err != nil || text != "from-peer-2" {
			t.Fatalf("rotated send #3 failed: text=%q err=%v", text, err)
		}
		if stats2.newConns.Load() != 1 || stats2.requests.Load() != 1 {
			t.Fatalf("expected rotated send #3 on peer2, got conns=%d reqs=%d", stats2.newConns.Load(), stats2.requests.Load())
		}
		if stats1.requests.Load() != 2 {
			t.Fatalf("stale peer1 received request after rotation: reqs=%d", stats1.requests.Load())
		}

		// 4. Loopback IP returned when AllowLoopback=false must fail closed without reusing peer2!
		currentIPs.Store([]string{"127.0.0.1"})
		_, _, _, _, err = provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{})
		if err == nil {
			t.Fatal("expected loopback IP with AllowLoopback=false to be rejected")
		}
		if stats2.requests.Load() != 1 {
			t.Fatalf("rejected loopback lookup reused peer2: reqs=%d", stats2.requests.Load())
		}
	})

	t.Run("WrongTLSCertificateAndHostSpoofingAndRedirectRejected", func(t *testing.T) {
		const targetHost = "api.openai.test"
		const wrongHost = "wrong.other.test"
		wrongServer, wrongCA, _, wrongStats, wrongPort := newTrackedTLSProviderServer(t, []string{wrongHost}, func(w http.ResponseWriter, r *http.Request) {
			writeOpenAIChatOK(w, "should-not-succeed")
		})
		defer wrongServer.Close()

		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
		defer provider.CloseIdleConnections()
		provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
			return []string{"127.0.0.1"}, nil
		})
		provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
			return wrongCA, "wrong-ca"
		}

		target := &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     "conn-tls",
			Endpoint:        "https://" + net.JoinHostPort(targetHost, wrongPort) + "/v1",
			APIKey:          "sk-tls",
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   true,
		}
		spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}
		if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{}); err == nil {
			t.Fatal("expected TLS certificate hostname mismatch to fail closed")
		}
		if wrongStats.requests.Load() != 0 {
			t.Fatalf("TLS mismatch reached HTTP handler: hits=%d", wrongStats.requests.Load())
		}

		// Host header spoofing must fail before pool lookup or dial.
		okServer, okCA, _, okStats, okPort := newTrackedTLSProviderServer(t, []string{targetHost}, func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/v1/redirect-post" {
				http.Redirect(w, r, "http://169.254.169.254/latest/meta-data", http.StatusTemporaryRedirect)
				return
			}
			writeOpenAIChatOK(w, "ok")
		})
		defer okServer.Close()

		provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
			return okCA, "ok-ca"
		}
		okTarget := *target
		okTarget.Endpoint = "https://" + net.JoinHostPort(targetHost, okPort) + "/v1"
		backend, _ := provider.resolveBackendForTarget("gpt-4o-mini", &okTarget)
		if backend == nil {
			t.Fatal("expected valid backend")
		}
		spoofReq, err := backend.newRequest(context.Background(), http.MethodPost, backend.baseURL+"/v1/chat/completions", bytes.NewReader([]byte(`{}`)))
		if err != nil {
			t.Fatal(err)
		}
		spoofReq.Host = "spoofed.example.com"
		if resp, err := backend.do(spoofReq); err == nil {
			_ = resp.Body.Close()
			t.Fatal("spoofed Host header accepted on pooled backend")
		}
		if okStats.requests.Load() != 0 {
			t.Fatalf("spoofed Host reached server: hits=%d", okStats.requests.Load())
		}

		// POST redirect to forbidden IP must not be followed.
		redirReq, err := backend.newRequest(context.Background(), http.MethodPost, backend.baseURL+"/v1/redirect-post", bytes.NewReader([]byte(`{}`)))
		if err != nil {
			t.Fatal(err)
		}
		redirResp, err := backend.do(redirReq)
		if err != nil {
			t.Fatalf("expected 307 response returned without following redirect, got err=%v", err)
		}
		_ = redirResp.Body.Close()
		if redirResp.StatusCode != http.StatusTemporaryRedirect || okStats.requests.Load() != 1 {
			t.Fatalf("unexpected redirect handling: status=%d hits=%d", redirResp.StatusCode, okStats.requests.Load())
		}
	})

	t.Run("OutboundGateBypassesPoolAndEnforcesPerIOFencing", func(t *testing.T) {
		httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			writeOpenAIChatOK(w, "gated-http-ok")
		}))
		defer httpSrv.Close()

		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
		defer provider.CloseIdleConnections()

		target := &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     "conn-gated",
			Endpoint:        httpSrv.URL + "/v1",
			APIKey:          "sk-gated",
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   true,
		}
		spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}

		var gateCalls atomic.Int32
		gatedCtx := WithOutboundGate(context.Background(), func(_ context.Context, handoff func() error) error {
			gateCalls.Add(1)
			return handoff()
		})
		for i := 0; i < 2; i++ {
			text, _, _, _, err := provider.GenerateTextScenarioWithTarget(gatedCtx, "gpt-4o-mini", spec, "", target, textwire.Directives{})
			if err != nil || text != "gated-http-ok" {
				t.Fatalf("gated send #%d failed: text=%q err=%v", i+1, text, err)
			}
		}
		if gateCalls.Load() != 2 || provider.connPool.entryCount() != 0 {
			t.Fatalf("gated requests must bypass pool: gateCalls=%d poolEntries=%d", gateCalls.Load(), provider.connPool.entryCount())
		}
	})

	t.Run("InsecureHTTPAndUserinfoRejected", func(t *testing.T) {
		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: false})
		defer provider.CloseIdleConnections()
		spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}
		for _, badURL := range []string{
			"http://api.openai.com/v1",
			"https://user:pass@api.openai.com/v1",
			"http://169.254.169.254/v1",
		} {
			_, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", &RemoteTarget{
				ProviderType:    "openai",
				ConnectorID:     "conn-bad",
				Endpoint:        badURL,
				APIKey:          "sk-bad",
				ProviderModelID: "gpt-4o-mini",
			}, textwire.Directives{})
			if err == nil {
				t.Fatalf("expected forbidden endpoint %q to be rejected", badURL)
			}
		}
		if provider.connPool.entryCount() != 0 {
			t.Fatalf("rejected endpoints must not populate pool: entries=%d", provider.connPool.entryCount())
		}
	})

	t.Run("EmptyBodyPostAndGetBypassPoolAndSecretsNotRetained", func(t *testing.T) {
		httpSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			_, _ = io.WriteString(w, `{"ok":true}`)
		}))
		defer httpSrv.Close()

		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
		defer provider.CloseIdleConnections()

		const secretKey = "sk-must-not-be-stored-in-pool" // pragma: allowlist secret
		target := &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     "conn-hygiene",
			Endpoint:        httpSrv.URL + "/v1",
			APIKey:          secretKey,
			Headers:         map[string]string{"X-DashScope-WorkSpace": "ws-hygiene"},
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   true,
		}
		backend, _ := provider.resolveBackendForTarget("gpt-4o-mini", target)
		if backend == nil {
			t.Fatal("expected backend")
		}

		// GET request and empty-body POST must bypass pool (one-shot only).
		getReq, err := backend.newRequest(context.Background(), http.MethodGet, backend.baseURL+"/v1/models", nil)
		if err != nil {
			t.Fatal(err)
		}
		if resp, err := backend.do(getReq); err != nil {
			t.Fatalf("GET failed: %v", err)
		} else {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
		emptyPost, err := backend.newRequest(context.Background(), http.MethodPost, backend.baseURL+"/v1/chat/completions", bytes.NewReader(nil))
		if err != nil {
			t.Fatal(err)
		}
		if resp, err := backend.do(emptyPost); err != nil {
			t.Fatalf("empty POST failed: %v", err)
		} else {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
		if provider.connPool.entryCount() != 0 {
			t.Fatalf("GET and empty-body POST must bypass pool, got entries=%d", provider.connPool.entryCount())
		}

		// Non-empty POST populates 1 slot whose key retains only digests, never raw secret.
		postReq, err := backend.newRequest(context.Background(), http.MethodPost, backend.baseURL+"/v1/chat/completions", bytes.NewReader([]byte(`{"ping":1}`)))
		if err != nil {
			t.Fatal(err)
		}
		if resp, err := backend.do(postReq); err != nil {
			t.Fatalf("non-empty POST failed: %v", err)
		} else {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
		}
		if provider.connPool.entryCount() != 1 {
			t.Fatalf("expected 1 pool entry after non-empty POST, got %d", provider.connPool.entryCount())
		}
		provider.connPool.mu.Lock()
		for slotKey := range provider.connPool.entries {
			dumped := fmt.Sprintf("%+v", slotKey)
			if strings.Contains(dumped, secretKey) || strings.Contains(dumped, "ws-hygiene") {
				provider.connPool.mu.Unlock()
				t.Fatalf("raw secret or header value retained in pool key: %s", dumped)
			}
		}
		provider.connPool.mu.Unlock()
	})
}

// TestCloudOutboundPoolBoundedSizeIdleEvictionAndCloseIdleConnections verifies
// bounded LRU eviction, idle TTL expiry, CloseIdleConnections cleanup, and
// concurrent access safety.
func TestCloudOutboundPoolBoundedSizeIdleEvictionAndCloseIdleConnections(t *testing.T) {
	const host = "lifecycle.provider.test"
	server, caPool, _, stats, port := newTrackedTLSProviderServer(t, []string{host}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "ok")
	})
	defer server.Close()

	nowMu := sync.Mutex{}
	fakeNow := time.Date(2026, 11, 27, 12, 0, 0, 0, time.UTC)

	provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
	defer provider.CloseIdleConnections()
	provider.connPool.maxEntries = 3
	provider.connPool.idleTTL = 10 * time.Second
	provider.connPool.now = func() time.Time {
		nowMu.Lock()
		defer nowMu.Unlock()
		return fakeNow
	}
	provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
		return []string{"127.0.0.1"}, nil
	})
	provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
		return caPool, "lifecycle-ca"
	}

	spec := &runtimev1.TextGenerateScenarioSpec{Input: []*runtimev1.ChatMessage{{Role: "user", Content: "hi"}}}
	makeTarget := func(connID string) *RemoteTarget {
		return &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     connID,
			Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
			APIKey:          "sk-" + connID,
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   true,
		}
	}

	// 1. Bounded LRU eviction: insert 5 distinct connectors with maxEntries=3.
	for i := 1; i <= 5; i++ {
		nowMu.Lock()
		fakeNow = fakeNow.Add(time.Second)
		nowMu.Unlock()
		if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", makeTarget(fmt.Sprintf("conn-%d", i)), textwire.Directives{}); err != nil {
			t.Fatalf("conn-%d failed: %v", i, err)
		}
		if got := provider.connPool.entryCount(); got > 3 {
			t.Fatalf("pool exceeded maxEntries=3: got %d", got)
		}
	}
	if got := provider.connPool.entryCount(); got != 3 {
		t.Fatalf("expected pool size 3 after 5 distinct connectors, got %d", got)
	}
	// conn-5 (MRU) must still reuse; conn-1 (evicted LRU) must dial fresh.
	var reusedConn5, reusedConn1 bool
	if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(
		httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reusedConn5 = i.Reused }}),
		"gpt-4o-mini", spec, "", makeTarget("conn-5"), textwire.Directives{},
	); err != nil {
		t.Fatal(err)
	}
	if !reusedConn5 {
		t.Fatal("expected MRU conn-5 to remain pooled and reused")
	}
	if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(
		httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reusedConn1 = i.Reused }}),
		"gpt-4o-mini", spec, "", makeTarget("conn-1"), textwire.Directives{},
	); err != nil {
		t.Fatal(err)
	}
	if reusedConn1 {
		t.Fatal("evicted LRU conn-1 unexpectedly reused a connection")
	}

	// 2. Idle TTL eviction: advance clock past idleTTL (10s), next request sweeps and opens fresh connection.
	nowMu.Lock()
	fakeNow = fakeNow.Add(15 * time.Second)
	nowMu.Unlock()
	var reusedAfterTTL bool
	if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(
		httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reusedAfterTTL = i.Reused }}),
		"gpt-4o-mini", spec, "", makeTarget("conn-5"), textwire.Directives{},
	); err != nil {
		t.Fatal(err)
	}
	if reusedAfterTTL {
		t.Fatal("idle-TTL-expired entry unexpectedly reused a connection")
	}
	if got := provider.connPool.entryCount(); got != 1 {
		t.Fatalf("expected expired entries swept leaving 1 fresh entry, got %d", got)
	}

	// 3. Explicit CloseIdleConnections cleanup empties pool and forces fresh connection next time.
	provider.CloseIdleConnections()
	if got := provider.connPool.entryCount(); got != 0 {
		t.Fatalf("CloseIdleConnections did not clear pool entries: got %d", got)
	}
	var reusedAfterClose bool
	if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(
		httptrace.WithClientTrace(context.Background(), &httptrace.ClientTrace{GotConn: func(i httptrace.GotConnInfo) { reusedAfterClose = i.Reused }}),
		"gpt-4o-mini", spec, "", makeTarget("conn-5"), textwire.Directives{},
	); err != nil {
		t.Fatal(err)
	}
	if reusedAfterClose {
		t.Fatal("connection unexpectedly reused after CloseIdleConnections")
	}

	// 4. Concurrent requests + CloseIdleConnections remain race-free and stay bounded.
	var wg sync.WaitGroup
	for g := 0; g < 6; g++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			tgt := makeTarget(fmt.Sprintf("conc-%d", id%4))
			for j := 0; j < 4; j++ {
				if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", tgt, textwire.Directives{}); err != nil {
					t.Errorf("concurrent req g=%d j=%d failed: %v", id, j, err)
					return
				}
				if j == 2 && id == 0 {
					provider.CloseIdleConnections()
				}
			}
		}(g)
	}
	wg.Wait()
	if got := provider.connPool.entryCount(); got > 3 {
		t.Fatalf("pool exceeded maxEntries after concurrent traffic: got %d", got)
	}
	if stats.requests.Load() == 0 {
		t.Fatal("expected requests observed on server")
	}
}

// BenchmarkCloudOutboundTLSReuseVsOneShot measures controlled local loopback
// TLS handshake + request latency and connection count for consecutive
// CloudProvider text POSTs (pooled HTTP/1.1 reuse vs fresh one-shot transport).
//
// NOTE: This benchmark measures controlled local TLS handshake savings only.
// Real internet TCP+TLS RTT savings depend on provider network distance and
// remain NOT-VERIFIED without live provider auth.
func BenchmarkCloudOutboundTLSReuseVsOneShot(b *testing.B) {
	previousLogger := slog.Default()
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
	b.Cleanup(func() { slog.SetDefault(previousLogger) })

	const host = "bench.openai.test"
	server, caPool, _, stats, port := newTrackedTLSProviderServer(b, []string{host}, func(w http.ResponseWriter, r *http.Request) {
		writeOpenAIChatOK(w, "bench-ok")
	})
	defer server.Close()

	spec := &runtimev1.TextGenerateScenarioSpec{
		Input: []*runtimev1.ChatMessage{{Role: "user", Content: "benchmark"}},
	}

	b.Run("PooledHTTP1TLSReuse", func(b *testing.B) {
		connsBefore := stats.newConns.Load()
		provider := NewCloudProvider(CloudConfig{HTTPTimeout: 5 * time.Second, AllowLoopbackEndpoint: true})
		defer provider.CloseIdleConnections()
		provider.connPool.resolver = funcEndpointResolver(func(_ context.Context, _ string) ([]string, error) {
			return []string{"127.0.0.1"}, nil
		})
		provider.connPool.tlsConfigForOrigin = func(_, _, _ string) (*x509.CertPool, string) {
			return caPool, "bench-ca"
		}
		target := &RemoteTarget{
			ProviderType:    "openai",
			ConnectorID:     "conn-bench",
			Endpoint:        "https://" + net.JoinHostPort(host, port) + "/v1",
			APIKey:          "sk-bench",
			ProviderModelID: "gpt-4o-mini",
			AllowLoopback:   true,
		}
		// Warm 1st connection before timed loop, or measure full sequence starting from cold.
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if _, _, _, _, err := provider.GenerateTextScenarioWithTarget(context.Background(), "gpt-4o-mini", spec, "", target, textwire.Directives{}); err != nil {
				b.Fatal(err)
			}
		}
		b.StopTimer()
		conns := stats.newConns.Load() - connsBefore
		b.ReportMetric(float64(conns), "tcp_tls_conns")
		b.ReportMetric(float64(conns)/float64(b.N), "conns/op")
	})

	b.Run("OneShotFreshTLSPerRequest", func(b *testing.B) {
		connsBefore := stats.newConns.Load()
		oneShotURL := "https://" + net.JoinHostPort(host, port) + "/v1"
		origin := mustParseURL(b, oneShotURL)
		backend := newBackend("cloud-openai", oneShotURL, "sk-bench", nil, 5*time.Second, &securedHTTPTransport{
			origin:        origin,
			allowLoopback: true,
			buildTransport: func(_ context.Context, _ string, _ bool) (*http.Transport, error) {
				protocols := new(http.Protocols)
				protocols.SetHTTP1(true)
				return &http.Transport{
					Protocols: protocols,
					DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
						return (&net.Dialer{Timeout: 5 * time.Second}).DialContext(dialCtx, network, net.JoinHostPort("127.0.0.1", port))
					},
					TLSClientConfig: &tls.Config{
						MinVersion: tls.VersionTLS12,
						ServerName: host,
						RootCAs:    caPool,
						NextProtos: []string{"http/1.1"},
					},
				}, nil
			},
		}, true, true)
		b.ResetTimer()
		for i := 0; i < b.N; i++ {
			if _, _, _, _, err := backend.GenerateText(context.Background(), "gpt-4o-mini", spec.GetInput(), "", 0, 0, 0, textGenParams{}); err != nil {
				b.Fatal(err)
			}
		}
		b.StopTimer()
		conns := stats.newConns.Load() - connsBefore
		b.ReportMetric(float64(conns), "tcp_tls_conns")
		b.ReportMetric(float64(conns)/float64(b.N), "conns/op")
	})
}

func mustParseURL(t testing.TB, raw string) *url.URL {
	t.Helper()
	parsed, err := parseNormalizedEndpointURL(raw)
	if err != nil {
		t.Fatal(err)
	}
	return parsed
}
