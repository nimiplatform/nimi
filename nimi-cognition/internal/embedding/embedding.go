package embedding

import (
	"encoding/binary"
	"hash/fnv"
	"math"
	"strings"
	"unicode"
)

const Dimension = 64

// Vectorize deterministically projects text into a normalized local vector.
// It is stdlib-only and intentionally local to standalone cognition.
func Vectorize(text string) []float64 {
	vector := make([]float64, Dimension)
	tokens := tokenize(text)
	if len(tokens) == 0 {
		return vector
	}
	for _, token := range tokens {
		for _, feature := range tokenFeatures(token) {
			h := fnv.New64a()
			_, _ = h.Write([]byte(feature))
			sum := h.Sum64()
			idx := int(sum % Dimension)
			sign := 1.0
			if (sum>>63)&1 == 1 {
				sign = -1.0
			}
			vector[idx] += sign
			if idx+1 < Dimension {
				vector[idx+1] += float64(binary.BigEndian.Uint16([]byte{byte(sum >> 8), byte(sum)})) / 65535.0
			}
		}
	}
	normalize(vector)
	return vector
}

// CosineSimilarity compares two normalized or non-normalized vectors.
func CosineSimilarity(left []float64, right []float64) float64 {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	size := len(left)
	if len(right) < size {
		size = len(right)
	}
	var dot float64
	var leftNorm float64
	var rightNorm float64
	for i := 0; i < size; i++ {
		dot += left[i] * right[i]
		leftNorm += left[i] * left[i]
		rightNorm += right[i] * right[i]
	}
	if leftNorm == 0 || rightNorm == 0 {
		return 0
	}
	return dot / math.Sqrt(leftNorm*rightNorm)
}

func tokenize(text string) []string {
	var tokens []string
	var current strings.Builder
	for _, r := range strings.ToLower(text) {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			current.WriteRune(r)
			continue
		}
		if current.Len() > 0 {
			tokens = append(tokens, current.String())
			current.Reset()
		}
	}
	if current.Len() > 0 {
		tokens = append(tokens, current.String())
	}
	return tokens
}

func tokenFeatures(token string) []string {
	if len(token) < 3 {
		return []string{token}
	}
	features := []string{token}
	for i := 0; i+3 <= len(token); i++ {
		features = append(features, token[i:i+3])
	}
	return features
}

func normalize(vector []float64) {
	var norm float64
	for _, value := range vector {
		norm += value * value
	}
	if norm == 0 {
		return
	}
	norm = math.Sqrt(norm)
	for idx := range vector {
		vector[idx] = vector[idx] / norm
	}
}
