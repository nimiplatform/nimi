package protectedlocal

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

// WindowsProductionSignerCertSHA256 is injected by the production build from
// the installer signing policy. It is a public certificate identity, never a
// credential or caller-controlled configuration value. An empty or malformed
// value keeps native admission closed.
var WindowsProductionSignerCertSHA256 string

func decodeWindowsSignerCertSHA256(value string) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != sha256.Size*2 || trimmed != strings.ToLower(trimmed) {
		return digest, fmt.Errorf("exact lowercase SHA-256 certificate identity is required")
	}
	decoded, err := hex.DecodeString(trimmed)
	if err != nil || len(decoded) != len(digest) {
		return digest, fmt.Errorf("exact lowercase SHA-256 certificate identity is required")
	}
	copy(digest[:], decoded)
	return digest, nil
}
