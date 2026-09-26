package memoryv1

import (
	"bytes"
	"encoding/json"
	"math"
	"strconv"
)

// Stored vectors are JSON arrays of finite numbers. Validate the JSON grammar,
// then decode scalars into the caller's fixed-size scratch buffer without the
// reflection and per-vector slice growth of a general JSON object decoder.
func decodeMemoryVector(raw []byte, scratch []float64, dimension int) ([]float64, bool) {
	if !json.Valid(raw) {
		return nil, false
	}
	raw = bytes.TrimSpace(raw)
	if len(raw) < 2 || raw[0] != '[' || raw[len(raw)-1] != ']' {
		return nil, false
	}
	body := bytes.TrimSpace(raw[1 : len(raw)-1])
	values := scratch[:0]
	for len(body) > 0 {
		if len(values) >= dimension {
			return nil, false
		}
		end := bytes.IndexByte(body, ',')
		if end < 0 {
			end = len(body)
		}
		value, err := strconv.ParseFloat(string(bytes.TrimSpace(body[:end])), 64)
		if err != nil || math.IsNaN(value) || math.IsInf(value, 0) {
			return nil, false
		}
		values = append(values, value)
		if end == len(body) {
			break
		}
		body = body[end+1:]
	}
	return values, len(values) == dimension
}

type scoredMemory struct {
	memory Memory
	score  float64
}
type memoryTopK []scoredMemory

func (h memoryTopK) Len() int           { return len(h) }
func (h memoryTopK) Less(i, j int) bool { return betterMemory(h[j], h[i]) }
func (h memoryTopK) Swap(i, j int)      { h[i], h[j] = h[j], h[i] }
func (h *memoryTopK) Push(value any)    { *h = append(*h, value.(scoredMemory)) }
func (h *memoryTopK) Pop() any {
	old := *h
	value := old[len(old)-1]
	*h = old[:len(old)-1]
	return value
}
func betterMemory(a, b scoredMemory) bool {
	if a.score != b.score {
		return a.score > b.score
	}
	if !a.memory.UpdatedAt.Equal(b.memory.UpdatedAt) {
		return a.memory.UpdatedAt.After(b.memory.UpdatedAt)
	}
	return a.memory.MemoryRef < b.memory.MemoryRef
}
func vectorNorm(values []float64) float64 {
	var sum float64
	for _, v := range values {
		sum += v * v
	}
	return math.Sqrt(sum)
}
func cosineWithNorm(query, value []float64, queryNorm float64) float64 {
	var dot, norm float64
	for i, v := range value {
		dot += query[i] * v
		norm += v * v
	}
	if queryNorm == 0 || norm == 0 {
		return 0
	}
	return dot / (queryNorm * math.Sqrt(norm))
}
