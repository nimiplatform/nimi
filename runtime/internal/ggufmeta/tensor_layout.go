package ggufmeta

import (
	"fmt"
	"io"
	"math"
)

// InspectModel validates the tensor table against the opened file size.
// The reader starts at offset zero. The returned end is exclusive and lets
// the caller check that the last tensor byte is physically readable.
// No tensor payload is read here.
func InspectModel(reader io.ReadSeeker, fileSize int64) (Summary, int64, error) {
	summary, err := InspectMetadata(reader)
	if err != nil {
		return Summary{}, 0, err
	}
	if summary.TensorCount == 0 {
		return Summary{}, 0, fmt.Errorf("GGUF model has zero tensors")
	}
	alignment := uint64(32)
	for _, entry := range summary.Entries {
		if entry.Key == "general.alignment" {
			alignment = entry.Uint64Value
			if entry.Type != ValueTypeUint32 || alignment == 0 || alignment&(alignment-1) != 0 {
				return Summary{}, 0, fmt.Errorf("invalid GGUF tensor alignment")
			}
			break
		}
	}
	align := func(n uint64) uint64 { return (n + alignment - 1) &^ (alignment - 1) }
	var nextOffset, payloadEnd uint64
	err = readTensorHeaders(reader, &summary, func(shape []uint64, tensorType uint32, offset uint64) error {
		if offset != nextOffset {
			return fmt.Errorf("offset %d does not match expected offset %d", offset, nextOffset)
		}
		size, err := tensorByteSize(shape, tensorType)
		if err != nil {
			return err
		}
		if size > math.MaxInt64-offset {
			return fmt.Errorf("tensor data range overflows")
		}
		payloadEnd = offset + size
		nextOffset = align(payloadEnd)
		if nextOffset > math.MaxInt64 {
			return fmt.Errorf("aligned tensor data range overflows")
		}
		return nil
	})
	if err != nil {
		return Summary{}, 0, err
	}
	headerEnd, err := reader.Seek(0, io.SeekCurrent)
	if err != nil {
		return Summary{}, 0, err
	}
	dataStart := align(uint64(headerEnd))
	if headerEnd < 0 || fileSize < 0 || dataStart > uint64(fileSize) || payloadEnd > uint64(fileSize)-dataStart {
		return Summary{}, 0, fmt.Errorf("GGUF tensor data extends past the file")
	}
	return summary, int64(dataStart + payloadEnd), nil
}

func tensorByteSize(shape []uint64, tensorType uint32) (uint64, error) {
	// Serialized GGML types from llama.cpp b12648, indexed by the GGUF type ID.
	// Removed type IDs have no block. Each pair is (elements, bytes) per block.
	blocks := [...]struct{ elements, bytes uint64 }{
		0: {1, 4}, 1: {1, 2}, 2: {32, 18}, 3: {32, 20},
		6: {32, 22}, 7: {32, 24}, 8: {32, 34}, 9: {32, 36},
		10: {256, 84}, 11: {256, 110}, 12: {256, 144}, 13: {256, 176},
		14: {256, 210}, 15: {256, 292}, 16: {256, 66}, 17: {256, 74},
		18: {256, 98}, 19: {256, 50}, 20: {32, 18}, 21: {256, 110},
		22: {256, 82}, 23: {256, 136}, 24: {1, 1}, 25: {1, 2},
		26: {1, 4}, 27: {1, 8}, 28: {1, 8}, 29: {256, 56},
		30: {1, 2}, 34: {256, 54}, 35: {256, 66}, 39: {32, 17},
		40: {64, 36}, 41: {128, 18}, 42: {64, 18}, 43: {1, 1},
	}
	if tensorType >= uint32(len(blocks)) || blocks[tensorType].elements == 0 {
		return 0, fmt.Errorf("unsupported tensor type %d", tensorType)
	}
	block := blocks[tensorType]
	if len(shape) == 0 || len(shape) > 4 || shape[0] == 0 || shape[0] > math.MaxInt64 || shape[0]%block.elements != 0 {
		return 0, fmt.Errorf("invalid tensor shape for type %d", tensorType)
	}
	elements := shape[0]
	for _, dimension := range shape[1:] {
		if dimension == 0 || dimension > math.MaxInt64/elements {
			return 0, fmt.Errorf("invalid tensor dimension %d", dimension)
		}
		elements *= dimension
	}
	count := elements / block.elements
	if count > math.MaxInt64/block.bytes {
		return 0, fmt.Errorf("tensor size overflows")
	}
	return count * block.bytes, nil
}
