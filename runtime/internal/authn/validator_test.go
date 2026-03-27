package authn

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"io"
	"math/big"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

type testWriterError struct {
	message string
}

func (e *testWriterError) Error() string {
	return e.message
}

type jwksTestServer struct {
	server   *httptest.Server
	mu       sync.Mutex
	document jwksDocument
	status   int
	hits     int
	err      error
}

func newJWKSTestServer(t *testing.T, document jwksDocument) *jwksTestServer {
	t.Helper()
	s := &jwksTestServer{
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
			s.mu.Lock()
			s.err = &testWriterError{message: "encode jwks response: " + err.Error()}
			s.mu.Unlock()
			http.Error(w, "jwks encode error", http.StatusInternalServerError)
		}
	}))
	t.Cleanup(func() {
		if err := s.LastError(); err != nil {
			t.Error(err)
		}
	})
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

func (s *jwksTestServer) LastError() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.err
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

func TestValidateCallsRevocationEndpointAfterSuccessfulJWTValidation(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer jwksServer.Close()

	var captured revocationRequest
	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("unexpected method %s", r.Method)
		}
		body, err := io.ReadAll(r.Body)
		if err != nil {
			t.Fatalf("ReadAll: %v", err)
		}
		if err := json.Unmarshal(body, &captured); err != nil {
			t.Fatalf("Unmarshal: %v", err)
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(revocationResponse{Active: true})
	}))
	defer revocationServer.Close()

	validator, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	validator.SetRevocationURL(revocationServer.URL)

	token := signRS256(t, key, "kid-1", validClaims())
	identity, err := validator.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if identity == nil {
		t.Fatal("expected identity")
	}
	if captured.SessionID != "session-abc" {
		t.Fatalf("expected session_id=session-abc, got %q", captured.SessionID)
	}
	if captured.SubjectUserID != "user-123" {
		t.Fatalf("expected subject_user_id=user-123, got %q", captured.SubjectUserID)
	}
	if captured.Issuer != "test-issuer" || captured.Audience != "test-audience" {
		t.Fatalf("unexpected revocation payload issuer/audience: %+v", captured)
	}
	if strings.TrimSpace(captured.IssuedAt) == "" || strings.TrimSpace(captured.ExpiresAt) == "" {
		t.Fatalf("expected issued_at and expires_at in revocation payload: %+v", captured)
	}
}

func TestValidateRejectsRevokedSession(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer jwksServer.Close()

	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(revocationResponse{Active: true, Revoked: true})
	}))
	defer revocationServer.Close()

	validator, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	validator.SetRevocationURL(revocationServer.URL)

	token := signRS256(t, key, "kid-1", validClaims())
	if _, err := validator.Validate(token); err == nil || !strings.Contains(err.Error(), "session revoked") {
		t.Fatalf("expected revoked session error, got %v", err)
	}
}

func TestValidateRejectsInactiveSession(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer jwksServer.Close()

	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(revocationResponse{Active: false})
	}))
	defer revocationServer.Close()

	validator, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	validator.SetRevocationURL(revocationServer.URL)

	token := signRS256(t, key, "kid-1", validClaims())
	if _, err := validator.Validate(token); err == nil || !strings.Contains(err.Error(), "session revoked") {
		t.Fatalf("expected inactive session rejection, got %v", err)
	}
}

