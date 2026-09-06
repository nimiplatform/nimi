package protectedlocal

import (
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"fmt"
	"strings"
)

func decodeWindowsSignerSPKISHA256(value string) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	trimmed := strings.TrimSpace(value)
	if len(trimmed) != sha256.Size*2 || trimmed != strings.ToLower(trimmed) {
		return digest, fmt.Errorf("exact lowercase SHA-256 SubjectPublicKeyInfo identity is required")
	}
	decoded, err := hex.DecodeString(trimmed)
	if err != nil || len(decoded) != len(digest) {
		return digest, fmt.Errorf("exact lowercase SHA-256 SubjectPublicKeyInfo identity is required")
	}
	copy(digest[:], decoded)
	return digest, nil
}

func windowsSignerSPKISHA256FromCertificateDER(encoded []byte) ([sha256.Size]byte, error) {
	var digest [sha256.Size]byte
	certificate, err := x509.ParseCertificate(encoded)
	if err != nil {
		return digest, fmt.Errorf("parse Windows signer SubjectPublicKeyInfo: %w", err)
	}
	if len(certificate.RawSubjectPublicKeyInfo) == 0 {
		return digest, fmt.Errorf("parse Windows signer SubjectPublicKeyInfo: encoded value is empty")
	}
	return sha256.Sum256(certificate.RawSubjectPublicKeyInfo), nil
}
