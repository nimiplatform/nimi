package nimillm

import (
	"context"
	"encoding/binary"
	"fmt"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
	"google.golang.org/grpc/codes"
)

// nativeSpeechArtifact checks the returned format and takes file metadata from
// its actual container. Raw mono encodings use the captured native wire rate.
func nativeSpeechArtifact(ctx context.Context, audio []byte, encoding string, rate int32, metadata map[string]any) (*runtimev1.ScenarioArtifact, error) {
	invalid := func() (*runtimev1.ScenarioArtifact, error) {
		return nil, grpcerr.WithReasonCode(codes.Internal, runtimev1.ReasonCode_AI_OUTPUT_INVALID)
	}
	if len(audio) == 0 || len(audio) > maxJSONOrBinaryResponseBytes {
		return invalid()
	}
	var mime string
	var actualRate, channels int32
	var duration int64
	switch encoding {
	case "wav", "wav_mulaw", "wav_alaw":
		code := uint16(1)
		if encoding == "wav_mulaw" {
			code = 7
		} else if encoding == "wav_alaw" {
			code = 6
		}
		r, size, align, ch, err := inspectFiniteWAVEncoding(audio, code)
		if err != nil || ch != 1 || code == 1 && align != 2 {
			return invalid()
		}
		mime, actualRate, channels, duration = "audio/wav", int32(r), int32(ch), int64(size)*1000/int64(uint64(r)*uint64(align))
	case "mp3":
		r, seconds, ok := inspectCompleteMP3(ctx, audio)
		if !ok {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return invalid()
		}
		mime, actualRate, duration = "audio/mpeg", int32(r), int64(seconds*1000)
	case "pcm", "mulaw", "alaw":
		width := 1
		if encoding == "pcm" {
			width = 2
		}
		if rate <= 0 || len(audio)%width != 0 {
			return invalid()
		}
		mime, actualRate, channels, duration = "audio/"+encoding, rate, 1, int64(len(audio))*1000/int64(rate)/int64(width)
	case "ogg_opus", "ogg_vorbis":
		r, ch, frames, err := inspectNativeSpeechOgg(ctx, audio, encoding)
		if err != nil {
			if ctx.Err() != nil {
				return nil, ctx.Err()
			}
			return invalid()
		}
		mime, actualRate, channels, duration = "audio/ogg", r, ch, frames*1000/int64(r)
	default:
		return invalid()
	}
	if rate > 0 && rate != actualRate {
		return invalid()
	}
	artifact := BinaryArtifact(mime, audio, metadata)
	artifact.SampleRateHz, artifact.Channels, artifact.DurationMs = actualRate, channels, duration
	return artifact, nil
}

// Validate the complete single-stream Ogg container, codec identity, checksum
// and terminal granule. This is container validation, not a decoded quality test.
func inspectNativeSpeechOgg(ctx context.Context, audio []byte, encoding string) (int32, int32, int64, error) {
	bad := func() (int32, int32, int64, error) { return 0, 0, 0, fmt.Errorf("invalid native speech Ogg") }
	var serial, sequence uint32
	var firstPacket []byte
	var packetBytes, packets int
	var finalFrames uint64
	var ended, continuing bool
	for offset := 0; offset < len(audio); {
		if ctx.Err() != nil {
			return 0, 0, 0, ctx.Err()
		}
		if ended || len(audio)-offset < 27 || string(audio[offset:offset+4]) != "OggS" || audio[offset+4] != 0 {
			return bad()
		}
		h := audio[offset:]
		flags, segments := h[5], int(h[26])
		if flags & ^byte(7) != 0 || (flags&1 != 0) != continuing || len(h) < 27+segments {
			return bad()
		}
		if offset == 0 {
			serial = binary.LittleEndian.Uint32(h[14:18])
			if flags&2 == 0 {
				return bad()
			}
		} else if flags&2 != 0 {
			return bad()
		}
		if binary.LittleEndian.Uint32(h[14:18]) != serial || binary.LittleEndian.Uint32(h[18:22]) != sequence {
			return bad()
		}
		sequence++
		size := 27 + segments
		for _, lace := range h[27 : 27+segments] {
			size += int(lace)
		}
		if size > len(h) {
			return bad()
		}
		page := h[:size]
		var crc uint32
		for i, value := range page {
			if i >= 22 && i < 26 {
				value = 0
			}
			crc ^= uint32(value) << 24
			for bit := 0; bit < 8; bit++ {
				if crc&0x80000000 != 0 {
					crc = crc<<1 ^ 0x04c11db7
				} else {
					crc <<= 1
				}
			}
		}
		if crc != binary.LittleEndian.Uint32(h[22:26]) {
			return bad()
		}
		start := 27 + segments
		for _, lace := range h[27 : 27+segments] {
			n := int(lace)
			if packets == 0 {
				if len(firstPacket)+n > 8192 {
					return bad()
				}
				firstPacket = append(firstPacket, h[start:start+n]...)
			}
			packetBytes += n
			start += n
			continuing = lace == 255
			if !continuing {
				if packetBytes == 0 {
					return bad()
				}
				packets++
				packetBytes = 0
			}
		}
		ended = flags&4 != 0
		if ended {
			if continuing {
				return bad()
			}
			finalFrames = binary.LittleEndian.Uint64(h[6:14])
		}
		offset += size
	}
	if !ended || finalFrames == 0 || finalFrames > (1<<63-1)/1000 {
		return bad()
	}
	if encoding == "ogg_opus" {
		if packets < 3 || len(firstPacket) != 19 || string(firstPacket[:8]) != "OpusHead" || firstPacket[8] != 1 || firstPacket[9] != 1 || firstPacket[18] != 0 {
			return bad()
		}
		skip := uint64(binary.LittleEndian.Uint16(firstPacket[10:12]))
		if finalFrames <= skip {
			return bad()
		}
		return 48000, 1, int64(finalFrames - skip), nil
	}
	if packets < 4 || len(firstPacket) != 30 || firstPacket[0] != 1 || string(firstPacket[1:7]) != "vorbis" || binary.LittleEndian.Uint32(firstPacket[7:11]) != 0 || firstPacket[11] != 1 || firstPacket[29]&1 != 1 {
		return bad()
	}
	rate := binary.LittleEndian.Uint32(firstPacket[12:16])
	if rate < 8000 || rate > 48000 {
		return bad()
	}
	return int32(rate), 1, int64(finalFrames), nil
}
