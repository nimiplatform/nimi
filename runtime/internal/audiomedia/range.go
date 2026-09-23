package audiomedia

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
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

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription
// CopyCanonicalRange takes one already-authorized immutable canonical source.
// It writes exact float samples without decoding, resampling or normalization.
func CopyCanonicalRange(ctx context.Context, source io.ReadSeeker, facts Facts, start, end uint64, path string) (_ Facts, err error) {
	if source == nil || !validFormat(facts.SampleRateHz, facts.Channels) || facts.FrameCount == 0 || facts.FrameCount > uint64(facts.SampleRateHz)*MaxSeconds || facts.DataOffset < 12 || facts.SizeBytes > MaxInputBytes || facts.DataOffset+int64(facts.FrameCount)*int64(facts.Channels)*4 > facts.SizeBytes || end <= start || end > facts.FrameCount {
		return Facts{}, fmt.Errorf("canonical source range is invalid")
	}
	if err := ctx.Err(); err != nil {
		return Facts{}, err
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return Facts{}, fmt.Errorf("create canonical range: %w", err)
	}
	complete := false
	defer func() {
		_ = file.Close()
		if !complete {
			_ = os.Remove(path)
		}
	}()
	dataBytes := int64(end-start) * int64(facts.Channels) * 4
	if err := writeHeader(file, facts.SampleRateHz, facts.Channels, dataBytes); err != nil {
		return Facts{}, err
	}
	if _, err := file.Seek(pcmHeaderBytes, io.SeekStart); err != nil {
		return Facts{}, err
	}
	if _, err := source.Seek(facts.DataOffset+int64(start)*int64(facts.Channels)*4, io.SeekStart); err != nil {
		return Facts{}, fmt.Errorf("seek canonical source: %w", err)
	}
	count, err := copyFinitePCM(ctx, file, io.LimitReader(source, dataBytes), dataBytes)
	if err != nil {
		return Facts{}, fmt.Errorf("copy canonical range: %w", err)
	}
	if count != dataBytes {
		return Facts{}, fmt.Errorf("canonical source range is incomplete")
	}
	if err := ctx.Err(); err != nil {
		return Facts{}, err
	}
	if err := file.Close(); err != nil {
		return Facts{}, fmt.Errorf("close canonical range: %w", err)
	}
	complete = true
	return Facts{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: end - start, DataOffset: pcmHeaderBytes, SizeBytes: pcmHeaderBytes + dataBytes}, nil
}

// SumCanonical writes one canonical float WAV that is the sample-wise sum of
// equally-shaped canonical sources. It preserves the exact frame timeline and
// never resamples or downmixes; it is the explicit "sum of non-vocal sources".
func SumCanonical(ctx context.Context, sources []io.ReadSeeker, facts Facts, path string) (_ Facts, err error) {
	if len(sources) < 2 || !validFormat(facts.SampleRateHz, facts.Channels) || facts.FrameCount == 0 || facts.FrameCount > uint64(facts.SampleRateHz)*MaxSeconds {
		return Facts{}, fmt.Errorf("canonical sum input is invalid")
	}
	for _, source := range sources {
		if source == nil {
			return Facts{}, fmt.Errorf("canonical sum source is nil")
		}
	}
	dataBytes := int64(facts.FrameCount) * int64(facts.Channels) * 4
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return Facts{}, fmt.Errorf("create canonical sum: %w", err)
	}
	complete := false
	defer func() {
		_ = file.Close()
		if !complete {
			_ = os.Remove(path)
		}
	}()
	if err := writeHeader(file, facts.SampleRateHz, facts.Channels, dataBytes); err != nil {
		return Facts{}, err
	}
	if _, err := file.Seek(pcmHeaderBytes, io.SeekStart); err != nil {
		return Facts{}, err
	}
	for _, source := range sources {
		if _, err := source.Seek(facts.DataOffset, io.SeekStart); err != nil {
			return Facts{}, fmt.Errorf("seek canonical sum source: %w", err)
		}
	}
	samplesPerFrame := int64(facts.Channels)
	chunkFrames := int64(16384)
	chunkSamples := chunkFrames * samplesPerFrame
	inputs := make([][]byte, len(sources))
	for index := range inputs {
		inputs[index] = make([]byte, chunkSamples*4)
	}
	accumulator := make([]float32, chunkSamples)
	output := make([]byte, chunkSamples*4)
	for start := int64(0); start < int64(facts.FrameCount); {
		frames := chunkFrames
		if remaining := int64(facts.FrameCount) - start; frames > remaining {
			frames = remaining
		}
		count := frames * samplesPerFrame
		for index := range accumulator {
			accumulator[index] = 0
		}
		for index, source := range sources {
			chunk := inputs[index][:count*4]
			if _, err := io.ReadFull(source, chunk); err != nil {
				return Facts{}, fmt.Errorf("read canonical sum source: %w", err)
			}
			for sample := int64(0); sample < count; sample++ {
				accumulator[sample] += math.Float32frombits(binary.LittleEndian.Uint32(chunk[sample*4:]))
			}
		}
		if err := ctx.Err(); err != nil {
			return Facts{}, err
		}
		for sample := int64(0); sample < count; sample++ {
			binary.LittleEndian.PutUint32(output[sample*4:], math.Float32bits(accumulator[sample]))
		}
		if _, err := file.Write(output[:count*4]); err != nil {
			return Facts{}, fmt.Errorf("write canonical sum: %w", err)
		}
		start += frames
	}
	if err := ctx.Err(); err != nil {
		return Facts{}, err
	}
	if err := file.Close(); err != nil {
		return Facts{}, fmt.Errorf("close canonical sum: %w", err)
	}
	complete = true
	return Facts{SampleRateHz: facts.SampleRateHz, Channels: facts.Channels, FrameCount: facts.FrameCount, DataOffset: pcmHeaderBytes, SizeBytes: pcmHeaderBytes + dataBytes}, nil
}
