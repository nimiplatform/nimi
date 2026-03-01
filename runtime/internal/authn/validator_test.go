package authn

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func generateRSAKeyPair(t *testing.T) (*rsa.PrivateKey, string) {
	t.Helper()
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubKeyBytes})
	path := filepath.Join(t.TempDir(), "pub.pem")
	if err := os.WriteFile(path, pubPEM, 0o644); err != nil {
		t.Fatalf("write public key: %v", err)
	}
	return privateKey, path
}

func generateECKeyPair(t *testing.T) (*ecdsa.PrivateKey, string) {
	t.Helper()
	privateKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate EC key: %v", err)
	}
	pubKeyBytes, err := x509.MarshalPKIXPublicKey(&privateKey.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	pubPEM := pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubKeyBytes})
	path := filepath.Join(t.TempDir(), "pub.pem")
	if err := os.WriteFile(path, pubPEM, 0o644); err != nil {
		t.Fatalf("write public key: %v", err)
	}
	return privateKey, path
}

func signRS256(t *testing.T, key *rsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func signES256(t *testing.T, key *ecdsa.PrivateKey, claims jwt.MapClaims) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodES256, claims)
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}

func validClaims() jwt.MapClaims {
	return jwt.MapClaims{
		"sub": "user-123",
		"iss": "test-issuer",
		"aud": "test-audience",
		"exp": time.Now().Add(1 * time.Hour).Unix(),
		"iat": time.Now().Unix(),
		"nbf": time.Now().Unix(),
		"sid": "session-abc",
	}
}

func TestValidateRS256_ValidToken(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	token := signRS256(t, key, validClaims())
	id, err := v.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if id == nil {
		t.Fatal("expected non-nil identity")
	}
	if id.SubjectUserID != "user-123" {
		t.Errorf("expected sub user-123, got %s", id.SubjectUserID)
	}
	if id.Issuer != "test-issuer" {
		t.Errorf("expected issuer test-issuer, got %s", id.Issuer)
	}
	if id.Audience != "test-audience" {
		t.Errorf("expected audience test-audience, got %s", id.Audience)
	}
	if id.SessionID != "session-abc" {
		t.Errorf("expected session session-abc, got %s", id.SessionID)
	}
}

func TestValidateES256_ValidToken(t *testing.T) {
	key, path := generateECKeyPair(t)
	v, err := NewValidator(path, "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	token := signES256(t, key, validClaims())
	id, err := v.Validate(token)
	if err != nil {
		t.Fatalf("Validate: %v", err)
	}
	if id == nil {
		t.Fatal("expected non-nil identity")
	}
	if id.SubjectUserID != "user-123" {
		t.Errorf("expected sub user-123, got %s", id.SubjectUserID)
	}
}

func TestValidate_ExpiredToken(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	claims := validClaims()
	claims["exp"] = time.Now().Add(-2 * time.Minute).Unix() // Beyond 60s skew
	token := signRS256(t, key, claims)
	_, err = v.Validate(token)
	if err == nil {
		t.Fatal("expected error for expired token")
	}
}

func TestValidate_ClockSkewWithin60s(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "test-issuer", "test-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	claims := validClaims()
	// Token expired 50s ago — within 60s skew, should pass
	claims["exp"] = time.Now().Add(-50 * time.Second).Unix()
	token := signRS256(t, key, claims)
	id, err := v.Validate(token)
	if err != nil {
		t.Fatalf("expected token within skew to pass, got: %v", err)
	}
	if id == nil {
		t.Fatal("expected non-nil identity")
	}
}

func TestValidate_AlgNone_Rejected(t *testing.T) {
	_, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	// Create token with alg=none (unsigned)
	token := jwt.NewWithClaims(jwt.SigningMethodNone, validClaims())
	tokenString, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("sign none token: %v", err)
	}
	_, err = v.Validate(tokenString)
	if err == nil {
		t.Fatal("expected error for alg=none token")
	}
}

func TestValidate_WrongIssuer_Rejected(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "expected-issuer", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	claims := validClaims()
	claims["iss"] = "wrong-issuer"
	token := signRS256(t, key, claims)
	_, err = v.Validate(token)
	if err == nil {
		t.Fatal("expected error for wrong issuer")
	}
}

func TestValidate_WrongAudience_Rejected(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "", "expected-audience")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	claims := validClaims()
	claims["aud"] = "wrong-audience"
	token := signRS256(t, key, claims)
	_, err = v.Validate(token)
	if err == nil {
		t.Fatal("expected error for wrong audience")
	}
}

func TestValidate_MissingSub_Rejected(t *testing.T) {
	key, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	claims := validClaims()
	delete(claims, "sub")
	token := signRS256(t, key, claims)
	_, err = v.Validate(token)
	if err == nil {
		t.Fatal("expected error for missing sub")
	}
}

func TestValidate_EmptyToken_Anonymous(t *testing.T) {
	_, path := generateRSAKeyPair(t)
	v, err := NewValidator(path, "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	id, err := v.Validate("")
	if err != nil {
		t.Fatalf("expected no error for empty token, got: %v", err)
	}
	if id != nil {
		t.Fatal("expected nil identity for anonymous")
	}
}

func TestValidate_NoPublicKey_RejectsToken(t *testing.T) {
	v, err := NewValidator("", "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	// Generate a key just to sign the token, but validator has no key
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	token := jwt.NewWithClaims(jwt.SigningMethodRS256, validClaims())
	signed, err := token.SignedString(key)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	_, err = v.Validate(signed)
	if err == nil {
		t.Fatal("expected error when no public key configured")
	}
}

func TestNewValidator_InvalidKeyFile_Error(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.pem")
	if err := os.WriteFile(path, []byte("not a pem key"), 0o644); err != nil {
		t.Fatalf("write bad key: %v", err)
	}
	_, err := NewValidator(path, "", "")
	if err == nil {
		t.Fatal("expected error for invalid key file")
	}
}

func TestValidate_WrongKeyType_Rejected(t *testing.T) {
	// Sign with RSA but validator has EC key
	rsaKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}
	_, ecPath := generateECKeyPair(t)
	v, err := NewValidator(ecPath, "", "")
	if err != nil {
		t.Fatalf("NewValidator: %v", err)
	}
	token := signRS256(t, rsaKey, validClaims())
	_, err = v.Validate(token)
	if err == nil {
		t.Fatal("expected error for key type mismatch")
	}
}
