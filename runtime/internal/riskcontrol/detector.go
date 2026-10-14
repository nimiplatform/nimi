// Package riskcontrol implements the small, local text.generate content rules.
// It never reads credentials and a match is not evidence of credential validity.
package riskcontrol

import (
	"crypto/x509"
	"encoding/pem"
	"strings"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.text-content-rules
const (
	PrivateKeyRule = "pem-private-key"
	TokenRule      = "github-classic-pat"
)

// Detector has no mutable policy or external dependencies. The fixed rules use
// parsers rather than runtime-compiled patterns, so construction cannot fail.
type Detector struct{}

func New() *Detector { return &Detector{} }

// Text checks a naturally complete value. PEM is deliberately complete-value
// only: streams do not retain an entire private key just to parse it.
func (*Detector) Text(text string) string {
	var stream Stream
	if rule := stream.Feed(text); rule != "" {
		return rule
	}
	if rule := stream.Finish(); rule != "" {
		return rule
	}
	start := strings.Index(text, "-----BEGIN ")
	if start < 0 {
		return ""
	}
	rest := []byte(text[start:])
	for len(rest) > 0 {
		block, remaining := pem.Decode(rest)
		if block == nil {
			break
		}
		rest = remaining
		if len(block.Headers) != 0 {
			continue // Encrypted/opaque material is outside this rule.
		}
		switch block.Type {
		case "PRIVATE KEY":
			if _, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
				return PrivateKeyRule
			}
		case "RSA PRIVATE KEY":
			if _, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
				return PrivateKeyRule
			}
		case "EC PRIVATE KEY":
			if _, err := x509.ParseECPrivateKey(block.Bytes); err == nil {
				return PrivateKeyRule
			}
		}
	}
	return ""
}

// Stream retains at most one 40-byte identifier and a saturating length. An
// overlong identifier stays overlong until a delimiter: truncation cannot
// invent a left boundary. Feed never treats a transport chunk end as value end.
// Non-ASCII bytes conservatively continue identifiers, including split UTF-8.
type Stream struct {
	word [40]byte
	n    uint8
}

func identifierByte(c byte) bool {
	return c >= 128 || c == '_' || c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9'
}

func (s *Stream) Feed(text string) string {
	for i := 0; i < len(text); i++ {
		c := text[i]
		if identifierByte(c) {
			if s.n < 40 {
				s.word[s.n] = c
			}
			if s.n < 41 {
				s.n++
			}
		} else if rule := s.Finish(); rule != "" {
			return rule
		}
	}
	return ""
}

func (s *Stream) Finish() string {
	n := s.n
	s.n = 0
	if n != 40 || string(s.word[:4]) != "ghp_" {
		return ""
	}
	for _, c := range s.word[4:] {
		if !(c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9') {
			return ""
		}
	}
	return TokenRule
}
