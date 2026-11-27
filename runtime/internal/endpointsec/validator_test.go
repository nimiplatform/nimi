package endpointsec

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"errors"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestValidateEndpoint_HTTPSRequired(t *testing.T) {
	// HTTP to non-loopback should be rejected.
	err := ValidateEndpoint(context.Background(), "http://example.com/v1", false)
	if err == nil {
		t.Fatal("expected error for HTTP to non-loopback")
	}
}

func TestValidateEndpoint_HTTPSAccepted(t *testing.T) {
	// HTTPS should pass validation (DNS resolution may fail in test env, that's OK).
	err := ValidateEndpoint(context.Background(), "https://example.com/v1", false)
	// May fail due to DNS but should NOT fail with "HTTPS required".
	if err != nil && strings.Contains(err.Error(), "HTTPS required") {
		t.Fatalf("HTTPS should be accepted: %v", err)
	}
}

func TestValidateEndpoint_HTTPLoopbackAllowed(t *testing.T) {
	err := ValidateEndpoint(context.Background(), "http://127.0.0.1:8080/v1", true)
	if err != nil {
		t.Fatalf("HTTP to 127.0.0.1 with allowLoopback should pass: %v", err)
	}
}

func TestValidateEndpoint_HTTPLoopbackDeniedWithoutFlag(t *testing.T) {
	err := ValidateEndpoint(context.Background(), "http://127.0.0.1:8080/v1", false)
	if err == nil {
		t.Fatal("HTTP to 127.0.0.1 without allowLoopback should fail")
	}
}

func TestValidateEndpoint_EmptyURL(t *testing.T) {
	err := ValidateEndpoint(context.Background(), "", false)
	if err == nil {
		t.Fatal("expected error for empty URL")
	}
}

func TestValidateEndpoint_InvalidScheme(t *testing.T) {
	err := ValidateEndpoint(context.Background(), "ftp://example.com/v1", false)
	if err == nil {
		t.Fatal("expected error for ftp scheme")
	}
}

func TestValidateEndpoint_RejectsUserinfo(t *testing.T) {
	err := ValidateEndpoint(context.Background(), "https://user:pass@example.com/v1", false)
	if err == nil || !strings.Contains(err.Error(), "userinfo") {
		t.Fatalf("expected userinfo rejection, got: %v", err)
	}
}

func TestCheckIP_LinkLocal_IPv4(t *testing.T) {
	ip := net.ParseIP("169.254.1.1")
	if err := checkIP(ip); err == nil {
		t.Fatal("expected link-local IPv4 to be blocked")
	}
}

func TestCheckIP_LinkLocal_IPv4MappedIPv6(t *testing.T) {
	ip := net.ParseIP("::ffff:169.254.1.1")
	if err := checkIP(ip); err == nil {
		t.Fatal("expected IPv4-mapped link-local address to be blocked")
	}
}

func TestCheckIP_LinkLocal_IPv6(t *testing.T) {
	ip := net.ParseIP("fe80::1")
	if err := checkIP(ip); err == nil {
		t.Fatal("expected link-local IPv6 to be blocked")
	}
}

func TestCheckIP_ULA_IPv6(t *testing.T) {
	ip := net.ParseIP("fc00::1")
	if err := checkIP(ip); err == nil {
		t.Fatal("expected ULA IPv6 to be blocked")
	}
	ip2 := net.ParseIP("fd12::1")
	if err := checkIP(ip2); err == nil {
		t.Fatal("expected ULA IPv6 (fd) to be blocked")
	}
}

func TestCheckIP_Private_IPv4_Allowed(t *testing.T) {
	// K-SEC-002: RFC 1918 private addresses are allowed (not blocked).
	for _, addr := range []string{"10.0.0.1", "172.16.0.1", "192.168.1.1"} {
		ip := net.ParseIP(addr)
		if err := checkIP(ip); err != nil {
			t.Fatalf("RFC 1918 private IPv4 %s should be allowed: %v", addr, err)
		}
	}
}

func TestCheckIP_UnspecifiedBlocked(t *testing.T) {
	for _, addr := range []string{"0.0.0.0", "::"} {
		ip := net.ParseIP(addr)
		if err := checkIP(ip); err == nil {
			t.Fatalf("expected unspecified address %s to be blocked", addr)
		}
	}
}

func TestCheckIP_Public_IPv4(t *testing.T) {
	ip := net.ParseIP("8.8.8.8")
	if err := checkIP(ip); err != nil {
		t.Fatalf("public IPv4 should pass: %v", err)
	}
}

