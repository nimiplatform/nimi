package authn

import (
	"bytes"
	"context"
	"crypto"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"mime"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
	realmv1 "github.com/nimiplatform/nimi/runtime/gen/realm/v1"
	"github.com/nimiplatform/nimi/runtime/internal/jsonstrict"
)

// clockSkew is the maximum allowed clock skew for JWT validation (K-AUTHN-005).
const clockSkew = 60 * time.Second

const (
	defaultJWKSCacheTTL       = 5 * time.Minute
	defaultJWKSFallbackTTL    = 2 * time.Minute
	defaultJWKSRequestTimeout = 5 * time.Second
	defaultRevocationTimeout  = 5 * time.Second
	defaultRevocationCacheTTL = 15 * time.Second
	refreshCoalesceWindow     = 1 * time.Second
	maxJWKSBodyBytes          = 1 << 20
	maxRevocationBodyBytes    = 1 << 20
	minimumRSAKeyBits         = 2048
	defaultJWTMaxLifetime     = 24 * time.Hour
)

var (
	errEmptyToken          = errors.New("empty token")
	errSessionRevoked      = errors.New("session revoked")
	errRevocationNotConfig = errors.New("revocation url not configured for active jwt auth")
)

type revocationUnavailableError struct {
	message string
	err     error
}

func (e *revocationUnavailableError) Error() string {
	if e == nil {
		return ""
	}
	if e.err == nil {
		return e.message
	}
	return e.message + ": " + e.err.Error()
}

func (e *revocationUnavailableError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.err
}

func newRevocationUnavailableError(message string, err error) error {
	return &revocationUnavailableError{
		message: message,
		err:     err,
	}
}

func IsSessionRevoked(err error) bool {
	return errors.Is(err, errSessionRevoked)
}

func IsRevocationUnavailable(err error) bool {
	var target *revocationUnavailableError
	return errors.As(err, &target)
}

// allowedAlgorithms lists the signing algorithms accepted by the validator.
// alg=none is explicitly rejected (K-AUTHN-002).
var allowedAlgorithms = []string{"RS256"}

type cachedSigningKey struct {
	alg       string
	publicKey crypto.PublicKey
}

type jwksDocument = realmv1.GetAuthJwksResponse
type jwkEntry = realmv1.GetAuthJwksResponseKeysItem

// Validator verifies JWT tokens using a configured JWKS endpoint.
type Validator struct {
	jwksURL       string
	issuer        string // expected iss claim; empty = skip check
	aud           string // expected aud claim; empty = skip check
	revocationURL string

	cacheTTL    time.Duration
	fallbackTTL time.Duration
	httpClient  *http.Client

	mu          sync.RWMutex
	signingKeys map[string]cachedSigningKey
	fetchedAt   time.Time
	refreshMu   sync.Mutex

	revocationCacheTTL time.Duration
	revocationMu       sync.Mutex
	revocationCache    map[string]cachedRevocation
	revocationFlights  map[string]*revocationFlight
}

type cachedRevocation struct {
	expiresAt time.Time
}

type revocationFlight struct {
	done chan struct{}
	err  error
}

type revocationRequest = realmv1.IntrospectSessionRequestDto

// NewValidator creates a JWT validator from configuration.
// If jwksURL is empty, returns a validator that rejects all tokens.
func NewValidator(jwksURL, issuer, audience string) (*Validator, error) {
	jwksURL = strings.TrimSpace(jwksURL)
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	if err := validateConfig(jwksURL, issuer, audience); err != nil {
		return nil, err
	}
	return &Validator{
		jwksURL:            jwksURL,
		issuer:             issuer,
		aud:                audience,
		cacheTTL:           defaultJWKSCacheTTL,
		fallbackTTL:        defaultJWKSFallbackTTL,
		revocationCacheTTL: defaultRevocationCacheTTL,
		httpClient: &http.Client{
			Timeout: defaultJWKSRequestTimeout,
		},
		signingKeys:       map[string]cachedSigningKey{},
		revocationCache:   map[string]cachedRevocation{},
		revocationFlights: map[string]*revocationFlight{},
	}, nil
}

