// Package audiomedia owns the immutable PCM timeline used for music editing.
package audiomedia

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"math"
	"os"
)

const (
	MaxInputBytes  int64 = 512 << 20
	MaxSeconds           = 600
	MinSampleRate        = 8000
	MaxSampleRate        = 96000
	pcmHeaderBytes       = 58
	bufferBytes          = 64 << 10
)

// Facts describe actual complete samples; a frame contains one sample per channel.
type Facts struct {
	SampleRateHz uint32
	Channels     uint16
	FrameCount   uint64
	SizeBytes    int64
	DataOffset   int64
}

func (f Facts) DurationMilliseconds() uint64 {
	if f.SampleRateHz == 0 {
		return 0
	}
	return f.FrameCount * 1000 / uint64(f.SampleRateHz)
}

func validFormat(rate uint32, channels uint16) bool {
	return rate >= MinSampleRate && rate <= MaxSampleRate && (channels == 1 || channels == 2)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.canonical-audio-preparation
// InspectCanonical validates the complete float payload with bounded memory.
func InspectCanonical(ctx context.Context, path string) (Facts, error) {
	file, err := os.Open(path)
	if err != nil {
		return Facts{}, fmt.Errorf("open canonical audio: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() < pcmHeaderBytes || info.Size() > MaxInputBytes {
		return Facts{}, fmt.Errorf("canonical audio size or file type is invalid")
	}
	var header [12]byte
	if _, err := io.ReadFull(file, header[:]); err != nil || string(header[:4]) != "RIFF" || string(header[8:]) != "WAVE" || int64(binary.LittleEndian.Uint32(header[4:8]))+8 != info.Size() {
		return Facts{}, fmt.Errorf("canonical audio is not a complete RIFF/WAVE file")
	}
	facts := Facts{SizeBytes: info.Size()}
	var dataBytes, factFrames uint32
	haveFormat, haveData, haveFact := false, false, false
	for offset := int64(12); offset < info.Size(); {
		if err := ctx.Err(); err != nil {
			return Facts{}, err
		}
		var chunk [8]byte
		if _, err := file.ReadAt(chunk[:], offset); err != nil {
			return Facts{}, fmt.Errorf("read WAV chunk: %w", err)
		}
		size := binary.LittleEndian.Uint32(chunk[4:])
		payload := offset + 8
		next := payload + int64(size) + int64(size&1)
		if next > info.Size() {
			return Facts{}, fmt.Errorf("WAV chunk exceeds actual file length")
		}
		switch string(chunk[:4]) {
		case "fmt ":
			if haveFormat || (size != 16 && size != 18 && size != 40) {
				return Facts{}, fmt.Errorf("WAV format chunk is invalid")
			}
			var format [40]byte
			if _, err := file.ReadAt(format[:size], payload); err != nil {
				return Facts{}, fmt.Errorf("read WAV format: %w", err)
			}
			encoding := binary.LittleEndian.Uint16(format[:2])
			if encoding == 0xfffe && size == 40 {
				floatGUID := [16]byte{3, 0, 0, 0, 0, 0, 16, 0, 128, 0, 0, 170, 0, 56, 155, 113}
				if binary.LittleEndian.Uint16(format[16:18]) != 22 || binary.LittleEndian.Uint16(format[18:20]) != 32 || [16]byte(format[24:40]) != floatGUID {
					return Facts{}, fmt.Errorf("WAV extensible format is not float32")
				}
			} else if encoding != 3 || size == 40 || (size == 18 && binary.LittleEndian.Uint16(format[16:18]) != 0) {
				return Facts{}, fmt.Errorf("WAV encoding is not float32")
			}
			facts.Channels = binary.LittleEndian.Uint16(format[2:4])
			facts.SampleRateHz = binary.LittleEndian.Uint32(format[4:8])
			if !validFormat(facts.SampleRateHz, facts.Channels) || binary.LittleEndian.Uint16(format[14:16]) != 32 || binary.LittleEndian.Uint16(format[12:14]) != facts.Channels*4 || binary.LittleEndian.Uint32(format[8:12]) != facts.SampleRateHz*uint32(facts.Channels)*4 {
				return Facts{}, fmt.Errorf("WAV sample format is outside the admitted profile")
			}
			haveFormat = true
		case "data":
			if haveData || size == 0 {
				return Facts{}, fmt.Errorf("WAV must contain one nonempty data chunk")
			}
			facts.DataOffset, dataBytes, haveData = payload, size, true
		case "fact":
			if haveFact || size != 4 {
				return Facts{}, fmt.Errorf("canonical WAV fact chunk is invalid")
			}
			var fact [4]byte
			if _, err := file.ReadAt(fact[:], payload); err != nil {
				return Facts{}, fmt.Errorf("read WAV fact: %w", err)
			}
			factFrames, haveFact = binary.LittleEndian.Uint32(fact[:]), true
		}
		offset = next
	}
	if !haveFormat || !haveData || !haveFact || dataBytes%uint32(facts.Channels*4) != 0 {
		return Facts{}, fmt.Errorf("WAV has missing format or incomplete frames")
	}
	facts.FrameCount = uint64(dataBytes) / uint64(facts.Channels*4)
	if uint64(factFrames) != facts.FrameCount {
		return Facts{}, fmt.Errorf("WAV fact disagrees with the actual PCM frame count")
	}
	if facts.FrameCount > uint64(facts.SampleRateHz)*MaxSeconds {
		return Facts{}, fmt.Errorf("decoded audio exceeds %d seconds", MaxSeconds)
	}
	reader := io.NewSectionReader(file, facts.DataOffset, int64(dataBytes))
	if _, err := copyFinitePCM(ctx, io.Discard, reader, int64(dataBytes)); err != nil {
		return Facts{}, err
	}
	return facts, nil
}

func copyFinitePCM(ctx context.Context, writer io.Writer, reader io.Reader, limit int64) (int64, error) {
	buffer := make([]byte, bufferBytes)
	var total int64
	for {
		if err := ctx.Err(); err != nil {
			return total, err
		}
		n, err := io.ReadFull(reader, buffer)
		if n%4 != 0 || int64(n) > limit-total {
			return total, fmt.Errorf("decoded audio has incomplete samples or exceeds its bound")
		}
		for offset := 0; offset < n; offset += 4 {
			bits := binary.LittleEndian.Uint32(buffer[offset : offset+4])
			if bits&0x7f800000 == 0x7f800000 {
				return total, fmt.Errorf("decoded audio contains a non-finite sample")
			}
		}
		if n != 0 {
			written, writeErr := writer.Write(buffer[:n])
			total += int64(written)
			if writeErr != nil {
				return total, fmt.Errorf("write canonical samples: %w", writeErr)
			}
			if written != n {
				return total, io.ErrShortWrite
			}
		}
		if err == io.EOF || err == io.ErrUnexpectedEOF {
			return total, nil
		}
		if err != nil {
			return total, fmt.Errorf("read decoded samples: %w", err)
		}
	}
}

func writeHeader(writer io.WriterAt, rate uint32, channels uint16, dataBytes int64) error {
	if !validFormat(rate, channels) || dataBytes < 0 || dataBytes > math.MaxUint32-pcmHeaderBytes || dataBytes%int64(channels*4) != 0 {
		return fmt.Errorf("invalid canonical WAV header facts")
	}
	var header [pcmHeaderBytes]byte
	copy(header[:4], "RIFF")
	binary.LittleEndian.PutUint32(header[4:8], uint32(dataBytes)+pcmHeaderBytes-8)
	copy(header[8:16], "WAVEfmt ")
	binary.LittleEndian.PutUint32(header[16:20], 18)
	binary.LittleEndian.PutUint16(header[20:22], 3)
	binary.LittleEndian.PutUint16(header[22:24], channels)
	binary.LittleEndian.PutUint32(header[24:28], rate)
	binary.LittleEndian.PutUint32(header[28:32], rate*uint32(channels)*4)
	binary.LittleEndian.PutUint16(header[32:34], channels*4)
	binary.LittleEndian.PutUint16(header[34:36], 32)
	copy(header[38:42], "fact")
	binary.LittleEndian.PutUint32(header[42:46], 4)
	binary.LittleEndian.PutUint32(header[46:50], uint32(dataBytes/int64(channels*4)))
	copy(header[50:54], "data")
	binary.LittleEndian.PutUint32(header[54:58], uint32(dataBytes))
	_, err := writer.WriteAt(header[:], 0)
	return err
}
