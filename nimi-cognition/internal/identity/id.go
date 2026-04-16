// Package identity provides ULID-style ID generation using only
// the Go standard library (crypto/rand + time).
package identity

import (
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

// Crockford Base32 alphabet used by ULID.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

// NewID generates a new ULID-format ID. The ID encodes the current
// UTC timestamp in the high 48 bits and 80 bits of crypto-random
// entropy in the low bits. IDs sort lexicographically by creation time.
func NewID() (string, error) {
	return NewIDAt(time.Now().UTC())
}

// NewIDAt generates a ULID-format ID at a specific timestamp.
func NewIDAt(t time.Time) (string, error) {
	ms := uint64(t.UnixMilli())

	var entropy [10]byte
	if _, err := rand.Read(entropy[:]); err != nil {
		return "", fmt.Errorf("generate id: %w", err)
	}

	var id [26]byte
	// Encode 48-bit timestamp (10 chars)
	encodeTimestamp(id[:10], ms)
	// Encode 80-bit randomness (16 chars)
	encodeRandomness(id[10:], entropy)

	return string(id[:]), nil
}

// NewPrefixed generates a prefixed ID like "rule_01JXYZ..." or
// "mem_01JXYZ...". The prefix is separated by underscore.
func NewPrefixed(prefix string) (string, error) {
	ulid, err := NewID()
	if err != nil {
		return "", err
	}
	return prefix + "_" + ulid, nil
}

// ValidateID checks that a string looks like a valid ULID (26 chars,
// all Crockford Base32). Does not validate the prefix portion.
func ValidateID(id string) bool {
	// Handle prefixed IDs (e.g., "rule_01JXYZ...")
	parts := strings.SplitN(id, "_", 2)
	ulid := parts[len(parts)-1]

	if len(ulid) != 26 {
		return false
	}
	for _, c := range strings.ToUpper(ulid) {
		if strings.IndexRune(crockford, c) < 0 {
			return false
		}
	}
	return true
}

func encodeTimestamp(dst []byte, ms uint64) {
	dst[0] = crockford[(ms>>45)&0x1F]
	dst[1] = crockford[(ms>>40)&0x1F]
	dst[2] = crockford[(ms>>35)&0x1F]
	dst[3] = crockford[(ms>>30)&0x1F]
	dst[4] = crockford[(ms>>25)&0x1F]
	dst[5] = crockford[(ms>>20)&0x1F]
	dst[6] = crockford[(ms>>15)&0x1F]
	dst[7] = crockford[(ms>>10)&0x1F]
	dst[8] = crockford[(ms>>5)&0x1F]
	dst[9] = crockford[ms&0x1F]
}

func encodeRandomness(dst []byte, entropy [10]byte) {
	// Pack 80 bits into a uint64 + uint16 for encoding.
	hi := binary.BigEndian.Uint64(entropy[0:8])
	lo := uint64(binary.BigEndian.Uint16(entropy[8:10]))

	// 80 bits = 16 base32 chars (5 bits each)
	combined := (hi << 16) | lo

	for i := 15; i >= 0; i-- {
		dst[i] = crockford[combined&0x1F]
		combined >>= 5
	}
}
