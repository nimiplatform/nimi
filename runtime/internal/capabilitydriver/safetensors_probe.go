package capabilitydriver

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"slices"
)

var errInvalidSafetensorsHeader = errors.New("invalid safetensors header")

func matchTensorShapes(tensors map[string]safetensorsTensorFact, expected map[string][]int64) bool {
	for name, shape := range expected {
		tensor, ok := tensors[name]
		if !ok || !slices.Equal(tensor.Shape, shape) {
			return false
		}
	}
	return true
}

// probeSafetensorsHeader returns the existing length-prefixed header format.
// Tensor bodies remain subject to the ModelAsset owner's content verification.
// @nimi-authority: rule.nimi.runtime.local-compute.r100
func probeSafetensorsHeader(source io.ReaderAt, size int64) ([]byte, error) {
	header, _, err := readSafetensorsHeader(io.NewSectionReader(source, 0, size), size)
	return header, err
}

func readSafetensorsHeader(source io.Reader, size int64) ([]byte, map[string]safetensorsTensorFact, error) {
	if size < 10 {
		return nil, nil, fmt.Errorf("%w: file cannot contain a complete header", errInvalidSafetensorsHeader)
	}
	var prefix [8]byte
	if _, err := io.ReadFull(source, prefix[:]); err != nil {
		return nil, nil, fmt.Errorf("read safetensors header length: %w", err)
	}
	length := binary.LittleEndian.Uint64(prefix[:])
	if length < 2 || length > MaxSafetensorsHeaderBytes || length > uint64(size-8) {
		return nil, nil, fmt.Errorf("%w: header exceeds its bound", errInvalidSafetensorsHeader)
	}
	probe := make([]byte, 8+int(length))
	copy(probe, prefix[:])
	if _, err := io.ReadFull(source, probe[8:]); err != nil {
		return nil, nil, fmt.Errorf("read safetensors header: %w", err)
	}
	tensors, valid := safetensorsTensorFacts(probe)
	if !valid {
		return nil, nil, fmt.Errorf("%w: tensor interface is invalid", errInvalidSafetensorsHeader)
	}
	for _, tensor := range tensors {
		if tensor.DataOffsets[1] > size-8-int64(length) {
			return nil, nil, fmt.Errorf("%w: tensor exceeds its file", errInvalidSafetensorsHeader)
		}
	}
	return probe, tensors, nil
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
