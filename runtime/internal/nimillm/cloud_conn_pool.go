package nimillm

import (
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	defaultCloudConnPoolMaxEntries       = 32
	defaultCloudConnPoolIdleTTL          = 30 * time.Second
	defaultCloudConnPoolMaxIdlePerEntry  = 2
	defaultCloudConnPoolMaxConnsPerEntry = 8
	defaultCloudConnDialTimeout          = 10 * time.Second
	defaultCloudConnTLSHandshakeTimeout  = 10 * time.Second
)

type endpointHostResolver interface {
	LookupHost(ctx context.Context, host string) ([]string, error)
}

type validatedEndpointDestination struct {
	parsed    *url.URL
	scheme    string
	host      string // normalized lowercase hostname (TLS SNI / pinned host)
	port      string // effective port ("443", "80", or explicit)
	safeIPs   []string
	safeIPSet map[string]struct{}
}

type validatedDialPolicyKey struct{}

type validatedDialPolicy struct {
	scheme        string
	allowLoopback bool
	allowedIPs    map[string]struct{}
}

// cloudConnectionScope carries only non-secret isolation metadata and SHA-256
// digests derived from a request-scoped RemoteTarget. Raw API keys and header
// secrets are never retained in pool state.
// @nimi-authority: rule.nimi.runtime.security-core.r035
type cloudConnectionScope struct {
	providerType         string
	connectorID          string
	credentialDigest     [sha256.Size]byte
	targetBoundaryDigest [sha256.Size]byte
}

func newCloudConnectionScope(target *RemoteTarget) *cloudConnectionScope {
	if target == nil {
		return nil
	}
	return &cloudConnectionScope{
		providerType:         strings.TrimSpace(target.ProviderType),
		connectorID:          strings.TrimSpace(target.ConnectorID),
		credentialDigest:     sha256.Sum256([]byte(strings.TrimSpace(target.APIKey))),
		targetBoundaryDigest: hashTargetBoundary(target),
	}
}

func hashTargetBoundary(target *RemoteTarget) [sha256.Size]byte {
	hasher := sha256.New()
	writeHashField(hasher, "connector_snapshot", strings.TrimSpace(target.ConnectorSnapshotID))
	writeHashField(hasher, "endpoint_profile", strings.TrimSpace(target.EndpointProfileID))
	writeHashField(hasher, "azure_deployment", strings.TrimSpace(target.AzureDeploymentName))
	writeHashField(hasher, "bedrock_invocation", strings.TrimSpace(target.BedrockInvocationModelID))
	if len(target.Headers) > 0 {
		keys := make([]string, 0, len(target.Headers))
		normalized := make(map[string]string, len(target.Headers))
		for rawKey, rawVal := range target.Headers {
			key := strings.ToLower(strings.TrimSpace(rawKey))
			if key == "" {
				continue
			}
			val := strings.TrimSpace(rawVal)
			if val == "" {
				continue
			}
			if _, exists := normalized[key]; !exists {
				keys = append(keys, key)
			}
			normalized[key] = val
		}
		sort.Strings(keys)
		for _, key := range keys {
			writeHashField(hasher, "hdr:"+key, normalized[key])
		}
	}
	var out [sha256.Size]byte
	hasher.Sum(out[:0])
	return out
}

// nonBoundaryRequestHeaders lists per-request HTTP framing or tracing headers
// that do not alter Connector, workspace, tenant, session, or credential
// isolation. Every other header on the outbound request (including Authorization,
// X-Api-Key, Api-Key, X-Goog-Api-Key, X-DashScope-WorkSpace, OpenAI-Organization,
// OpenAI-Project, Cookie, etc.) is hashed into the pool isolation key.
var nonBoundaryRequestHeaders = map[string]struct{}{
	"accept":          {},
	"accept-encoding": {},
	"content-type":    {},
	"content-length":  {},
	"user-agent":      {},
	"x-request-id":    {},
	"traceparent":     {},
	"tracestate":      {},
}

