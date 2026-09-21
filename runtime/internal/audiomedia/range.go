package audiomedia

import (
	"context"
	"fmt"
	"io"
)

type headerBuffer [pcmHeaderBytes]byte

func (h *headerBuffer) WriteAt(data []byte, offset int64) (int, error) {
	if offset < 0 || offset+int64(len(data)) > pcmHeaderBytes {
		return 0, io.ErrShortWrite
	}
	return copy(h[int(offset):], data), nil
}

// ReadRange copies a bounded half-open selection from already validated PCM.
// It does not resample, trim silence or alter any selected float samples.
func ReadRange(ctx context.Context, source io.ReadSeeker, facts Facts, start, end uint64, maxBytes int64) ([]byte, error) {
	if !validFormat(facts.SampleRateHz, facts.Channels) || start >= end || end > facts.FrameCount {
		return nil, fmt.Errorf("canonical audio frame range is invalid")
	}
	dataBytes := int64(end-start) * int64(facts.Channels) * 4
	if dataBytes+pcmHeaderBytes > maxBytes {
		return nil, fmt.Errorf("canonical audio selection exceeds the admitted byte bound")
	}
	var header headerBuffer
	if err := writeHeader(&header, facts.SampleRateHz, facts.Channels, dataBytes); err != nil {
		return nil, err
	}
	if _, err := source.Seek(facts.DataOffset+int64(start)*int64(facts.Channels)*4, io.SeekStart); err != nil {
		return nil, err
	}
	result := make([]byte, int(dataBytes)+pcmHeaderBytes)
	copy(result, header[:])
	for offset := pcmHeaderBytes; offset < len(result); {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		end := min(offset+bufferBytes, len(result))
		if _, err := io.ReadFull(source, result[offset:end]); err != nil {
			return nil, err
		}
		offset = end
	}
	return result, nil
}
