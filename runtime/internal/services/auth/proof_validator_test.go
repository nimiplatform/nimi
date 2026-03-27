package auth

import (
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestValidateJWTSignatureKeyAcceptsPKIXDER(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	publicKey := encodePublicKeyDERBase64(t, &privateKey.PublicKey)
	if err := validateJWTSignatureKey(publicKey); err != nil {
		t.Fatalf("validateJWTSignatureKey: %v", err)
	}
}

func TestValidateJWTSignatureKeyRejectsInvalidKey(t *testing.T) {
	if err := validateJWTSignatureKey("not-a-valid-key"); err == nil {
		t.Fatalf("expected invalid key error")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestValidateExternalProofRequiresSignatureKey(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildTestJWT(t, "https://issuer.nimi.xyz", time.Now().Add(5*time.Minute), privateKey)
	principal := externalPrincipal{
		ProofType: runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:    "https://issuer.nimi.xyz",
	}
	if err := validateExternalProof(token, principal); err == nil {
		t.Fatalf("expected invalid proof for missing signature key")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestValidateExternalProofAcceptsValidSignature(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildTestJWT(t, "https://issuer.nimi.xyz", time.Now().Add(5*time.Minute), privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err != nil {
		t.Fatalf("validateExternalProof: %v", err)
	}
}

func TestValidateExternalProofRejectsMissingExpClaim(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildExpOmittedJWT(t, "https://issuer.nimi.xyz", privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err == nil {
		t.Fatalf("expected missing exp claim rejected")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestValidateExternalProofRejectsFutureNbfOutsideClockSkew(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildTestJWTWithClaims(t, map[string]any{
		"iss": "https://issuer.nimi.xyz",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(5 * time.Minute).Unix(),
		"nbf": time.Now().Add(2 * time.Minute).Unix(),
	}, privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err == nil {
		t.Fatal("expected future nbf rejected")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestValidateExternalProofAcceptsNbfWithinClockSkew(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildTestJWTWithClaims(t, map[string]any{
		"iss": "https://issuer.nimi.xyz",
		"iat": time.Now().Unix(),
		"exp": time.Now().Add(5 * time.Minute).Unix(),
		"nbf": time.Now().Add(30 * time.Second).Unix(),
	}, privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err != nil {
		t.Fatalf("validateExternalProof within skew: %v", err)
	}
}

func TestValidateExternalProofRejectsMissingIatClaim(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	token := buildTestJWTWithClaims(t, map[string]any{
		"iss": "https://issuer.nimi.xyz",
		"exp": time.Now().Add(5 * time.Minute).Unix(),
	}, privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err == nil {
		t.Fatal("expected missing iat rejected")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}

func TestValidateExternalProofRejectsLifetimeExceedingMaximum(t *testing.T) {
	privateKey, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate rsa key: %v", err)
	}
	issuedAt := time.Now().Add(-time.Hour)
	token := buildTestJWTWithClaims(t, map[string]any{
		"iss": "https://issuer.nimi.xyz",
		"iat": issuedAt.Unix(),
		"exp": issuedAt.Add(25 * time.Hour).Unix(),
	}, privateKey)
	principal := externalPrincipal{
		ProofType:      runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT,
		Issuer:         "https://issuer.nimi.xyz",
		SignatureKeyID: encodePublicKeyDERBase64(t, &privateKey.PublicKey),
	}
	if err := validateExternalProof(token, principal); err == nil {
		t.Fatal("expected oversized lifetime rejected")
	} else if !errors.Is(err, ErrTokenInvalid) {
		t.Fatalf("expected ErrTokenInvalid, got %v", err)
	}
}