func computeRequestBoundaryDigest(scope *cloudConnectionScope, header http.Header) [sha256.Size]byte {
	hasher := sha256.New()
	_, _ = hasher.Write(scope.credentialDigest[:])
	_, _ = hasher.Write(scope.targetBoundaryDigest[:])
	if len(header) > 0 {
		keys := make([]string, 0, len(header))
		byLower := make(map[string][]string, len(header))
		for rawKey, values := range header {
			lower := strings.ToLower(strings.TrimSpace(rawKey))
			if lower == "" {
				continue
			}
			if _, excluded := nonBoundaryRequestHeaders[lower]; excluded {
				continue
			}
			if _, exists := byLower[lower]; !exists {
				keys = append(keys, lower)
			}
			byLower[lower] = append(byLower[lower], values...)
		}
		sort.Strings(keys)
		for _, key := range keys {
			vals := byLower[key]
			writeHashUint64(hasher, uint64(len(vals)))
			for _, val := range vals {
				writeHashField(hasher, "reqhdr:"+key, strings.TrimSpace(val))
			}
		}
	}
	var out [sha256.Size]byte
	hasher.Sum(out[:0])
	return out
}

func writeHashField(w io.Writer, label, value string) {
	writeHashUint64(w, uint64(len(label)))
	_, _ = io.WriteString(w, label)
	writeHashUint64(w, uint64(len(value)))
	_, _ = io.WriteString(w, value)
}

func writeHashUint64(w io.Writer, v uint64) {
	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], v)
	_, _ = w.Write(buf[:])
}

type cloudConnPoolKey struct {
	scheme         string
	host           string
	port           string
	allowLoopback  bool
	providerType   string
	connectorID    string
	tlsProfile     string
	boundaryDigest [sha256.Size]byte
}

type cloudConnSlotKey struct {
	isolation cloudConnPoolKey
	peerIP    string
}

type cloudConnPoolEntry struct {
	key           cloudConnPoolKey
	peerMu        sync.Mutex
	peerIP        string
	transport     *http.Transport
	lastUsed      time.Time
	inFlight      int
	everSucceeded bool
	detached      bool
	inPool        bool
}

func (e *cloudConnPoolEntry) latchedPeerIP() string {
	e.peerMu.Lock()
	defer e.peerMu.Unlock()
	return e.peerIP
}

// cloudConnectionPool provides bounded, strictly isolated HTTP/1.1 connection
// reuse for CloudProvider's target-bound outbound POST forwarding path.
//
// Every request still validates its actual destination and current DNS address
// set immediately before dispatch. Connections are reused ONLY when:
//   - the request is a same-origin, non-gated, non-empty-body POST (never a
//     redirect, cross-origin artifact fetch, or gated async job IO),
//   - the pool slot matches the exact destination (scheme, normalized host/SNI,
//     port, allowLoopback, TLS profile) and Connector/workspace/credential
//     boundary, AND
//   - the pooled connection's pinned peer IP belongs to THIS request's
//     currently validated safe IP set.
//
// Transports are explicitly pinned to HTTP/1.1 and outbound requests clear
// GetBody before dispatch so Go's http.Transport never silently replays a
// non-idempotent POST on a broken or closed idle connection.
// @nimi-authority: rule.nimi.runtime.security-core.r032
// @nimi-authority: rule.nimi.runtime.security-core.r033
// @nimi-authority: rule.nimi.runtime.security-core.r034
// @nimi-authority: rule.nimi.runtime.security-core.r035
type cloudConnectionPool struct {
	mu         sync.Mutex
	entries    map[cloudConnSlotKey]*cloudConnPoolEntry
	maxEntries int
	idleTTL    time.Duration

	// Test/instrumentation hooks; nil in production.
	resolver           endpointHostResolver
	dialFn             func(ctx context.Context, network, addr string) (net.Conn, error)
	tlsConfigForOrigin func(scheme, host, port string) (*x509.CertPool, string)
	now                func() time.Time
}

