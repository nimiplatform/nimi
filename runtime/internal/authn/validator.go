package authn

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rsa"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// clockSkew is the maximum allowed clock skew for JWT validation (K-AUTHN-005).
const clockSkew = 60 * time.Second

// allowedAlgorithms lists the signing algorithms accepted by the validator.
// alg=none is explicitly rejected (K-AUTHN-002).
var allowedAlgorithms = []string{"RS256", "ES256"}

// Validator verifies JWT tokens using a locally configured public key.
type Validator struct {
	publicKey crypto.PublicKey
	issuer    string // expected iss claim; empty = skip check
	audience  string // expected aud claim; empty = skip check
}

// NewValidator creates a JWT validator from configuration.
// If publicKeyPath is empty, returns a validator that rejects all tokens.
// If the file cannot be read or parsed, returns an error.
func NewValidator(publicKeyPath, issuer, audience string) (*Validator, error) {
	v := &Validator{
		issuer:   strings.TrimSpace(issuer),
		audience: strings.TrimSpace(audience),
	}
	path := strings.TrimSpace(publicKeyPath)
	if path == "" {
		return v, nil
	}
	keyData, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read JWT public key %q: %w", path, err)
	}
	pubKey, err := parsePublicKey(keyData)
	if err != nil {
		return nil, fmt.Errorf("parse JWT public key %q: %w", path, err)
	}
	v.publicKey = pubKey
	return v, nil
}

// Validate parses and verifies a JWT token string.
// Returns the identity on success, or an error on failure.
// If token is empty, returns (nil, nil) indicating an anonymous request.
func (v *Validator) Validate(tokenString string) (*Identity, error) {
	if strings.TrimSpace(tokenString) == "" {
		return nil, nil
	}
	if v.publicKey == nil {
		return nil, fmt.Errorf("no public key configured")
	}

	parserOpts := []jwt.ParserOption{
		jwt.WithValidMethods(allowedAlgorithms),
		jwt.WithLeeway(clockSkew),
		jwt.WithExpirationRequired(),
	}
	if v.issuer != "" {
		parserOpts = append(parserOpts, jwt.WithIssuer(v.issuer))
	}
	if v.audience != "" {
		parserOpts = append(parserOpts, jwt.WithAudience(v.audience))
	}

	token, err := jwt.Parse(tokenString, func(t *jwt.Token) (any, error) {
		switch t.Method.(type) {
		case *jwt.SigningMethodRSA:
			if _, ok := v.publicKey.(*rsa.PublicKey); !ok {
				return nil, fmt.Errorf("key type mismatch: token uses RSA but key is not RSA")
			}
		case *jwt.SigningMethodECDSA:
			if _, ok := v.publicKey.(*ecdsa.PublicKey); !ok {
				return nil, fmt.Errorf("key type mismatch: token uses ECDSA but key is not ECDSA")
			}
		default:
			return nil, fmt.Errorf("unsupported signing method: %v", t.Header["alg"])
		}
		return v.publicKey, nil
	}, parserOpts...)
	if err != nil {
		return nil, fmt.Errorf("token validation failed: %w", err)
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return nil, fmt.Errorf("unexpected claims type")
	}

	sub, _ := claims.GetSubject()
	if sub == "" {
		return nil, fmt.Errorf("token missing sub claim")
	}

	iss, _ := claims.GetIssuer()
	aud, _ := claims.GetAudience()
	sid, _ := claims["sid"].(string)

	identity := &Identity{
		SubjectUserID: sub,
		Issuer:        iss,
		SessionID:     sid,
	}
	if len(aud) > 0 {
		identity.Audience = aud[0]
	}
	return identity, nil
}

// parsePublicKey parses a PEM-encoded public key (RSA or ECDSA).
func parsePublicKey(data []byte) (crypto.PublicKey, error) {
	block, _ := pem.Decode(data)
	if block == nil {
		return nil, fmt.Errorf("no PEM block found")
	}

	switch block.Type {
	case "PUBLIC KEY":
		key, err := x509.ParsePKIXPublicKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PKIX public key: %w", err)
		}
		switch key.(type) {
		case *rsa.PublicKey, *ecdsa.PublicKey:
			return key, nil
		default:
			return nil, fmt.Errorf("unsupported key type: %T (must be RSA or ECDSA)", key)
		}
	case "RSA PUBLIC KEY":
		key, err := x509.ParsePKCS1PublicKey(block.Bytes)
		if err != nil {
			return nil, fmt.Errorf("parse PKCS1 RSA public key: %w", err)
		}
		return key, nil
	default:
		return nil, fmt.Errorf("unsupported PEM block type: %s", block.Type)
	}
}