// SetRevocationURL configures the optional session revocation endpoint used
// after successful JWT validation.
func (v *Validator) SetRevocationURL(rawURL string) {
	v.revocationMu.Lock()
	defer v.revocationMu.Unlock()
	v.revocationURL = strings.TrimSpace(rawURL)
	v.revocationCache = map[string]cachedRevocation{}
	v.revocationFlights = map[string]*revocationFlight{}
}

// Validate parses and verifies a JWT token string.
// Returns the identity on success, or an error on failure.
func (v *Validator) Validate(tokenString string) (*Identity, error) {
	return v.ValidateContext(context.Background(), tokenString)
}

// ValidateContext parses and verifies a JWT token string with caller cancellation.
func (v *Validator) ValidateContext(ctx context.Context, tokenString string) (*Identity, error) {
	if strings.TrimSpace(tokenString) == "" {
		return nil, errEmptyToken
	}
	if v.jwksURL == "" {
		return nil, fmt.Errorf("no jwks url configured")
	}

	parserOpts := []jwt.ParserOption{
		jwt.WithValidMethods(allowedAlgorithms),
		jwt.WithLeeway(clockSkew),
		jwt.WithExpirationRequired(),
		jwt.WithIssuedAt(),
	}
	if v.issuer != "" {
		parserOpts = append(parserOpts, jwt.WithIssuer(v.issuer))
	}
	if v.aud != "" {
		parserOpts = append(parserOpts, jwt.WithAudience(v.aud))
	}

	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		kid := strings.TrimSpace(headerString(t.Header, "kid"))
		if kid == "" {
			return nil, fmt.Errorf("token missing kid")
		}
		alg := strings.TrimSpace(headerString(t.Header, "alg"))
		if alg == "" {
			return nil, fmt.Errorf("token missing alg")
		}
		key, resolveErr := v.resolveSigningKey(ctx, kid, alg)
		if resolveErr != nil {
			return nil, resolveErr
		}
		return key, nil
	}, parserOpts...)
	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("unexpected claims type")
	}

	sub, _ := claims.GetSubject()
	if strings.TrimSpace(sub) == "" {
		return nil, fmt.Errorf("token missing sub claim")
	}
	iatUnix, err := numericDateClaim(claims["iat"])
	if err != nil {
		return nil, fmt.Errorf("token missing or invalid iat claim: %w", err)
	}
	expUnix, err := numericDateClaim(claims["exp"])
	if err != nil {
		return nil, fmt.Errorf("token missing or invalid exp claim: %w", err)
	}
	iatAt := time.Unix(iatUnix, 0)
	expAt := time.Unix(expUnix, 0)
	now := time.Now()
	if iatAt.After(now.Add(clockSkew)) {
		return nil, fmt.Errorf("token issued-at exceeds allowed clock skew")
	}
	if expAt.Sub(iatAt) > defaultJWTMaxLifetime {
		return nil, fmt.Errorf("token lifetime exceeds maximum allowed duration")
	}

	iss, _ := claims.GetIssuer()
	aud, _ := claims.GetAudience()
	sid, _ := claims["sid"].(string)

	identity := &Identity{
		SubjectUserID: sub,
		Issuer:        iss,
		SessionID:     sid,
		IssuedAt:      iatAt,
		ExpiresAt:     expAt,
	}
	if len(aud) > 0 {
		identity.Audience = aud[0]
	}
	if err := v.checkRevocation(ctx, identity); err != nil {
		return nil, err
	}
	return identity, nil
}

