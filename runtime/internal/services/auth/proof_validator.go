package auth

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// allowedClockSkew is the tolerance for exp claim validation.
const allowedClockSkew = 60 * time.Second

var (
	ErrUnsupportedProofType = errors.New("unsupported proof type")
	ErrTokenInvalid         = errors.New("token invalid")
	ErrTokenExpired         = errors.New("token expired")
)

// validateExternalProof validates the proof token against the registered principal.
// Phase 1 supports JWT only (K-AUTHSVC-013).
func validateExternalProof(proof string, principal externalPrincipal) error {
	if principal.ProofType != runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_JWT {
		return ErrUnsupportedProofType
	}
	if !isJWTShaped(proof) {
		return ErrTokenInvalid
	}
	return validateJWTProof(proof, principal)
}

// isJWTShaped returns true if the proof has three dot-separated base64url segments.
func isJWTShaped(proof string) bool {
	parts := strings.SplitN(proof, ".", 4)
	return len(parts) == 3 && parts[0] != "" && parts[1] != "" && parts[2] != ""
}

// jwtHeader is the minimal JWT header for algorithm detection.
type jwtHeader struct {
	Alg string `json:"alg"`
	Kid string `json:"kid,omitempty"`
}

// jwtClaims is the minimal JWT payload for proof validation.
type jwtClaims struct {
	Iss string `json:"iss,omitempty"`
	Exp int64  `json:"exp,omitempty"`
}

func validateJWTProof(token string, principal externalPrincipal) error {
	parts := strings.SplitN(token, ".", 3)
	if len(parts) != 3 {
		return ErrTokenInvalid
	}

	// Decode header.
	headerBytes, err := base64URLDecode(parts[0])
	if err != nil {
		return fmt.Errorf("%w: decode JWT header: %v", ErrTokenInvalid, err)
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return fmt.Errorf("%w: parse JWT header: %v", ErrTokenInvalid, err)
	}

	// Whitelist algorithms (K-AUTHSVC-013).
	switch header.Alg {
	case "RS256", "ES256":
		// Allowed.
	default:
		return fmt.Errorf("%w: unsupported JWT algorithm: %s", ErrTokenInvalid, header.Alg)
	}

	// Decode claims.
	claimsBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return fmt.Errorf("%w: decode JWT claims: %v", ErrTokenInvalid, err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return fmt.Errorf("%w: parse JWT claims: %v", ErrTokenInvalid, err)
	}

	// Check expiration with clock skew.
	if claims.Exp > 0 {
		expiresAt := time.Unix(claims.Exp, 0)
		if time.Now().After(expiresAt.Add(allowedClockSkew)) {
			return ErrTokenExpired
		}
	}

	// Check issuer matches registered principal.
	if principal.Issuer != "" && claims.Iss != principal.Issuer {
		return fmt.Errorf("%w: JWT issuer mismatch", ErrTokenInvalid)
	}

	signatureKey := strings.TrimSpace(principal.SignatureKeyID)
	if signatureKey == "" {
		return fmt.Errorf("%w: JWT signature key is required", ErrTokenInvalid)
	}

	// Verify signature against the registered key.
	signingInput := parts[0] + "." + parts[1]
	signature, err := base64URLDecode(parts[2])
	if err != nil {
		return fmt.Errorf("%w: decode JWT signature: %v", ErrTokenInvalid, err)
	}
	if err := verifySignature(header.Alg, signatureKey, []byte(signingInput), signature); err != nil {
		return fmt.Errorf("%w: JWT signature invalid: %v", ErrTokenInvalid, err)
	}

	return nil
}

func validateJWTSignatureKey(key string) error {
	trimmed := strings.TrimSpace(key)
	if trimmed == "" {
		return fmt.Errorf("%w: JWT signature key is required", ErrTokenInvalid)
	}
	if _, err := parseJWTPublicKey(trimmed); err != nil {
		return fmt.Errorf("%w: parse public key: %v", ErrTokenInvalid, err)
	}
	return nil
}

func verifySignature(alg string, keyPEM string, signingInput []byte, signature []byte) error {
	pubKey, err := parseJWTPublicKey(keyPEM)
	if err != nil {
		return fmt.Errorf("%w: parse public key: %v", ErrTokenInvalid, err)
	}

	hash := crypto.SHA256
	h := hash.New()
	h.Write(signingInput)
	digest := h.Sum(nil)

	switch alg {
	case "RS256":
		rsaKey, ok := pubKey.(*rsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is not RSA", ErrTokenInvalid)
		}
		return rsa.VerifyPKCS1v15(rsaKey, hash, digest, signature)
	case "ES256":
		ecKey, ok := pubKey.(*ecdsa.PublicKey)
		if !ok {
			return fmt.Errorf("%w: key is not ECDSA", ErrTokenInvalid)
		}
		if !ecdsa.VerifyASN1(ecKey, digest, signature) {
			return fmt.Errorf("%w: ECDSA signature verification failed", ErrTokenInvalid)
		}
		return nil
	default:
		return fmt.Errorf("%w: unsupported algorithm: %s", ErrTokenInvalid, alg)
	}
}

func parseJWTPublicKey(raw string) (any, error) {
	keyBytes, err := base64.StdEncoding.DecodeString(strings.TrimSpace(raw))
	if err != nil {
		keyBytes = []byte(strings.TrimSpace(raw))
	}
	if block, _ := pem.Decode(keyBytes); block != nil {
		keyBytes = block.Bytes
	}
	return x509.ParsePKIXPublicKey(keyBytes)
}

func base64URLDecode(s string) ([]byte, error) {
	// Add padding if needed.
	switch len(s) % 4 {
	case 2:
		s += "=="
	case 3:
		s += "="
	}
	return base64.URLEncoding.DecodeString(s)
}