func TestCheckIP_Loopback_IPv4_Passes(t *testing.T) {
	// Loopback IPs are not blocked by checkIP; only link-local/private are blocked.
	ip := net.ParseIP("127.0.0.1")
	if err := checkIP(ip); err != nil {
		t.Fatalf("loopback IPv4 should pass checkIP: %v", err)
	}
}

func TestNewPinnedTransport_HTTPSToPublic(t *testing.T) {
	transport, err := NewPinnedTransport(context.Background(), "https://127.0.0.1:443", true)
	if err != nil {
		t.Fatalf("NewPinnedTransport: %v", err)
	}
	if transport == nil {
		t.Fatal("expected non-nil transport")
	}
	if transport.TLSClientConfig == nil || transport.TLSClientConfig.ServerName != "127.0.0.1" {
		t.Fatal("expected TLS ServerName to be preserved")
	}
	if transport.TLSClientConfig.MinVersion != 0 && transport.TLSClientConfig.MinVersion < 0x0303 {
		t.Fatalf("expected TLS minimum version >= TLS 1.2, got %v", transport.TLSClientConfig.MinVersion)
	}
	if transport.MaxIdleConns != 10 || transport.MaxIdleConnsPerHost != 5 {
		t.Fatalf("unexpected idle connection defaults: %+v", transport)
	}
	if transport.IdleConnTimeout == 0 || transport.TLSHandshakeTimeout == 0 {
		t.Fatalf("expected timeout defaults to be configured")
	}
}

func TestNewPinnedTransport_HTTPToNonLoopbackFails(t *testing.T) {
	_, err := NewPinnedTransport(context.Background(), "http://example.com", false)
	if err == nil {
		t.Fatal("expected error for HTTP to non-loopback")
	}
}

func TestNewPinnedTransport_HTTPToLoopbackAllowed(t *testing.T) {
	transport, err := NewPinnedTransport(context.Background(), "http://127.0.0.1:8080", true)
	if err != nil {
		t.Fatalf("HTTP to 127.0.0.1 with allowLoopback should work: %v", err)
	}
	if transport == nil {
		t.Fatal("expected non-nil transport")
	}
}

type testResolver struct {
	lookup func(ctx context.Context, host string) ([]string, error)
}

func (r testResolver) LookupHost(ctx context.Context, host string) ([]string, error) {
	return r.lookup(ctx, host)
}

func TestResolveValidatedEndpoint_RejectsHTTPNonLoopbackHostBeforeDNS(t *testing.T) {
	called := false
	_, _, err := ResolveValidatedEndpoint(context.Background(), testResolver{
		lookup: func(ctx context.Context, host string) ([]string, error) {
			called = true
			return []string{"127.0.0.1"}, nil
		},
	}, "http://example.com:8080/v1", true)
	if err == nil {
		t.Fatal("expected non-loopback HTTP host to fail")
	}
	if called {
		t.Fatal("expected host precheck to reject before DNS resolution")
	}
}

func TestResolveValidatedEndpoint_UsesCallerContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	_, _, err := ResolveValidatedEndpoint(ctx, testResolver{
		lookup: func(ctx context.Context, host string) ([]string, error) {
			<-ctx.Done()
			return nil, ctx.Err()
		},
	}, "https://example.com/v1", false)
	if err == nil || !strings.Contains(err.Error(), context.Canceled.Error()) {
		t.Fatalf("expected canceled context error, got %v", err)
	}
}

func TestResolveValidatedEndpoint_FiltersUnsafeIPsFromMixedResults(t *testing.T) {
	_, safeIPs, err := ResolveValidatedEndpoint(context.Background(), testResolver{
		lookup: func(ctx context.Context, host string) ([]string, error) {
			return []string{"169.254.1.1", "8.8.8.8", "fe80::1"}, nil
		},
	}, "https://example.com/v1", false)
	if err != nil {
		t.Fatalf("resolveValidatedEndpoint: %v", err)
	}
	if len(safeIPs) != 1 || safeIPs[0] != "8.8.8.8" {
		t.Fatalf("expected only public IP to survive filtering, got %#v", safeIPs)
	}
}

