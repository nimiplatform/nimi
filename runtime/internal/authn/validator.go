package authn

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// clockSkew is the maximum allowed clock skew for JWT validation (K-AUTHN-005).
const clockSkew = 60 * time.Second

const (
	defaultJWKSCacheTTL       = 5 * time.Minute
	defaultJWKSFallbackTTL    = 2 * time.Minute
	defaultJWKSRequestTimeout = 5 * time.Second
	defaultRevocationTimeout  = 5 * time.Second
	refreshCoalesceWindow     = 1 * time.Second
	maxJWKSBodyBytes          = 1 << 20
	maxRevocationBodyBytes    = 1 << 20
	minimumRSAKeyBits         = 2048
	defaultJWTMaxLifetime     = 24 * time.Hour
)

var errEmptyToken = errors.New("empty token")

// allowedAlgorithms lists the signing algorithms accepted by the validator.
// alg=none is explicitly rejected (K-AUTHN-002).
var allowedAlgorithms = []string{"RS256", "ES256"}

type cachedSigningKey struct {
	alg       string
	publicKey crypto.PublicKey
}

type jwksDocument struct {
	Keys []jwkEntry `json:"keys"`
}

type jwkEntry struct {
	Kid string `json:"kid"`
	Kty string `json:"kty"`
	Use string `json:"use"`
	Alg string `json:"alg"`
	N   string `json:"n"`
	E   string `json:"e"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
}

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
}

type revocationRequest struct {
	SessionID     string `json:"session_id"`
	SubjectUserID string `json:"subject_user_id"`
	Issuer        string `json:"issuer"`
	Audience      string `json:"audience"`
	IssuedAt      string `json:"issued_at"`
	ExpiresAt     string `json:"expires_at"`
}

type revocationResponse struct {
	Active    bool   `json:"active"`
	Revoked   bool   `json:"revoked"`
	ExpiresAt string `json:"expires_at,omitempty"`
}

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
		jwksURL:     jwksURL,
		issuer:      issuer,
		aud:         audience,
		cacheTTL:    defaultJWKSCacheTTL,
		fallbackTTL: defaultJWKSFallbackTTL,
		httpClient: &http.Client{
			Timeout: defaultJWKSRequestTimeout,
		},
		signingKeys: map[string]cachedSigningKey{},
	}, nil
}

// SetRevocationURL configures the optional session revocation endpoint used
// after successful JWT validation.
func (v *Validator) SetRevocationURL(rawURL string) {
	v.revocationURL = strings.TrimSpace(rawURL)
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
	if identity == nil || strings.TrimSpace(identity.SessionID) == "" || strings.TrimSpace(v.revocationURL) == "" {
		return nil
	}
	payload := revocationRequest{
		SessionID:     identity.SessionID,
		SubjectUserID: identity.SubjectUserID,
		Issuer:        identity.Issuer,
		Audience:      identity.Audience,
		IssuedAt:      identity.IssuedAt.UTC().Format(time.RFC3339),
		ExpiresAt:     identity.ExpiresAt.UTC().Format(time.RFC3339),
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("encode revocation request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, v.revocationURL, strings.NewReader(string(body)))
	if err != nil {
		return fmt.Errorf("build revocation request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	client := v.httpClient
	if client == nil {
		client = &http.Client{Timeout: defaultRevocationTimeout}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("request revocation endpoint: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("revocation endpoint returned status %d", resp.StatusCode)
	}
	limited := io.LimitReader(resp.Body, maxRevocationBodyBytes)
	var result revocationResponse
	if err := json.NewDecoder(limited).Decode(&result); err != nil {
		return fmt.Errorf("decode revocation response: %w", err)
	}
	if result.Revoked || !result.Active {
		return fmt.Errorf("session revoked")
	}
	if expiry := strings.TrimSpace(result.ExpiresAt); expiry != "" {
		if _, err := time.Parse(time.RFC3339, expiry); err != nil {
			return fmt.Errorf("invalid revocation response expires_at: %w", err)
		}
	}
	return nil
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

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, v.jwksURL, nil)
	if err != nil {
		return fmt.Errorf("build jwks request: %w", err)
	}
	resp, err := v.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("request jwks endpoint: %w", err)
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, maxJWKSBodyBytes))
		_ = resp.Body.Close()
	}()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("jwks endpoint returned status %d", resp.StatusCode)
	}

	var document jwksDocument
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxJWKSBodyBytes)).Decode(&document); err != nil {
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
	case "EC":
		return parseECJWK(entry)
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

func parseECJWK(entry jwkEntry) (crypto.PublicKey, error) {
	if strings.TrimSpace(entry.Crv) != "P-256" {
		return nil, fmt.Errorf("unsupported ec curve %q", entry.Crv)
	}
	xBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(entry.X))
	if err != nil {
		return nil, fmt.Errorf("decode ec x: %w", err)
	}
	yBytes, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(entry.Y))
	if err != nil {
		return nil, fmt.Errorf("decode ec y: %w", err)
	}
	curve := elliptic.P256()
	x := new(big.Int).SetBytes(xBytes)
	y := new(big.Int).SetBytes(yBytes)
	if !curve.IsOnCurve(x, y) {
		return nil, fmt.Errorf("ec point not on curve")
	}
	return &ecdsa.PublicKey{
		Curve: curve,
		X:     x,
		Y:     y,
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
	case "ES256":
		if _, ok := key.publicKey.(*ecdsa.PublicKey); !ok {
			return fmt.Errorf("key type mismatch: token uses ECDSA but key is not ECDSA")
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
