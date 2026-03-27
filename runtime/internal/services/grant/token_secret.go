package grant

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

const tokenSecretBytes = 32

var generateTokenSecret = newTokenSecret

func newTokenSecret() (string, error) {
	buf := make([]byte, tokenSecretBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate token secret: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