func TestNewPinnedTransportRetriesAcrossSafeIPs(t *testing.T) {
	attempts := make([]string, 0, 2)
	transport := newPinnedTransport(&url.URL{Scheme: "https", Host: "example.com:443"}, []string{"203.0.113.10", "203.0.113.11"}, func(ctx context.Context, network, addr string) (net.Conn, error) {
		attempts = append(attempts, addr)
		if strings.HasPrefix(addr, "203.0.113.10:") {
			return nil, errors.New("first ip unavailable")
		}
		server, client := net.Pipe()
		go func() { _ = server.Close() }()
		return client, nil
	})

	conn, err := transport.DialContext(context.Background(), "tcp", "ignored")
	if err != nil {
		t.Fatalf("DialContext: %v", err)
	}
	_ = conn.Close()

	if len(attempts) != 2 {
		t.Fatalf("expected 2 dial attempts, got %d (%v)", len(attempts), attempts)
	}
	if attempts[0] != "203.0.113.10:443" || attempts[1] != "203.0.113.11:443" {
		t.Fatalf("unexpected dial order: %v", attempts)
	}
}

func TestValidateWebSocketEndpointUsesHTTPSHostPolicyWithoutWideningHTTP(t *testing.T) {
	if err := ValidateWebSocketEndpoint(context.Background(), "wss://example.com/realtime?model=test", false); err != nil {
		t.Fatalf("public WSS endpoint: %v", err)
	}
	for _, raw := range []string{"ws://example.com/realtime", "https://example.com/realtime", "wss://user:pass@example.com/realtime"} { // pragma: allowlist secret -- credential rejection fixture
		if err := ValidateWebSocketEndpoint(context.Background(), raw, false); err == nil {
			t.Fatalf("unsafe/non-WebSocket endpoint admitted: %s", raw)
		}
	}
}

func TestIsLoopbackHost(t *testing.T) {
	tests := []struct {
		host     string
		expected bool
	}{
		{"localhost", true},
		{"LOCALHOST", true},
		{"127.0.0.1", true},
		{"::1", true},
		{"example.com", false},
		{"192.168.1.1", false},
	}
	for _, tt := range tests {
		if got := isLoopbackHost(tt.host); got != tt.expected {
			t.Errorf("isLoopbackHost(%q) = %v, want %v", tt.host, got, tt.expected)
		}
	}
}

func generateTestTLSLeaf(t *testing.T, dnsName string) (*x509.CertPool, tls.Certificate) {
	t.Helper()
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "nimi-test-ca"},
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
	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: dnsName},
		DNSNames:     []string{dnsName},
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
	return pool, tls.Certificate{
		Certificate: [][]byte{leafDER, caDER},
		PrivateKey:  leafKey,
	}
}

