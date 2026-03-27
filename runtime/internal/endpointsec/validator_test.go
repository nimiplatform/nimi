package endpointsec

import (
	"context"
	"errors"
	"net"
	"net/url"
	"strings"
	"testing"
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
	_, _, err := resolveValidatedEndpoint(context.Background(), testResolver{
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

	_, _, err := resolveValidatedEndpoint(ctx, testResolver{
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
	_, safeIPs, err := resolveValidatedEndpoint(context.Background(), testResolver{
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
		go server.Close()
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
