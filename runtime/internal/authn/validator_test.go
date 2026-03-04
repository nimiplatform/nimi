package authn

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type jwksTestServer struct {
	t        *testing.T
	server   *httptest.Server
	mu       sync.Mutex
	document jwksDocument
	status   int
	hits     int
}

func newJWKSTestServer(t *testing.T, document jwksDocument) *jwksTestServer {
	t.Helper()
	s := &jwksTestServer{
		t:        t,
		document: document,
		status:   http.StatusOK,
	}
	s.server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		s.mu.Lock()
		s.hits++
		status := s.status
		doc := s.document
		s.mu.Unlock()

		if status != http.StatusOK {
			w.WriteHeader(status)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		if err := json.NewEncoder(w).Encode(doc); err != nil {
			t.Fatalf("encode jwks response: %v", err)
		}
	}))
	return s
}

func (s *jwksTestServer) Close() {
	s.server.Close()
}

func (s *jwksTestServer) URL() string {
	return s.server.URL
}

func (s *jwksTestServer) SetDocument(document jwksDocument) {
	s.mu.Lock()
	s.document = document
	s.mu.Unlock()
}

func (s *jwksTestServer) SetStatus(status int) {
	s.mu.Lock()
	s.status = status
	s.mu.Unlock()
}

func (s *jwksTestServer) HitCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.hits
}

func generateRSAKey(t *testing.T) *rsa.PrivateKey {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	return privateKey
}

func generateECKey(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate ECDSA key: %v", err)
	}
	return privateKey
}

func rsaJWKFromPrivateKey(t *testing.T, key *rsa.PrivateKey, kid string) jwkEntry {
	t.Helper()
	return jwkEntry{
		Kid: kid,
		Kty: "RSA",
		Use: "sig",
		Alg: "RS256",
		N:   base64.RawURLEncoding.EncodeToString(key.PublicKey.N.Bytes()),
		E:   base64.RawURLEncoding.EncodeToString(big.NewInt(int64(key.PublicKey.E)).Bytes()),
	}
}

func ecJWKFromPrivateKey(t *testing.T, key *ecdsa.PrivateKey, kid string) jwkEntry {
	t.Helper()
	return jwkEntry{
		Kid: kid,
		Kty: "EC",
		Use: "sig",
		Alg: "ES256",
		Crv: "P-256",
		X:   base64.RawURLEncoding.EncodeToString(key.PublicKey.X.Bytes()),
		Y:   base64.RawURLEncoding.EncodeToString(key.PublicKey.Y.Bytes()),
	}
}

func signRS256(t *testing.T, key *rsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	if strings.TrimSpace(kid) != "" {
		token.Header["kid"] = kid
	}
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign RS256 token: %v", err)
	}
	return signed
}

func signES256(t *testing.T, key *ecdsa.PrivateKey, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	if strings.TrimSpace(kid) != "" {
		token.Header["kid"] = kid
	}
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign ES256 token: %v", err)
	}
	return signed
}

func signHS256(t *testing.T, secret string, kid string, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	if strings.TrimSpace(kid) != "" {
		token.Header["kid"] = kid
	}
	signed, err := token.SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign HS256 token: %v", err)
	}
	return signed
}

func validClaims() jwt.MapClaims {
	now := time.Now()
	return jwt.MapClaims{
		"sub": "user-123",
		"iss": "test-issuer",
		"aud": "test-audience",
		"exp": now.Add(1 * time.Hour).Unix(),
		"iat": now.Unix(),
		"nbf": now.Unix(),
		"sid": "session-abc",
	}
}