func newCloudConnectionPool() *cloudConnectionPool {
	return &cloudConnectionPool{
		entries:    make(map[cloudConnSlotKey]*cloudConnPoolEntry),
		maxEntries: defaultCloudConnPoolMaxEntries,
		idleTTL:    defaultCloudConnPoolIdleTTL,
		now:        time.Now,
	}
}

func (p *cloudConnectionPool) currentTime() time.Time {
	if p != nil && p.now != nil {
		return p.now()
	}
	return time.Now()
}

func (p *cloudConnectionPool) maxPoolEntries() int {
	if p != nil && p.maxEntries > 0 {
		return p.maxEntries
	}
	return defaultCloudConnPoolMaxEntries
}

func (p *cloudConnectionPool) entryIdleTTL() time.Duration {
	if p != nil && p.idleTTL > 0 {
		return p.idleTTL
	}
	return defaultCloudConnPoolIdleTTL
}

func (p *cloudConnectionPool) dialFunc() func(ctx context.Context, network, addr string) (net.Conn, error) {
	if p != nil && p.dialFn != nil {
		return p.dialFn
	}
	dialer := &net.Dialer{Timeout: defaultCloudConnDialTimeout}
	return dialer.DialContext
}

func (p *cloudConnectionPool) resolveAndValidate(ctx context.Context, rawURL string, allowLoopback bool) (validatedEndpointDestination, error) {
	var resolver endpointHostResolver
	if p != nil {
		resolver = p.resolver
	}
	return resolveAndValidateEndpoint(ctx, resolver, rawURL, allowLoopback)
}

func (p *cloudConnectionPool) roundTrip(request *http.Request, scope *cloudConnectionScope, allowLoopback bool) (*http.Response, error) {
	if p == nil || request == nil || request.URL == nil || scope == nil {
		return nil, fmt.Errorf("nimillm: invalid pooled outbound request")
	}
	dest, err := p.resolveAndValidate(request.Context(), request.URL.String(), allowLoopback)
	if err != nil {
		p.evictIdleForOrigin(request.URL, allowLoopback)
		return nil, wrapSecuredEndpointForbidden(err)
	}

	var rootCAs *x509.CertPool
	tlsProfile := ""
	if dest.scheme == "https" && p.tlsConfigForOrigin != nil {
		rootCAs, tlsProfile = p.tlsConfigForOrigin(dest.scheme, dest.host, dest.port)
	}

	isolationKey := cloudConnPoolKey{
		scheme:         dest.scheme,
		host:           dest.host,
		port:           dest.port,
		allowLoopback:  allowLoopback,
		providerType:   scope.providerType,
		connectorID:    scope.connectorID,
		tlsProfile:     tlsProfile,
		boundaryDigest: computeRequestBoundaryDigest(scope, request.Header),
	}

	entry := p.acquireEntry(isolationKey, dest, rootCAs)

	dialCtx := context.WithValue(request.Context(), validatedDialPolicyKey{}, validatedDialPolicy{
		scheme:        dest.scheme,
		allowLoopback: allowLoopback,
		allowedIPs:    dest.safeIPSet,
	})
	pooledReq := request.Clone(dialCtx)
	// Clearing GetBody on a non-empty-body HTTP/1.1 POST ensures Go's
	// http.Transport.shouldRetryRequest returns false even if an idle socket
	// breaks or Idempotency-Key / X-Idempotency-Key headers are set.
	pooledReq.GetBody = nil

	response, err := entry.transport.RoundTrip(pooledReq)
	if err != nil {
		p.releaseEntry(entry, false)
		return nil, err
	}

	p.registerEntryOnSuccess(entry)
	if response == nil || response.Body == nil || response.StatusCode == http.StatusSwitchingProtocols {
		p.releaseEntry(entry, true)
		return response, nil
	}
	response.Body = &pooledResponseBody{
		ReadCloser: response.Body,
		release: func() {
			p.releaseEntry(entry, true)
		},
	}
	return response, nil
}

