package main

import (
	"fmt"
	"io"
)

const (
	maxConfigInputBytes        = 1 << 20
	maxGitHubResponseBodyBytes = 16 << 20
)

func readAllBounded(reader io.Reader, maxBytes int64, label string) ([]byte, error) {
	if maxBytes <= 0 {
		return io.ReadAll(reader)
	}
	limited := io.LimitReader(reader, maxBytes+1)
	raw, err := io.ReadAll(limited)
	if err != nil {
		return nil, err
	}
	if int64(len(raw)) > maxBytes {
		return nil, fmt.Errorf("%s exceeds %d bytes", label, maxBytes)
	}
	return raw, nil
}