func (v *Validator) checkRevocation(ctx context.Context, identity *Identity) error {
	revocationURL := v.currentRevocationURL()
	if strings.TrimSpace(revocationURL) == "" {
		// K-AUTHN-006: revocationUrl shares the bearer JWT restart config group
		// with issuer/audience/jwksUrl. checkRevocation runs only after a token
		// has passed signature + claims validation, which requires an active
		// jwksUrl; an empty revocationUrl here means the config group is
		// incomplete and the bearer JWT chain must fail-close rather than admit
		// an unrevocable session.
		return errRevocationNotConfig
	}
	if identity == nil || strings.TrimSpace(identity.SessionID) == "" {
		return fmt.Errorf("token missing sid claim required for revocation")
	}
	payload := revocationRequest{
		SessionId:     identity.SessionID,
		SubjectUserId: identity.SubjectUserID,
		Issuer:        identity.Issuer,
		Audience:      identity.Audience,
		IssuedAt:      identity.IssuedAt.UTC().Format(time.RFC3339),
		ExpiresAt:     identity.ExpiresAt.UTC().Format(time.RFC3339),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode revocation request: %w", err)
	}

	cacheKey := revocationURL + "\n" + string(body)
	flight, started, err := v.beginRevocationCheck(ctx, cacheKey, time.Now())
	if !started {
		return err
	}
	responseExpiry, err := v.requestRevocation(ctx, revocationURL, body)
	v.finishRevocationCheck(cacheKey, flight, revocationCacheExpiry(time.Now(), v.revocationCacheTTL, identity, responseExpiry), err)
	return err
}

func (v *Validator) currentRevocationURL() string {
	v.revocationMu.Lock()
	defer v.revocationMu.Unlock()
	return v.revocationURL
}

func (v *Validator) beginRevocationCheck(ctx context.Context, cacheKey string, now time.Time) (*revocationFlight, bool, error) {
	v.revocationMu.Lock()
	if v.revocationCache == nil {
		v.revocationCache = map[string]cachedRevocation{}
	}
	if v.revocationFlights == nil {
		v.revocationFlights = map[string]*revocationFlight{}
	}
	if cached, ok := v.revocationCache[cacheKey]; ok {
		if cached.expiresAt.After(now) {
			v.revocationMu.Unlock()
			return nil, false, nil
		}
		delete(v.revocationCache, cacheKey)
	}
	if flight, ok := v.revocationFlights[cacheKey]; ok {
		v.revocationMu.Unlock()
		select {
		case <-flight.done:
			return nil, false, flight.err
		case <-ctx.Done():
			return nil, false, newRevocationUnavailableError("wait for revocation check", ctx.Err())
		}
	}
	flight := &revocationFlight{done: make(chan struct{})}
	v.revocationFlights[cacheKey] = flight
	v.revocationMu.Unlock()
	return flight, true, nil
}

func (v *Validator) finishRevocationCheck(cacheKey string, flight *revocationFlight, expiresAt time.Time, err error) {
	v.revocationMu.Lock()
	defer v.revocationMu.Unlock()
	if flight == nil {
		return
	}
	flight.err = err
	delete(v.revocationFlights, cacheKey)
	if err == nil && expiresAt.After(time.Now()) {
		v.revocationCache[cacheKey] = cachedRevocation{expiresAt: expiresAt}
	}
	close(flight.done)
}

func (v *Validator) requestRevocation(ctx context.Context, revocationURL string, body []byte) (time.Time, error) {
	req, err := http.NewRequestWithContext(ctx, realmv1.IntrospectSessionOperation.Method(), revocationURL, bytes.NewReader(body))
	if err != nil {
		return time.Time{}, fmt.Errorf("build revocation request: %w", err)
	}
	req.Header.Set("Content-Type", realmv1.IntrospectSessionOperation.RequestContentType())

	client := redirectRejectingHTTPClient(v.httpClient, defaultRevocationTimeout)
	resp, err := client.Do(req)
	if err != nil {
		return time.Time{}, newRevocationUnavailableError("request revocation endpoint", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != realmv1.IntrospectSessionOperation.SuccessStatus() {
		return time.Time{}, newRevocationUnavailableError(fmt.Sprintf("revocation endpoint returned status %d", resp.StatusCode), nil)
	}
	if !isJSONContentType(resp.Header.Get("Content-Type")) {
		return time.Time{}, newRevocationUnavailableError("revocation endpoint returned non-json content type", nil)
	}
	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxRevocationBodyBytes+1))
	if err != nil {
		return time.Time{}, newRevocationUnavailableError("read revocation response", err)
	}
	if len(payload) > maxRevocationBodyBytes {
		return time.Time{}, newRevocationUnavailableError("revocation response exceeds fixed bound", nil)
	}
	var result realmv1.IntrospectSessionResponseDto
	if err := jsonstrict.Decode(payload, &result); err != nil {
		return time.Time{}, newRevocationUnavailableError("decode revocation response", err)
	}
	var required map[string]json.RawMessage
	if err := json.Unmarshal(payload, &required); err != nil || required["active"] == nil || required["revoked"] == nil {
		return time.Time{}, newRevocationUnavailableError("revocation response missing active or revoked", nil)
	}
	if result.Revoked || !result.Active {
		return time.Time{}, errSessionRevoked
	}
	var responseExpiry time.Time
	if expiry := strings.TrimSpace(result.ExpiresAt); expiry != "" {
		parsed, err := time.Parse(time.RFC3339, expiry)
		if err != nil {
			return time.Time{}, newRevocationUnavailableError("invalid revocation response expires_at", err)
		}
		responseExpiry = parsed
	}
	return responseExpiry, nil
}