func TestPinnedTransportDisjointRegionalAndWorkspaceIPsWithRealTLS(t *testing.T) {
	const (
		workspaceHost = "ws-beijing.cn-beijing.maas.aliyuncs.com"
		regionalHost  = "dashscope.aliyuncs.com"
	)

	// Start a real TLS server presenting a cert valid ONLY for dashscope.aliyuncs.com.
	regionalPool, regionalCert := generateTestTLSLeaf(t, regionalHost)
	var observedMu sync.Mutex
	var observedSNI, observedHost, observedWorkspace string
	regionalServer := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		observedMu.Lock()
		if r.TLS != nil {
			observedSNI = r.TLS.ServerName
		}
		observedHost = r.Host
		observedWorkspace = r.Header.Get("X-DashScope-WorkSpace")
		observedMu.Unlock()
		_, _ = io.WriteString(w, "regional-tts-ok")
	}))
	regionalServer.TLS = &tls.Config{Certificates: []tls.Certificate{regionalCert}}
	regionalServer.StartTLS()
	defer regionalServer.Close()

	// Start a second real TLS server presenting a cert valid ONLY for the workspace host.
	workspacePool, workspaceCert := generateTestTLSLeaf(t, workspaceHost)
	workspaceServer := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Error("regional pinned transport must not complete TLS against workspace-only certificate")
		w.WriteHeader(http.StatusOK)
	}))
	workspaceServer.TLS = &tls.Config{Certificates: []tls.Certificate{workspaceCert}}
	workspaceServer.StartTLS()
	defer workspaceServer.Close()

	_, regionalPort, err := net.SplitHostPort(regionalServer.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	_, workspacePort, err := net.SplitHostPort(workspaceServer.Listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}

	// Disjoint DNS mapping: workspaceHost resolves ONLY to 203.0.113.77; regionalHost resolves ONLY to 127.0.0.1.
	disjointResolver := testResolver{
		lookup: func(_ context.Context, host string) ([]string, error) {
			switch strings.ToLower(host) {
			case regionalHost:
				return []string{"127.0.0.1"}, nil
			case workspaceHost:
				return []string{"203.0.113.77"}, nil
			default:
				return nil, errors.New("unexpected host: " + host)
			}
		},
	}

	regionalURL := "https://" + net.JoinHostPort(regionalHost, regionalPort) + "/api/v1/services/aigc/multimodal-generation/generation"
	parsedRegional, regionalIPs, err := ResolveValidatedEndpoint(context.Background(), disjointResolver, regionalURL, true)
	if err != nil {
		t.Fatalf("ResolveValidatedEndpoint(regional): %v", err)
	}
	if len(regionalIPs) != 1 || regionalIPs[0] != "127.0.0.1" {
		t.Fatalf("unexpected regional IP set: %#v", regionalIPs)
	}

	var dialedAddrs []string
	baseDialer := &net.Dialer{Timeout: 5 * time.Second}
	transport := newPinnedTransport(parsedRegional, regionalIPs, func(ctx context.Context, network, addr string) (net.Conn, error) {
		dialedAddrs = append(dialedAddrs, addr)
		return baseDialer.DialContext(ctx, network, addr)
	})
	transport.TLSClientConfig.RootCAs = regionalPool
	defer transport.CloseIdleConnections()

	req, err := http.NewRequestWithContext(context.Background(), http.MethodPost, regionalURL, nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("X-DashScope-WorkSpace", "ws-beijing")
	resp, err := (&http.Client{Transport: transport}).Do(req)
	if err != nil {
		t.Fatalf("regional pinned HTTPS request failed: %v", err)
	}
	body, _ := io.ReadAll(resp.Body)
	_ = resp.Body.Close()

	if string(body) != "regional-tts-ok" {
		t.Fatalf("body = %q, want regional-tts-ok", string(body))
	}
	wantDial := net.JoinHostPort("127.0.0.1", regionalPort)
	if len(dialedAddrs) != 1 || dialedAddrs[0] != wantDial {
		t.Fatalf("dialed addrs = %#v, want [%s]", dialedAddrs, wantDial)
	}
	observedMu.Lock()
	gotSNI, gotHost, gotWS := observedSNI, observedHost, observedWorkspace
	observedMu.Unlock()
	if gotSNI != regionalHost {
		t.Fatalf("TLS SNI = %q, want %q", gotSNI, regionalHost)
	}
	if gotHost != net.JoinHostPort(regionalHost, regionalPort) {
		t.Fatalf("HTTP Host = %q, want %q", gotHost, net.JoinHostPort(regionalHost, regionalPort))
	}
	if gotWS != "ws-beijing" {
		t.Fatalf("workspace header = %q, want ws-beijing", gotWS)
	}

	// Negative 1: regional target connected to a peer serving ONLY the workspace host certificate fails TLS verification.
	wrongCertURL := "https://" + net.JoinHostPort(regionalHost, workspacePort) + "/api/v1/services/aigc/multimodal-generation/generation"
	parsedWrongCert, wrongCertIPs, err := ResolveValidatedEndpoint(context.Background(), disjointResolver, wrongCertURL, true)
	if err != nil {
		t.Fatal(err)
	}
	wrongCertTransport := newPinnedTransport(parsedWrongCert, wrongCertIPs, baseDialer.DialContext)
	wrongCertTransport.TLSClientConfig.RootCAs = workspacePool
	defer wrongCertTransport.CloseIdleConnections()
	wrongReq, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, wrongCertURL, nil)
	if wrongResp, wrongErr := (&http.Client{Transport: wrongCertTransport}).Do(wrongReq); wrongErr == nil {
		_ = wrongResp.Body.Close()
		t.Fatal("expected TLS verification failure when peer certificate matches workspace host instead of regional host")
	}

	// Negative 2: if regional host resolves only to link-local IP, validation rejects even when workspace host is public.
	blockedRegionalResolver := testResolver{
		lookup: func(_ context.Context, host string) ([]string, error) {
			switch strings.ToLower(host) {
			case regionalHost:
				return []string{"169.254.169.254"}, nil
			case workspaceHost:
				return []string{"203.0.113.77"}, nil
			default:
				return nil, errors.New("unexpected host: " + host)
			}
		},
	}
	if _, _, err := ResolveValidatedEndpoint(context.Background(), blockedRegionalResolver, regionalURL, true); err == nil {
		t.Fatal("expected regional host resolving to link-local IP to be rejected")
	}
}