func (p *cloudConnectionPool) acquireEntry(isolationKey cloudConnPoolKey, dest validatedEndpointDestination, rootCAs *x509.CertPool) *cloudConnPoolEntry {
	var toClose []*http.Transport

	p.mu.Lock()
	now := p.currentTime()
	toClose = append(toClose, p.sweepExpiredLocked(now)...)

	var matched *cloudConnPoolEntry
	for slotKey, entry := range p.entries {
		if slotKey.isolation != isolationKey {
			continue
		}
		if _, validNow := dest.safeIPSet[slotKey.peerIP]; !validNow {
			// DNS rotated away from this peer IP; refuse reuse and detach.
			delete(p.entries, slotKey)
			entry.inPool = false
			entry.detached = true
			if entry.inFlight == 0 {
				toClose = append(toClose, entry.transport)
			}
			continue
		}
		if matched == nil || entry.lastUsed.After(matched.lastUsed) {
			matched = entry
		}
	}

	if matched != nil {
		matched.inFlight++
		matched.lastUsed = now
		p.mu.Unlock()
		closeTransportsIdle(toClose)
		return matched
	}

	// Pool miss: build a new single-peer-pinned HTTP/1.1 transport.
	if len(dest.safeIPs) == 1 {
		peerIP := dest.safeIPs[0]
		entry := p.newEntry(isolationKey, dest, peerIP, rootCAs, now)
		toClose = append(toClose, p.evictIfFullLocked()...)
		p.entries[cloudConnSlotKey{isolation: isolationKey, peerIP: peerIP}] = entry
		entry.inPool = true
		p.mu.Unlock()
		closeTransportsIdle(toClose)
		return entry
	}

	// Multiple validated safe IPs: dial with failover first, then latch and
	// register the exact connected peer IP once the request succeeds.
	candidate := p.newEntry(isolationKey, dest, "", rootCAs, now)
	p.mu.Unlock()
	closeTransportsIdle(toClose)
	return candidate
}

func (p *cloudConnectionPool) newEntry(isolationKey cloudConnPoolKey, dest validatedEndpointDestination, pinnedIP string, rootCAs *x509.CertPool, now time.Time) *cloudConnPoolEntry {
	entry := &cloudConnPoolEntry{
		key:      isolationKey,
		peerIP:   pinnedIP,
		lastUsed: now,
		inFlight: 1,
	}
	safeIPsCopy := append([]string(nil), dest.safeIPs...)
	port := dest.port
	dialFn := p.dialFunc()

	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)

	transport := &http.Transport{
		MaxIdleConns:        defaultCloudConnPoolMaxIdlePerEntry,
		MaxIdleConnsPerHost: defaultCloudConnPoolMaxIdlePerEntry,
		MaxConnsPerHost:     defaultCloudConnPoolMaxConnsPerEntry,
		IdleConnTimeout:     p.entryIdleTTL(),
		TLSHandshakeTimeout: defaultCloudConnTLSHandshakeTimeout,
		ForceAttemptHTTP2:   false,
		Protocols:           protocols,
		DialContext: func(dialCtx context.Context, network, _ string) (net.Conn, error) {
			policy, ok := dialCtx.Value(validatedDialPolicyKey{}).(validatedDialPolicy)
			if !ok || len(policy.allowedIPs) == 0 {
				return nil, fmt.Errorf("nimillm: pooled dial missing current request validation")
			}
			latched := entry.latchedPeerIP()
			if latched != "" {
				if _, allowed := policy.allowedIPs[latched]; !allowed {
					return nil, fmt.Errorf("nimillm: pinned peer %s is not in current validated address set", latched)
				}
				if err := validateDialIP(latched, policy.scheme, policy.allowLoopback); err != nil {
					return nil, err
				}
				return dialFn(dialCtx, network, net.JoinHostPort(latched, port))
			}
			var lastErr error
			for _, ip := range safeIPsCopy {
				if _, allowed := policy.allowedIPs[ip]; !allowed {
					continue
				}
				if err := validateDialIP(ip, policy.scheme, policy.allowLoopback); err != nil {
					lastErr = err
					continue
				}
				conn, err := dialFn(dialCtx, network, net.JoinHostPort(ip, port))
				if err == nil {
					entry.peerMu.Lock()
					if entry.peerIP == "" {
						entry.peerIP = ip
					}
					entry.peerMu.Unlock()
					return conn, nil
				}
				lastErr = err
			}
			if lastErr == nil {
				lastErr = fmt.Errorf("nimillm: no validated peer IP available to dial")
			}
			return nil, lastErr
		},
	}

	if dest.scheme == "https" {
		transport.TLSClientConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
			ServerName: dest.host,
			RootCAs:    rootCAs,
			NextProtos: []string{"http/1.1"},
		}
	}

	entry.transport = transport
	return entry
}

