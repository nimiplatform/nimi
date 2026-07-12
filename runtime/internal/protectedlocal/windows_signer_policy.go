package protectedlocal

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
)

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