func isJSONContentType(value string) bool {
	mediaType, _, err := mime.ParseMediaType(strings.TrimSpace(value))
	if err != nil {
		return false
	}
	return mediaType == "application/json"
}

func revocationCacheExpiry(now time.Time, ttl time.Duration, identity *Identity, responseExpiry time.Time) time.Time {
	if ttl <= 0 || identity == nil {
		return time.Time{}
	}
	expiresAt := now.Add(ttl)
	if !identity.ExpiresAt.IsZero() && identity.ExpiresAt.Before(expiresAt) {
		expiresAt = identity.ExpiresAt
	}
	if !responseExpiry.IsZero() && responseExpiry.Before(expiresAt) {
		expiresAt = responseExpiry
	}
	if !expiresAt.After(now) {
		return time.Time{}
	}
	return expiresAt
}

func (v *Validator) resolveSigningKey(ctx context.Context, kid, tokenAlg string) (crypto.PublicKey, error) {
	if key, fetchedAt, ok := v.cacheLookup(kid); ok {
		age := time.Since(fetchedAt)
		if age <= v.cacheTTL {
			if err := ensureAlgorithmCompatibility(tokenAlg, key); err != nil {
				return nil, err
			}
			return key.publicKey, nil
		}
		// Re-fetch stale keys before use. refreshJWKS() coalesces refreshes
		// within refreshCoalesceWindow for the same kid, so concurrent validators
		// do not stampede the JWKS endpoint even though this lookup happens
		// outside the cache read lock.
		if err := v.refreshJWKS(ctx, kid); err != nil {
			if age <= v.cacheTTL+v.fallbackTTL {
				if compatErr := ensureAlgorithmCompatibility(tokenAlg, key); compatErr == nil {
					return key.publicKey, nil
				}
			}
			return nil, fmt.Errorf("refresh jwks for stale key %q: %w", kid, err)
		}
		if refreshed, _, refreshedOK := v.cacheLookup(kid); refreshedOK {
			if err := ensureAlgorithmCompatibility(tokenAlg, refreshed); err != nil {
				return nil, err
			}
			return refreshed.publicKey, nil
		}
		return nil, fmt.Errorf("signing key not found for kid %q", kid)
	}

	if err := v.refreshJWKS(ctx, kid); err != nil {
		return nil, fmt.Errorf("refresh jwks for missing kid %q: %w", kid, err)
	}
	refreshed, _, ok := v.cacheLookup(kid)
	if !ok {
		return nil, fmt.Errorf("signing key not found for kid %q", kid)
	}
	if err := ensureAlgorithmCompatibility(tokenAlg, refreshed); err != nil {
		return nil, err
	}
	return refreshed.publicKey, nil
}

func (v *Validator) cacheLookup(kid string) (cachedSigningKey, time.Time, bool) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	key, ok := v.signingKeys[kid]
	return key, v.fetchedAt, ok
}