func (p *cloudConnectionPool) registerEntryOnSuccess(entry *cloudConnPoolEntry) {
	var toClose []*http.Transport

	p.mu.Lock()
	entry.everSucceeded = true
	if !entry.inPool && !entry.detached {
		peerIP := entry.latchedPeerIP()
		if peerIP == "" {
			entry.detached = true
		} else {
			slotKey := cloudConnSlotKey{isolation: entry.key, peerIP: peerIP}
			if existing, exists := p.entries[slotKey]; exists && existing != entry {
				// Another concurrent cold request already populated this slot.
				entry.detached = true
			} else {
				toClose = append(toClose, p.evictIfFullLocked()...)
				p.entries[slotKey] = entry
				entry.inPool = true
			}
		}
	}
	p.mu.Unlock()

	closeTransportsIdle(toClose)
}

func (p *cloudConnectionPool) releaseEntry(entry *cloudConnPoolEntry, succeeded bool) {
	var closeIdle *http.Transport

	p.mu.Lock()
	if entry.inFlight > 0 {
		entry.inFlight--
	}
	entry.lastUsed = p.currentTime()
	if !succeeded && !entry.everSucceeded && entry.inFlight == 0 {
		if entry.inPool {
			slotKey := cloudConnSlotKey{isolation: entry.key, peerIP: entry.latchedPeerIP()}
			if current, exists := p.entries[slotKey]; exists && current == entry {
				delete(p.entries, slotKey)
			}
			entry.inPool = false
		}
		entry.detached = true
	}
	if (entry.detached || !entry.inPool) && entry.inFlight == 0 {
		closeIdle = entry.transport
	}
	p.mu.Unlock()

	if closeIdle != nil {
		closeIdle.CloseIdleConnections()
	}
}

func (p *cloudConnectionPool) sweepExpiredLocked(now time.Time) []*http.Transport {
	idleTTL := p.entryIdleTTL()
	var toClose []*http.Transport
	for slotKey, entry := range p.entries {
		if entry.inFlight == 0 && now.Sub(entry.lastUsed) >= idleTTL {
			delete(p.entries, slotKey)
			entry.inPool = false
			entry.detached = true
			toClose = append(toClose, entry.transport)
		}
	}
	return toClose
}

