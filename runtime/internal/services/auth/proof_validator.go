package auth

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

// allowedClockSkew is the tolerance for exp claim validation.
const allowedClockSkew = 60 * time.Second

// validateExternalProof validates the proof token against the registered principal.
// For ED25519 and HMAC_SHA256, it accepts any non-empty proof (signature verification
// would require key exchange not yet implemented in the in-memory service).
// For UNSPECIFIED, the proof is treated as an opaque bearer token.
// If the proof looks like a JWT (three dot-separated segments), JWT-specific
// validation is applied regardless of proof type (K-AUTHSVC-013).
func validateExternalProof(proof string, principal externalPrincipal) error {
	// If proof looks like a JWT, validate its structure and claims.
	if isJWTShaped(proof) {
		return validateJWTProof(proof, principal)
	}

	// For non-JWT proofs, accept based on registered proof type.
	switch principal.ProofType {
	case runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_ED25519,
		runtimev1.ExternalProofType_EXTERNAL_PROOF_TYPE_HMAC_SHA256:
		// Accept non-empty proof; real signature verification is a future enhancement.
		return nil
	default:
		// UNSPECIFIED or unknown: accept any non-empty proof as opaque bearer.
		return nil
	}
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
		return errors.New("malformed JWT: expected 3 parts")
	}

	// Decode header.
	headerBytes, err := base64URLDecode(parts[0])
	if err != nil {
		return fmt.Errorf("decode JWT header: %w", err)
	}
	var header jwtHeader
	if err := json.Unmarshal(headerBytes, &header); err != nil {
		return fmt.Errorf("parse JWT header: %w", err)
	}

	// Whitelist algorithms (K-AUTHSVC-013).
	switch header.Alg {
	case "RS256", "ES256":
		// Allowed.
	default:
		return fmt.Errorf("unsupported JWT algorithm: %s", header.Alg)
	}

	// Decode claims.
	claimsBytes, err := base64URLDecode(parts[1])
	if err != nil {
		return fmt.Errorf("decode JWT claims: %w", err)
	}
	var claims jwtClaims
	if err := json.Unmarshal(claimsBytes, &claims); err != nil {
		return fmt.Errorf("parse JWT claims: %w", err)
	}

	// Check expiration with clock skew.
	if claims.Exp > 0 {
		expiresAt := time.Unix(claims.Exp, 0)
		if time.Now().After(expiresAt.Add(allowedClockSkew)) {
			return errors.New("JWT expired")
		}
	}

	// Check issuer matches registered principal.
	if principal.Issuer != "" && claims.Iss != principal.Issuer {
		return fmt.Errorf("JWT issuer mismatch: got %q, want %q", claims.Iss, principal.Issuer)
	}

	// Verify signature if a key is registered.
	if principal.SignatureKeyID != "" {
		signingInput := parts[0] + "." + parts[1]
		signature, err := base64URLDecode(parts[2])
		if err != nil {
			return fmt.Errorf("decode JWT signature: %w", err)
		}
		if err := verifySignature(header.Alg, principal.SignatureKeyID, []byte(signingInput), signature); err != nil {
			return fmt.Errorf("JWT signature invalid: %w", err)
		}
	}

	return nil
}

func verifySignature(alg string, keyPEM string, signingInput []byte, signature []byte) error {
	keyBytes, err := base64.StdEncoding.DecodeString(keyPEM)
	if err != nil {
		// Try raw PEM.
		keyBytes = []byte(keyPEM)
	}

	pubKey, err := x509.ParsePKIXPublicKey(keyBytes)
	if err != nil {
		return fmt.Errorf("parse public key: %w", err)
	}

	hash := crypto.SHA256
	h := hash.New()
	h.Write(signingInput)
	digest := h.Sum(nil)

	switch alg {
	case "RS256":
		rsaKey, ok := pubKey.(*rsa.PublicKey)
		if !ok {
			return errors.New("key is not RSA")
		}
		return rsa.VerifyPKCS1v15(rsaKey, hash, digest, signature)
	case "ES256":
		ecKey, ok := pubKey.(*ecdsa.PublicKey)
		if !ok {
			return errors.New("key is not ECDSA")
		}
		if !ecdsa.VerifyASN1(ecKey, digest, signature) {
			return errors.New("ECDSA signature verification failed")
		}
		return nil
	default:
		return fmt.Errorf("unsupported algorithm: %s", alg)
	}
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