func (v *Validator) refreshJWKS(ctx context.Context, requiredKid string) error {
	v.refreshMu.Lock()
	defer v.refreshMu.Unlock()

	v.mu.RLock()
	cached := len(v.signingKeys) > 0
	fetchedAt := v.fetchedAt
	_, hasRequiredKid := v.signingKeys[requiredKid]
	v.mu.RUnlock()
	if cached && !fetchedAt.IsZero() && time.Since(fetchedAt) <= refreshCoalesceWindow && hasRequiredKid {
		return nil
	}

	req, err := http.NewRequestWithContext(ctx, realmv1.GetAuthJwksOperation.Method(), v.jwksURL, nil)
	if err != nil {
		return fmt.Errorf("build jwks request: %w", err)
	}
	resp, err := redirectRejectingHTTPClient(v.httpClient, defaultJWKSRequestTimeout).Do(req)
	if err != nil {
		return fmt.Errorf("request jwks endpoint: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxJWKSBodyBytes))
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != realmv1.GetAuthJwksOperation.SuccessStatus() {
		return fmt.Errorf("jwks endpoint returned status %d", resp.StatusCode)
	}
	if !isJSONContentType(resp.Header.Get("Content-Type")) {
		return fmt.Errorf("jwks endpoint returned non-json content type")
	}

	payload, err := io.ReadAll(io.LimitReader(resp.Body, maxJWKSBodyBytes+1))
	if err != nil {
		return fmt.Errorf("read jwks response: %w", err)
	}
	if len(payload) > maxJWKSBodyBytes {
		return fmt.Errorf("jwks response exceeds fixed bound")
	}
	var document jwksDocument
	if err := jsonstrict.Decode(payload, &document); err != nil {
		return fmt.Errorf("decode jwks response: %w", err)
	}
	parsedKeys, err := parseJWKSDocument(document)
	if err != nil {
		return err
	}
	if len(parsedKeys) == 0 {
		return fmt.Errorf("jwks response has no usable signing keys")
	}

	v.mu.Lock()
	// Replace the cache atomically with the newly parsed JWKS document. Keeping
	// the cache as a single coherent snapshot avoids mixing keys from different
	// rotations and preserves deterministic validation semantics for each fetch.
	v.signingKeys = parsedKeys
	v.fetchedAt = time.Now()
	v.mu.Unlock()
	return nil
}

func redirectRejectingHTTPClient(client *http.Client, fallbackTimeout time.Duration) *http.Client {
	if client == nil {
		client = &http.Client{Timeout: fallbackTimeout}
	}
	copy := *client
	copy.CheckRedirect = func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &copy
}

func parseJWKSDocument(document jwksDocument) (map[string]cachedSigningKey, error) {
	parsed := make(map[string]cachedSigningKey, len(document.Keys))
	for _, entry := range document.Keys {
		kid := strings.TrimSpace(entry.Kid)
		if kid == "" {
			continue
		}
		if use := strings.TrimSpace(entry.Use); use != "" && use != "sig" {
			continue
		}

		publicKey, err := parseJWKPublicKey(entry)
		if err != nil {
			return nil, fmt.Errorf("parse jwk key %q: %w", kid, err)
		}
		parsed[kid] = cachedSigningKey{
			alg:       strings.TrimSpace(entry.Alg),
			publicKey: publicKey,
		}
	}
	return parsed, nil
}

func parseJWKPublicKey(entry jwkEntry) (crypto.PublicKey, error) {
	switch strings.TrimSpace(entry.Kty) {
	case "RSA":
		return parseRSAJWK(entry)
	default:
		return nil, fmt.Errorf("unsupported jwk kty=%q", entry.Kty)
	}
}

func parseRSAJWK(entry jwkEntry) (crypto.PublicKey, error) {
	if strings.TrimSpace(entry.N) == "" || strings.TrimSpace(entry.E) == "" {
		return nil, fmt.Errorf("rsa jwk missing modulus or exponent")
	}
	nBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(entry.N))
	if err != nil {
		return nil, fmt.Errorf("decode rsa modulus: %w", err)
	}
	eBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(entry.E))
	if err != nil {
		return nil, fmt.Errorf("decode rsa exponent: %w", err)
	}
	maxPlatformInt := int64(^uint(0) >> 1)
	var exponent int64
	for _, b := range eBytes {
		if exponent > (maxPlatformInt-int64(b))/256 {
			return nil, fmt.Errorf("rsa exponent overflows platform int")
		}
		exponent = exponent<<8 + int64(b)
	}
	if exponent <= 0 {
		return nil, fmt.Errorf("invalid rsa exponent")
	}
	modulus := new(big.Int).SetBytes(nBytes)
	if modulus.BitLen() < minimumRSAKeyBits {
		return nil, fmt.Errorf("rsa modulus too small")
	}
	return &rsa.PublicKey{
		N: modulus,
		E: int(exponent),
	}, nil
}