func (p *cloudConnectionPool) evictIfFullLocked() []*http.Transport {
	maxEntries := p.maxPoolEntries()
	var toClose []*http.Transport
	for len(p.entries) >= maxEntries {
		var victimKey cloudConnSlotKey
		var victim *cloudConnPoolEntry
		// Prefer evicting an idle LRU entry; fall back to overall LRU if all are active.
		for k, entry := range p.entries {
			if entry.inFlight != 0 {
				continue
			}
			if victim == nil || entry.lastUsed.Before(victim.lastUsed) {
				victimKey = k
				victim = entry
			}
		}
		if victim == nil {
			for k, entry := range p.entries {
				if victim == nil || entry.lastUsed.Before(victim.lastUsed) {
					victimKey = k
					victim = entry
				}
			}
		}
		if victim == nil {
			break
		}
		delete(p.entries, victimKey)
		victim.inPool = false
		victim.detached = true
		if victim.inFlight == 0 {
			toClose = append(toClose, victim.transport)
		}
	}
	return toClose
}

func (p *cloudConnectionPool) evictIdleForOrigin(raw *url.URL, allowLoopback bool) {
	if p == nil || raw == nil {
		return
	}
	scheme := strings.ToLower(strings.TrimSpace(raw.Scheme))
	host := strings.ToLower(strings.TrimSpace(raw.Hostname()))
	port := effectiveURLPort(raw)

	var toClose []*http.Transport
	p.mu.Lock()
	for slotKey, entry := range p.entries {
		if slotKey.isolation.scheme == scheme &&
			slotKey.isolation.host == host &&
			slotKey.isolation.port == port &&
			slotKey.isolation.allowLoopback == allowLoopback {
			delete(p.entries, slotKey)
			entry.inPool = false
			entry.detached = true
			if entry.inFlight == 0 {
				toClose = append(toClose, entry.transport)
			}
		}
	}
	p.mu.Unlock()
	closeTransportsIdle(toClose)
}

// CloseIdleConnections closes all idle connections currently held by the pool
// and removes idle entries from the map. Any in-flight entry is detached so its
// idle connection is closed immediately once its response body finishes.
func (p *cloudConnectionPool) CloseIdleConnections() {
	if p == nil {
		return
	}
	var toClose []*http.Transport
	p.mu.Lock()
	for slotKey, entry := range p.entries {
		delete(p.entries, slotKey)
		entry.inPool = false
		entry.detached = true
		toClose = append(toClose, entry.transport)
	}
	p.mu.Unlock()
	closeTransportsIdle(toClose)
}

func (p *cloudConnectionPool) entryCount() int {
	if p == nil {
		return 0
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.entries)
}

func closeTransportsIdle(transports []*http.Transport) {
	for _, tr := range transports {
		if tr != nil {
			tr.CloseIdleConnections()
		}
	}
}

type pooledResponseBody struct {
	io.ReadCloser
	once    sync.Once
	release func()
}

func (b *pooledResponseBody) Close() error {
	err := b.ReadCloser.Close()
	if b.release != nil {
		b.once.Do(b.release)
	}
	return err
}

