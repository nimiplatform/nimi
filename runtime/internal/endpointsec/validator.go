// Package endpointsec provides endpoint security validation for outbound HTTP
// requests, preventing SSRF attacks via HTTPS enforcement, private/link-local
// address blocking, and DNS-pinned transports (TOCTOU prevention).
package endpointsec

import (
	"context"
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// ValidateEndpoint checks that rawURL is a safe outbound endpoint.
//
// Rules (K-SEC-001, K-SEC-002):
//   - HTTPS is required unless allowLoopback is true and the host resolves to
//     a loopback address (127.0.0.0/8, ::1, or "localhost").
//   - Link-local (169.254.0.0/16, fe80::/10) and ULA (fc00::/7) addresses
//     are always blocked.
func ValidateEndpoint(rawURL string, allowLoopback bool) error {
	_, _, err := resolveValidatedEndpoint(rawURL, allowLoopback)
	return err
}

// NewPinnedTransport creates an *http.Transport that pins the DNS resolution
// of rawURL to a specific IP at creation time, preventing TOCTOU attacks
// (K-SEC-003). The original hostname is preserved for TLS SNI and HTTP Host.
//
// Returns an error if the URL fails validation or DNS resolution yields
// only blocked addresses.
func NewPinnedTransport(rawURL string, allowLoopback bool) (*http.Transport, error) {
	parsed, safeIPs, err := resolveValidatedEndpoint(rawURL, allowLoopback)
	if err != nil {
		return nil, err
	}
	host := parsed.Hostname()
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}

	pinnedAddr := net.JoinHostPort(safeIPs[0], port)

	transport := &http.Transport{
		MaxIdleConns:        10,
		MaxIdleConnsPerHost: 5,
		IdleConnTimeout:     90 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
		DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) {
			dialer := &net.Dialer{Timeout: 10 * time.Second}
			return dialer.DialContext(ctx, network, pinnedAddr)
		},
	}

	// Preserve original hostname for TLS verification when using HTTPS.
	if parsed.Scheme == "https" {
		transport.TLSClientConfig = &tls.Config{
			ServerName: host,
		}
	}

	return transport, nil
}

func resolveValidatedEndpoint(rawURL string, allowLoopback bool) (*url.URL, []string, error) {
	parsed, err := parseAndNormalize(rawURL)
	if err != nil {
		return nil, nil, err
	}

	host := parsed.Hostname()
	isLoopback := isLoopbackHost(host)
	if parsed.Scheme != "https" {
		if parsed.Scheme != "http" || !allowLoopback || !isLoopback {
			return nil, nil, fmt.Errorf("endpointsec: HTTPS required for endpoint %q", rawURL)
		}
	}

	ips, err := net.DefaultResolver.LookupHost(context.Background(), host)
	if err != nil {
		return nil, nil, fmt.Errorf("endpointsec: DNS resolution failed for %q: %w", host, err)
	}

	safeIPs := make([]string, 0, len(ips))
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if !allowLoopback && ip.IsLoopback() {
			if parsed.Scheme == "http" {
				return nil, nil, fmt.Errorf("endpointsec: resolved IP %s for %q is loopback and allow_loopback_provider_endpoint=false", ipStr, host)
			}
			continue
		}
		if err := checkIP(ip); err != nil {
			if parsed.Scheme == "http" {
				return nil, nil, fmt.Errorf("endpointsec: resolved IP %s for %q is blocked: %w", ipStr, host, err)
			}
			continue
		}
		safeIPs = append(safeIPs, ipStr)
	}
	if len(safeIPs) == 0 {
		return nil, nil, fmt.Errorf("endpointsec: no safe IP found for %q", host)
	}
	return parsed, safeIPs, nil
}

func parseAndNormalize(rawURL string) (*url.URL, error) {
	trimmed := strings.TrimSpace(rawURL)
	if trimmed == "" {
		return nil, fmt.Errorf("endpointsec: empty URL")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return nil, fmt.Errorf("endpointsec: invalid URL %q: %w", trimmed, err)
	}
	if parsed.Host == "" {
		return nil, fmt.Errorf("endpointsec: URL %q has no host", trimmed)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("endpointsec: unsupported scheme %q in URL %q", scheme, trimmed)
	}
	parsed.Scheme = scheme
	return parsed, nil
}

// checkIP rejects link-local and ULA addresses per K-SEC-002.
// RFC 1918 private addresses (10/8, 172.16/12, 192.168/16) are allowed.
func checkIP(ip net.IP) error {
	if ip == nil {
		return fmt.Errorf("invalid IP address")
	}
	if ip.IsUnspecified() {
		return fmt.Errorf("unspecified address")
	}
	if ip4 := ip.To4(); ip4 != nil {
		// Link-local: 169.254.0.0/16
		if ip4[0] == 169 && ip4[1] == 254 {
			return fmt.Errorf("link-local IPv4 address")
		}
		return nil
	}
	// IPv6 checks.
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return fmt.Errorf("link-local IPv6 address")
	}
	// ULA: fc00::/7 (first byte fc or fd).
	if len(ip) >= 1 && (ip[0]&0xfe) == 0xfc {
		return fmt.Errorf("ULA IPv6 address (fc00::/7)")
	}
	return nil
}

func isLoopbackHost(host string) bool {
	lower := strings.ToLower(strings.TrimSpace(host))
	if lower == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}
