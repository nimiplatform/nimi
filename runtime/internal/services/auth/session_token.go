package auth

import (
	"crypto/rand"
	"encoding/base64"
	"fmt"
)

const sessionTokenBytes = 32

func newSessionToken() (string, error) {
	buf := make([]byte, sessionTokenBytes)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate session token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
