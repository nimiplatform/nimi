package runtimeagent

import (
	"context"
	"crypto"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	sourceMaterializationKeyPurpose   = "realm-source-materialization"
	sourceMaterializationJWKSPath     = "/api/auth/jwks/source-materialization"
	sourceMaterializationJWKSMaxBytes = 64 * 1024
)

type sourceMaterializationJWK struct {
	KeyID     string `json:"kid"`
	Use       string `json:"use"`
	Algorithm string `json:"alg"`
	KeyType   string `json:"kty"`
	Modulus   string `json:"n"`
	Exponent  string `json:"e"`
	Purpose   string `json:"purpose"`

	// Rotation metadata is Runtime-owned fetch state, never accepted as an
	// extension of the closed Realm JWKS document.
	notBefore   time.Time
	retireAfter time.Time
	revoked     bool
}

type sourceMaterializationJWKSDocument struct {
	Keys   []sourceMaterializationJWK `json:"keys"`
	Issuer string                     `json:"-"`
}

type sourceMaterializationJWKSProvider interface {
	SourceMaterializationJWKS(ctx context.Context, issuer string, refresh bool) (sourceMaterializationJWKSDocument, error)
}

type sourceMaterializationJWKSFetcher func(ctx context.Context, jwksURL string, refresh bool) ([]byte, error)

// SourceMaterializationAdmissionVerifier is the dedicated Realm packet-v2
// issuer/JWKS verifier. It deliberately shares no bearer-JWT key cache.
type SourceMaterializationAdmissionVerifier struct {
	expectedIssuer string
	jwksURL        string
	fetch          sourceMaterializationJWKSFetcher
}

func NewSourceMaterializationAdmissionVerifier(expectedIssuer string, jwksURL string, client *http.Client) (*SourceMaterializationAdmissionVerifier, error) {
	if client == nil {
		client = &http.Client{}
	}
	securedClient := *client
	if securedClient.Timeout == 0 {
		securedClient.Timeout = 10 * time.Second
	}
	if securedClient.CheckRedirect == nil {
		securedClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
			return fmt.Errorf("source materialization JWKS redirects are not admitted")
		}
	}
	fetcher := func(ctx context.Context, endpoint string, _ bool) ([]byte, error) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
		if err != nil {
			return nil, fmt.Errorf("create source materialization JWKS request: %w", err)
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Cache-Control", "no-cache, no-store")
		request.Header.Set("Pragma", "no-cache")
		response, err := securedClient.Do(request)
		if err != nil {
			return nil, fmt.Errorf("fetch source materialization JWKS: %w", err)
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			return nil, fmt.Errorf("fetch source materialization JWKS: unexpected status %d", response.StatusCode)
		}
		contentType := strings.ToLower(strings.TrimSpace(strings.Split(response.Header.Get("Content-Type"), ";")[0]))
		if contentType != "application/json" && !strings.HasSuffix(contentType, "+json") {
			_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
			return nil, fmt.Errorf("fetch source materialization JWKS: response is not JSON")
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, sourceMaterializationJWKSMaxBytes+1))
		if err != nil {
			return nil, fmt.Errorf("read source materialization JWKS: %w", err)
		}
		if len(body) > sourceMaterializationJWKSMaxBytes {
			return nil, fmt.Errorf("source materialization JWKS exceeds bounded size")
		}
		return body, nil
	}
	return newSourceMaterializationAdmissionVerifierWithFetcher(expectedIssuer, jwksURL, fetcher)
}

func newSourceMaterializationAdmissionVerifierWithFetcher(expectedIssuer string, jwksURL string, fetch sourceMaterializationJWKSFetcher) (*SourceMaterializationAdmissionVerifier, error) {
	expectedIssuer = strings.TrimSpace(expectedIssuer)
	if expectedIssuer == "" {
		return nil, fmt.Errorf("source materialization expected Realm issuer is required")
	}
	parsed, err := url.Parse(jwksURL)
	if err != nil || parsed.Host == "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, fmt.Errorf("source materialization JWKS URL is invalid")
	}
	if parsed.Path != sourceMaterializationJWKSPath {
		return nil, fmt.Errorf("source materialization JWKS URL must use %s", sourceMaterializationJWKSPath)
	}
	if parsed.Scheme != "https" && !(parsed.Scheme == "http" && isSourceMaterializationLoopbackHost(parsed.Hostname())) {
		return nil, fmt.Errorf("source materialization JWKS URL must use HTTPS outside loopback")
	}
	if fetch == nil {
		return nil, fmt.Errorf("source materialization JWKS fetcher is required")
	}
	return &SourceMaterializationAdmissionVerifier{expectedIssuer: expectedIssuer, jwksURL: parsed.String(), fetch: fetch}, nil
}