func resolveAndValidateEndpoint(ctx context.Context, resolver endpointHostResolver, rawURL string, allowLoopback bool) (validatedEndpointDestination, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	if resolver == nil {
		resolver = net.DefaultResolver
	}
	parsed, err := parseNormalizedEndpointURL(rawURL)
	if err != nil {
		return validatedEndpointDestination{}, err
	}
	host := strings.ToLower(parsed.Hostname())
	port := effectiveURLPort(parsed)
	if parsed.Scheme != "https" {
		if parsed.Scheme != "http" || !allowLoopback {
			return validatedEndpointDestination{}, fmt.Errorf("endpointsec: HTTPS required for endpoint %q", rawURL)
		}
		if !isLoopbackEndpointHost(host) {
			return validatedEndpointDestination{}, fmt.Errorf("endpointsec: HTTP endpoint host %q is not loopback", host)
		}
	}
	ips, err := resolver.LookupHost(ctx, host)
	if err != nil {
		return validatedEndpointDestination{}, fmt.Errorf("endpointsec: DNS resolution failed for %q: %w", host, err)
	}
	safeIPs := make([]string, 0, len(ips))
	safeIPSet := make(map[string]struct{}, len(ips))
	for _, ipStr := range ips {
		ip := net.ParseIP(ipStr)
		if ip == nil {
			continue
		}
		if parsed.Scheme == "http" && !ip.IsLoopback() {
			return validatedEndpointDestination{}, fmt.Errorf("endpointsec: resolved IP %s for %q is not loopback", ipStr, host)
		}
		if !allowLoopback && ip.IsLoopback() {
			if parsed.Scheme == "http" {
				return validatedEndpointDestination{}, fmt.Errorf("endpointsec: resolved IP %s for %q is loopback and allow_loopback_provider_endpoint=false", ipStr, host)
			}
			continue
		}
		if err := checkEndpointIP(ip); err != nil {
			if parsed.Scheme == "http" {
				return validatedEndpointDestination{}, fmt.Errorf("endpointsec: resolved IP %s for %q is blocked: %w", ipStr, host, err)
			}
			continue
		}
		canonical := ip.String()
		if _, dup := safeIPSet[canonical]; dup {
			continue
		}
		safeIPSet[canonical] = struct{}{}
		safeIPs = append(safeIPs, canonical)
	}
	if len(safeIPs) == 0 {
		return validatedEndpointDestination{}, fmt.Errorf("endpointsec: no safe IP found for %q", host)
	}
	return validatedEndpointDestination{
		parsed:    parsed,
		scheme:    parsed.Scheme,
		host:      host,
		port:      port,
		safeIPs:   safeIPs,
		safeIPSet: safeIPSet,
	}, nil
}

func parseNormalizedEndpointURL(rawURL string) (*url.URL, error) {
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
	if parsed.User != nil {
		return nil, fmt.Errorf("endpointsec: URL %q must not contain userinfo", trimmed)
	}
	scheme := strings.ToLower(parsed.Scheme)
	if scheme != "http" && scheme != "https" {
		return nil, fmt.Errorf("endpointsec: unsupported scheme %q in URL %q", scheme, trimmed)
	}
	parsed.Scheme = scheme
	return parsed, nil
}

func effectiveURLPort(u *url.URL) string {
	if explicit := u.Port(); explicit != "" {
		return explicit
	}
	if strings.EqualFold(u.Scheme, "https") {
		return "443"
	}
	return "80"
}

func validateDialIP(ipStr, scheme string, allowLoopback bool) error {
	ip := net.ParseIP(ipStr)
	if err := checkEndpointIP(ip); err != nil {
		return fmt.Errorf("endpointsec: dial IP %s is blocked: %w", ipStr, err)
	}
	if scheme == "http" && !ip.IsLoopback() {
		return fmt.Errorf("endpointsec: dial IP %s is not loopback for http", ipStr)
	}
	if !allowLoopback && ip.IsLoopback() {
		return fmt.Errorf("endpointsec: dial IP %s is loopback and allow_loopback_provider_endpoint=false", ipStr)
	}
	return nil
}

// checkEndpointIP enforces the exact Phase 1 IP baseline from rule.nimi.runtime.security-core.r033:
// rejects unspecified, link-local IPv4 (169.254.0.0/16), link-local IPv6 (fe80::/10),
// and ULA IPv6 (fc00::/7).
func checkEndpointIP(ip net.IP) error {
	if ip == nil {
		return fmt.Errorf("invalid IP address")
	}
	if ip.IsUnspecified() {
		return fmt.Errorf("unspecified address")
	}
	if ip4 := ip.To4(); ip4 != nil {
		if ip4[0] == 169 && ip4[1] == 254 {
			return fmt.Errorf("link-local IPv4 address")
		}
		return nil
	}
	if ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() {
		return fmt.Errorf("link-local IPv6 address")
	}
	if len(ip) >= 1 && (ip[0]&0xfe) == 0xfc {
		return fmt.Errorf("ULA IPv6 address (fc00::/7)")
	}
	return nil
}

func isLoopbackEndpointHost(host string) bool {
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
