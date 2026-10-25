package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

// probeSafetensorsHeader returns the existing length-prefixed header format.
// Tensor bodies remain subject to the ModelAsset owner's content verification.
// @nimi-authority: rule.nimi.runtime.local-compute.r100
func probeSafetensorsHeader(source io.ReaderAt, size int64) ([]byte, error) {
	if size < 10 {
		return nil, fmt.Errorf("safetensors file cannot contain a complete header")
	}
	var prefix [8]byte
	if _, err := source.ReadAt(prefix[:], 0); err != nil {
		return nil, fmt.Errorf("read safetensors header length: %w", err)
	}
	length := binary.LittleEndian.Uint64(prefix[:])
	if length < 2 || length > MaxSafetensorsHeaderBytes || length > uint64(size-8) {
		return nil, fmt.Errorf("safetensors header exceeds its bound")
	}
	probe := make([]byte, 8+int(length))
	copy(probe, prefix[:])
	if _, err := source.ReadAt(probe[8:], 8); err != nil {
		return nil, fmt.Errorf("read safetensors header: %w", err)
	}
	tensors, valid := safetensorsTensorFacts(probe)
	if !valid {
		return nil, fmt.Errorf("safetensors tensor interface is invalid")
	}
	for _, tensor := range tensors {
		if tensor.DataOffsets[1] > size-8-int64(length) {
			return nil, fmt.Errorf("safetensors tensor exceeds its file")
		}
	}
	return probe, nil
}

func probeCompleteModelAssetJSON(source io.ReaderAt, size int64) ([]byte, error) {
	if size <= 0 || size > MaxAssetFormatProbeBytes {
		return nil, fmt.Errorf("model configuration exceeds its probe bound")
	}
	probe := make([]byte, int(size))
	if _, err := source.ReadAt(probe, 0); err != nil {
		return nil, fmt.Errorf("read model configuration: %w", err)
	}
	if !json.Valid(probe) {
		return nil, fmt.Errorf("model configuration is not complete JSON")
	}
	return probe, nil
}