func isSourceMaterializationLoopbackHost(host string) bool {
	host = strings.Trim(strings.ToLower(host), "[]")
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (v *SourceMaterializationAdmissionVerifier) SourceMaterializationJWKS(ctx context.Context, issuer string, refresh bool) (sourceMaterializationJWKSDocument, error) {
	if v == nil || v.fetch == nil {
		return sourceMaterializationJWKSDocument{}, fmt.Errorf("source materialization verifier is not configured")
	}
	if subtle.ConstantTimeCompare([]byte(issuer), []byte(v.expectedIssuer)) != 1 {
		return sourceMaterializationJWKSDocument{}, sourceMaterializationDenied("Realm issuer is not admitted")
	}
	raw, err := v.fetch(ctx, v.jwksURL, refresh)
	if err != nil {
		return sourceMaterializationJWKSDocument{}, err
	}
	var document sourceMaterializationJWKSDocument
	if err := strictDecodeSourceMaterializationJSON(raw, &document); err != nil {
		return sourceMaterializationJWKSDocument{}, fmt.Errorf("decode source materialization JWKS: %w", err)
	}
	if document.Keys == nil {
		return sourceMaterializationJWKSDocument{}, fmt.Errorf("source materialization JWKS keys are required")
	}
	document.Issuer = v.expectedIssuer
	return document, nil
}

type sourceMaterializationProtectedHeader struct {
	Algorithm string `json:"alg"`
	KeyID     string `json:"kid"`
	Type      string `json:"typ"`
}

func verifySourceMaterializationDetachedProof(
	ctx context.Context,
	provider sourceMaterializationJWKSProvider,
	envelope sourceMaterializationPacketEnvelopeV2,
	packetHash string,
	proof string,
	now time.Time,
) (string, error) {
	if provider == nil {
		return "", statusSourceMaterializationVerifierUnavailable()
	}
	if len(proof) == 0 || len(proof) > 16*1024 {
		return "", sourceMaterializationDenied("packetProof exceeds its bounded compact size")
	}
	parts := strings.Split(proof, ".")
	if len(parts) != 3 || parts[0] == "" || parts[1] != "" || parts[2] == "" {
		return "", sourceMaterializationDenied("packetProof must be detached compact JWS")
	}
	if len(parts[0]) > 2048 || len(parts[2]) > 4096 {
		return "", sourceMaterializationDenied("packetProof segment exceeds its bounded size")
	}
	headerBytes, err := decodeSourceMaterializationBase64URL(parts[0], "packetProof protected header")
	if err != nil {
		return "", sourceMaterializationDenied("packetProof protected header is invalid")
	}
	var header sourceMaterializationProtectedHeader
	if err := strictDecodeSourceMaterializationJSON(headerBytes, &header); err != nil {
		return "", sourceMaterializationDenied("packetProof protected header is not closed")
	}
	if header.Algorithm != "RS256" || header.KeyID != envelope.KeyID || header.Type != sourceMaterializationKeyPurpose {
		return "", sourceMaterializationDenied("packetProof protected header is not admitted")
	}
	signature, err := decodeSourceMaterializationBase64URL(parts[2], "packetProof signature")
	if err != nil {
		return "", sourceMaterializationDenied("packetProof signature is invalid")
	}
	document, err := provider.SourceMaterializationJWKS(ctx, envelope.Issuer, false)
	if err != nil {
		return "", err
	}
	key, found, err := selectSourceMaterializationJWK(document, envelope.Issuer, envelope.KeyID, now)
	if err != nil {
		return "", err
	}
	if !found {
		// Exactly one controlled refresh is allowed, and only for an unknown kid.
		document, err = provider.SourceMaterializationJWKS(ctx, envelope.Issuer, true)
		if err != nil {
			return "", err
		}
		key, found, err = selectSourceMaterializationJWK(document, envelope.Issuer, envelope.KeyID, now)
		if err != nil {
			return "", err
		}
		if !found {
			return "", sourceMaterializationDenied("packetProof key id is unknown or revoked")
		}
	}
	publicKey, err := rsaPublicKeyFromSourceMaterializationJWK(key)
	if err != nil {
		return "", sourceMaterializationDenied("packetProof JWK is invalid")
	}
	payload := base64.RawURLEncoding.EncodeToString([]byte(sourceMaterializationProofDomain + packetHash))
	signingInput := []byte(parts[0] + "." + payload)
	digest := sha256.Sum256(signingInput)
	if err := rsa.VerifyPKCS1v15(publicKey, crypto.SHA256, digest[:], signature); err != nil {
		return "", sourceMaterializationDenied("packetProof signature mismatch")
	}
	fingerprint, err := hashSourceMaterializationDomainJCS("nimi.realm.source-materialization-key/v1\x00", map[string]any{
		"kty": key.KeyType, "n": key.Modulus, "e": key.Exponent,
	})
	if err != nil {
		return "", sourceMaterializationDenied("packetProof key fingerprint failed")
	}
	return fingerprint, nil
}

func statusSourceMaterializationVerifierUnavailable() error {
	return sourceMaterializationDenied("materialization-purpose verifier is not configured")
}

func selectSourceMaterializationJWK(document sourceMaterializationJWKSDocument, issuer string, kid string, now time.Time) (sourceMaterializationJWK, bool, error) {
	if document.Issuer != issuer {
		return sourceMaterializationJWK{}, false, sourceMaterializationDenied("JWKS issuer binding mismatch")
	}
	seen := make(map[string]struct{}, len(document.Keys))
	var selected sourceMaterializationJWK
	found := false
	for index, key := range document.Keys {
		if err := validateSourceMaterializationJWK(key, index); err != nil {
			return sourceMaterializationJWK{}, false, err
		}
		if _, duplicate := seen[key.KeyID]; duplicate {
			return sourceMaterializationJWK{}, false, sourceMaterializationDenied("JWKS contains duplicate kid")
		}
		seen[key.KeyID] = struct{}{}
		if key.KeyID != kid {
			continue
		}
		if key.revoked || (!key.notBefore.IsZero() && now.Before(key.notBefore)) || (!key.retireAfter.IsZero() && !now.Before(key.retireAfter)) {
			return sourceMaterializationJWK{}, false, sourceMaterializationDenied("packetProof key is revoked or outside its verification window")
		}
		selected = key
		found = true
	}
	return selected, found, nil
}

func validateSourceMaterializationJWK(key sourceMaterializationJWK, index int) error {
	if err := requireMaterializationText(key.KeyID, fmt.Sprintf("JWKS.keys[%d].kid", index)); err != nil {
		return sourceMaterializationDenied("JWKS key id is invalid")
	}
	if key.Use != "sig" || key.Algorithm != "RS256" || key.KeyType != "RSA" || key.Purpose != sourceMaterializationKeyPurpose {
		return sourceMaterializationDenied("JWKS key is not materialization-purpose RS256 sig")
	}
	if _, err := decodeSourceMaterializationBase64URL(key.Modulus, "JWKS modulus"); err != nil {
		return sourceMaterializationDenied("JWKS modulus is invalid")
	}
	if _, err := decodeSourceMaterializationBase64URL(key.Exponent, "JWKS exponent"); err != nil {
		return sourceMaterializationDenied("JWKS exponent is invalid")
	}
	return nil
}

func rsaPublicKeyFromSourceMaterializationJWK(key sourceMaterializationJWK) (*rsa.PublicKey, error) {
	modulusBytes, err := base64.RawURLEncoding.Strict().DecodeString(key.Modulus)
	if err != nil || len(modulusBytes) == 0 || modulusBytes[0] == 0 {
		return nil, fmt.Errorf("invalid RSA modulus")
	}
	exponentBytes, err := base64.RawURLEncoding.Strict().DecodeString(key.Exponent)
	if err != nil || len(exponentBytes) == 0 || len(exponentBytes) > 4 || exponentBytes[0] == 0 {
		return nil, fmt.Errorf("invalid RSA exponent")
	}
	exponent := new(big.Int).SetBytes(exponentBytes)
	if !exponent.IsInt64() {
		return nil, fmt.Errorf("RSA exponent out of range")
	}
	exponent64 := exponent.Int64()
	if exponent64 < 3 || exponent64 > int64(^uint(0)>>1) || exponent64%2 == 0 {
		return nil, fmt.Errorf("RSA exponent is not admitted")
	}
	modulus := new(big.Int).SetBytes(modulusBytes)
	if modulus.BitLen() < 2048 || modulus.BitLen() > 8192 {
		return nil, fmt.Errorf("RSA modulus size is not admitted")
	}
	return &rsa.PublicKey{N: modulus, E: int(exponent64)}, nil
}

// MarshalJSON deliberately excludes Runtime-only rotation fields.
func (key sourceMaterializationJWK) MarshalJSON() ([]byte, error) {
	type wire struct {
		KeyID     string `json:"kid"`
		Use       string `json:"use"`
		Algorithm string `json:"alg"`
		KeyType   string `json:"kty"`
		Modulus   string `json:"n"`
		Exponent  string `json:"e"`
		Purpose   string `json:"purpose"`
	}
	return json.Marshal(wire{key.KeyID, key.Use, key.Algorithm, key.KeyType, key.Modulus, key.Exponent, key.Purpose})
}

func parseSourceMaterializationExponent(raw string) (int, error) {
	bytesValue, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil || len(bytesValue) == 0 {
		return 0, fmt.Errorf("invalid exponent")
	}
	value := new(big.Int).SetBytes(bytesValue)
	parsed, err := strconv.ParseInt(value.String(), 10, 32)
	if err != nil {
		return 0, fmt.Errorf("invalid exponent")
	}
	return int(parsed), nil
}