func ensureAlgorithmCompatibility(tokenAlg string, key cachedSigningKey) error {
	if strings.TrimSpace(key.alg) != "" && strings.TrimSpace(key.alg) != tokenAlg {
		return fmt.Errorf("jwk alg mismatch: token=%s jwk=%s", tokenAlg, key.alg)
	}
	switch tokenAlg {
	case "RS256":
		if _, ok := key.publicKey.(*rsa.PublicKey); !ok {
			return fmt.Errorf("key type mismatch: token uses RSA but key is not RSA")
		}
		return nil
	default:
		return fmt.Errorf("unsupported signing method: %s", tokenAlg)
	}
}

func headerString(header map[string]any, key string) string {
	value, ok := header[key]
	if !ok {
		return ""
	}
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return fmt.Sprintf("%v", typed)
	}
}

func numericDateClaim(value any) (int64, error) {
	switch typed := value.(type) {
	case nil:
		return 0, fmt.Errorf("missing claim")
	case float64:
		return int64(typed), nil
	case float32:
		return int64(typed), nil
	case int64:
		return typed, nil
	case int32:
		return int64(typed), nil
	case int:
		return int64(typed), nil
	case json.Number:
		parsed, err := typed.Int64()
		if err != nil {
			return 0, fmt.Errorf("invalid numeric date: %w", err)
		}
		return parsed, nil
	default:
		return 0, fmt.Errorf("invalid numeric date type %T", value)
	}
}

// ValidateConfigGroup enforces the K-AUTHN-006 all-or-nothing bearer JWT
// restart config group: jwksUrl, issuer, audience, and revocationUrl must be
// supplied together or omitted together. A partial group fails closed so that
// no active JWT chain can run without a configured revocation endpoint.
func ValidateConfigGroup(jwksURL, issuer, audience, revocationURL string) error {
	jwksURL = strings.TrimSpace(jwksURL)
	issuer = strings.TrimSpace(issuer)
	audience = strings.TrimSpace(audience)
	revocationURL = strings.TrimSpace(revocationURL)
	if jwksURL == "" && issuer == "" && audience == "" && revocationURL == "" {
		return nil
	}
	if jwksURL == "" || issuer == "" || audience == "" || revocationURL == "" {
		return fmt.Errorf("jwt auth config requires issuer, audience, jwks url, and revocation url together")
	}
	return validateConfig(jwksURL, issuer, audience)
}

func validateConfig(jwksURL, issuer, audience string) error {
	if jwksURL == "" && issuer == "" && audience == "" {
		return nil
	}
	if jwksURL == "" || issuer == "" || audience == "" {
		return fmt.Errorf("jwt auth config requires issuer, audience, and jwks url together")
	}
	parsed, err := url.Parse(jwksURL)
	if err != nil {
		return fmt.Errorf("auth jwt jwks url invalid: %w", err)
	}
	host := strings.TrimSpace(strings.ToLower(parsed.Hostname()))
	if host == "" {
		return fmt.Errorf("auth jwt jwks url must include host")
	}
	if parsed.Scheme == "https" {
		return nil
	}
	if parsed.Scheme == "http" && isLoopbackHost(host) {
		return nil
	}
	return fmt.Errorf("auth jwt jwks url must use https unless host is loopback")
}

func isLoopbackHost(host string) bool {
	host = strings.TrimSpace(strings.ToLower(host))
	if host == "" {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