func TestValidateRS256ValidTokenWithJWKS(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	token := signRS256(t, key, "kid-1", validClaims())
	identity, err := validator.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if identity == nil {
		t.Fatal("expected identity")
	}
	if identity.SubjectUserID != "user-123" {
		t.Fatalf("subject mismatch: %q", identity.SubjectUserID)
	}
	if identity.Issuer != "test-issuer" {
		t.Fatalf("issuer mismatch: %q", identity.Issuer)
	}
	if identity.Audience != "test-audience" {
		t.Fatalf("audience mismatch: %q", identity.Audience)
	}
	if identity.SessionID != "session-abc" {
		t.Fatalf("session mismatch: %q", identity.SessionID)
	}
	if server.HitCount() != 1 {
		t.Fatalf("expected one jwks request, got %d", server.HitCount())
	}
}

func TestValidateES256ValidTokenWithJWKS(t *testing.T) {
	key := generateECKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{ecJWKFromPrivateKey(t, key, "ec-kid")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	token := signES256(t, key, "ec-kid", validClaims())
	identity, err := validator.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if identity == nil || identity.SubjectUserID != "user-123" {
		t.Fatalf("identity mismatch: %#v", identity)
	}
}

func TestValidateKidMissTriggersRefreshAndPasses(t *testing.T) {
	key1 := generateRSAKey(t)
	key2 := generateRSAKey(t)

	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key1, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	firstToken := signRS256(t, key1, "kid-1", validClaims())
	if _, err := validator.Validate(firstToken); err != nil {
		t.Fatalf("first Validate should pass: %v", err)
	}

	server.SetDocument(jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key2, "kid-2")}})

	secondToken := signRS256(t, key2, "kid-2", validClaims())
	if _, err := validator.Validate(secondToken); err != nil {
		t.Fatalf("second Validate after kid miss refresh should pass: %v", err)
	}

	if server.HitCount() < 2 {
		t.Fatalf("expected at least two jwks requests, got %d", server.HitCount())
	}
}

func TestValidateMissingJWKSURLRejectsToken(t *testing.T) {
	key := generateRSAKey(t)
	validator, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	token := signRS256(t, key, "kid-1", validClaims())
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected validation error")
	}
	if !strings.Contains(err.Error(), "no jwks url configured") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateMissingKidRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	token := signRS256(t, key, "", validClaims())
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected missing kid error")
	}
}

func TestValidateUnsupportedAlgorithmRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	token := signHS256(t, "secret", "kid-1", validClaims())
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected unsupported algorithm error")
	}
}

func TestValidateWrongIssuerRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "expected-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	claims["iss"] = "wrong-issuer"
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected issuer validation failure")
	}
}

func TestValidateWrongAudienceRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "expected-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	claims["aud"] = "wrong-audience"
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected audience validation failure")
	}
}

func TestValidateMissingSubjectRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	delete(claims, "sub")
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected missing sub validation failure")
	}
}

func TestValidateMissingIssuedAtRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	delete(claims, "iat")
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected missing iat validation failure")
	}
}

func TestValidateNbfInFutureRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	claims["nbf"] = time.Now().Add(3 * time.Minute).Unix()
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected nbf validation failure")
	}
}

func TestValidateExpiredTokenRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	claims["exp"] = time.Now().Add(-2 * time.Minute).Unix()
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected expiration validation failure")
	}
}

func TestValidateEmptyTokenReturnsAnonymous(t *testing.T) {
	validator, err := NewValidator("https://realm.nimi.xyz/api/auth/jwks", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	identity, err := validator.Validate("")
	if err != nil {
		t.Fatalf("Validate empty token: %v", err)
	}
	if identity != nil {
		t.Fatalf("expected anonymous identity, got %#v", identity)
	}
}

func TestValidateFallbackUsesCachedHistoricalKeyOnRefreshFailure(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	validator.cacheTTL = 5 * time.Millisecond
	validator.fallbackTTL = time.Second

	token := signRS256(t, key, "kid-1", validClaims())
	if _, err := validator.Validate(token); err != nil {
		t.Fatalf("initial Validate should pass: %v", err)
	}

	time.Sleep(10 * time.Millisecond)
	server.SetStatus(http.StatusInternalServerError)
	if _, err := validator.Validate(token); err != nil {
		t.Fatalf("validate with stale historical key fallback should pass: %v", err)
	}
}