func TestValidateRejectsMalformedRevocationResponse(t *testing.T) {
	key := generateRSAKey(t)
	jwksServer := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer jwksServer.Close()

	revocationServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"active":true,"expires_at":"not-rfc3339"}`)
	}))
	defer revocationServer.Close()

	validator, err := NewValidator(jwksServer.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	validator.SetRevocationURL(revocationServer.URL)

	token := signRS256(t, key, "kid-1", validClaims())
	if _, err := validator.Validate(token); err == nil || !strings.Contains(err.Error(), "invalid revocation response expires_at") {
		t.Fatalf("expected malformed revocation response rejection, got %v", err)
	}
}

func TestRefreshJWKSCoalescesConcurrentRefreshesForSameKid(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	const goroutines = 8
	var wg sync.WaitGroup
	errCh := make(chan error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			errCh <- validator.refreshJWKS(context.Background(), "kid-1")
		}()
	}
	wg.Wait()
	close(errCh)

	for err := range errCh {
		if err != nil {
			t.Fatalf("refreshJWKS: %v", err)
		}
	}
	if hits := server.HitCount(); hits != 1 {
		t.Fatalf("expected 1 JWKS fetch, got %d", hits)
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

func TestValidateAcceptsClockSkewWithinSixtySeconds(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	now := time.Now()
	token := signRS256(t, key, "kid-1", jwt.MapClaims{
		"sub": "user-123",
		"iss": "test-issuer",
		"aud": "test-audience",
		"exp": now.Add(-30 * time.Second).Unix(),
		"iat": now.Unix(),
		"nbf": now.Add(30 * time.Second).Unix(),
	})
	if _, err := validator.Validate(token); err != nil {
		t.Fatalf("expected token within clock skew window accepted, got %v", err)
	}
}

func TestValidateRejectsClockSkewBeyondSixtySeconds(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	now := time.Now()
	token := signRS256(t, key, "kid-1", jwt.MapClaims{
		"sub": "user-123",
		"iss": "test-issuer",
		"aud": "test-audience",
		"exp": now.Add(-61 * time.Second).Unix(),
		"iat": now.Unix(),
		"nbf": now.Add(61 * time.Second).Unix(),
	})
	if _, err := validator.Validate(token); err == nil {
		t.Fatalf("expected token beyond clock skew window rejected")
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

func TestValidateIssuedAtBeyondClockSkewRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	claims := validClaims()
	claims["iat"] = time.Now().Add(61 * time.Second).Unix()
	claims["exp"] = time.Now().Add(2 * time.Hour).Unix()
	token := signRS256(t, key, "kid-1", claims)
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected future issued-at validation failure")
	}
}

func TestValidateRejectsTokenLifetimeAboveTwentyFourHours(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	now := time.Now()
	token := signRS256(t, key, "kid-1", jwt.MapClaims{
		"sub": "user-123",
		"iss": "test-issuer",
		"aud": "test-audience",
		"iat": now.Unix(),
		"exp": now.Add(25 * time.Hour).Unix(),
		"nbf": now.Unix(),
	})
	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected excessive token lifetime validation failure")
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

func TestValidateAlgNoneTokenRejected(t *testing.T) {
	key := generateRSAKey(t)
	server := newJWKSTestServer(t, jwksDocument{Keys: []jwkEntry{rsaJWKFromPrivateKey(t, key, "kid-1")}})
	defer server.Close()

	validator, err := NewValidator(server.URL(), "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}

	// Craft a token with alg=none (K-AUTHN-003: MUST reject)
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT","kid":"kid-1"}`))
	claims := validClaims()
	claimsJSON, _ := json.Marshal(claims)
	payload := base64.RawURLEncoding.EncodeToString(claimsJSON)
	token := header + "." + payload + "."

	_, err = validator.Validate(token)
	if err == nil {
		t.Fatal("expected alg=none token to be rejected (K-AUTHN-003)")
	}
}

func TestNewValidatorRejectsPartialConfig(t *testing.T) {
	if _, err := NewValidator("https://realm.nimi.xyz/api/auth/jwks", "", "runtime"); err == nil {
		t.Fatal("expected partial jwt config to be rejected")
	}
}

func TestNewValidatorRejectsNonLoopbackHTTPJWKS(t *testing.T) {
	if _, err := NewValidator("http://realm.nimi.xyz/api/auth/jwks", "issuer", "audience"); err == nil {
		t.Fatal("expected non-loopback http jwks url to be rejected")
	}
}

func TestNewValidatorAllowsLoopbackHTTPJWKS(t *testing.T) {
	if _, err := NewValidator("http://127.0.0.1:3002/api/auth/jwks", "issuer", "audience"); err != nil {
		t.Fatalf("expected loopback http jwks url to be allowed: %v", err)
	}
}

func TestParseRSAJWKRejectsPlatformIntOverflow(t *testing.T) {
	_, err := parseRSAJWK(jwkEntry{
		Kty: "RSA",
		N:   base64.RawURLEncoding.EncodeToString(new(big.Int).Lsh(big.NewInt(1), 2047).Bytes()),
		E:   base64.RawURLEncoding.EncodeToString([]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}),
	})
	if err == nil {
		t.Fatal("expected exponent overflow to fail")
	}
	if !strings.Contains(err.Error(), "overflows platform int") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestValidateEmptyTokenFailsClosed(t *testing.T) {
	validator, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	identity, err := validator.Validate("")
	if err == nil {
		t.Fatal("expected empty token to be rejected")
	}
	if identity != nil {
		t.Fatalf("expected nil identity, got %#v", identity)
	}
	if err != errEmptyToken {
		t.Fatalf("expected errEmptyToken, got %v", err)
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
