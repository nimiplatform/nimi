package nimillm

import (
	"encoding/binary"
	"fmt"
)

// This exact data-length marker is observed in completed CosyVoice WORD and
// DashScope voice-design preview WAVs.
// RIFF's matching marker includes the actual prefix chunk headers/padding.
const dashScopeStreamingWAVDataSize uint32 = 2147483547

// finishCompletedDashScopeWAV requires native completion evidence: a valid
// CosyVoice SSE stop or a successful voice-design JSON result with a created
// handle and its complete inline preview.
// A streaming data chunk ends at EOF. Only its known length marker and its
// structurally matching RIFF marker can be finalized; arbitrary mismatches fail.
// PCM and all actual chunk bytes are retained, without resampling or estimating.
// @nimi-authority: rule.nimi.runtime.ai-provider.dashscope-voice-preview
func finishCompletedDashScopeWAV(audio []byte) ([]byte, error) {
	invalid := func() ([]byte, error) { return nil, fmt.Errorf("invalid completed DashScope WAV") }
	if len(audio) < 44 || len(audio) > 32*1024*1024 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" {
		return invalid()
	}
	riffSize := binary.LittleEndian.Uint32(audio[4:8])
	finite := uint64(riffSize)+8 == uint64(len(audio))
	formatSeen := false
	for offset := 12; offset < len(audio); {
		if offset+8 > len(audio) {
			return invalid()
		}
		size := binary.LittleEndian.Uint32(audio[offset+4 : offset+8])
		start := offset + 8
		if string(audio[offset:offset+4]) == "data" && !finite {
			if !formatSeen || !geminiWAVPCM16(audio) || size != dashScopeStreamingWAVDataSize || uint64(riffSize) != uint64(size)+uint64(start-8) {
				return invalid()
			}
			actual := len(audio) - start
			if actual <= 0 {
				return invalid()
			}
			result := append([]byte(nil), audio...)
			binary.LittleEndian.PutUint32(result[4:8], uint32(len(result)-8))
			binary.LittleEndian.PutUint32(result[offset+4:offset+8], uint32(actual))
			if _, _, _, err := inspectFiniteMonoPCMWAV(result); err != nil {
				return invalid()
			}
			return result, nil
		}
		if uint64(size) > uint64(len(audio)-start) {
			return invalid()
		}
		if string(audio[offset:offset+4]) == "fmt " {
			if formatSeen || (size != 16 && size != 18) || (size == 18 && binary.LittleEndian.Uint16(audio[start+16:start+18]) != 0) {
				return invalid()
			}
			formatSeen = true
		}
		offset = start + int(size) + int(size&1)
		if offset > len(audio) {
			return invalid()
		}
	}
	if !finite {
		return invalid()
	}
	if _, _, _, err := inspectFiniteMonoPCMWAV(audio); err != nil {
		return invalid()
	}
	return audio, nil
}

func inspectFiniteMonoPCMWAV(audio []byte) (uint32, int, uint16, error) {
	if len(audio) < 44 || len(audio) > 32*1024*1024 || string(audio[:4]) != "RIFF" || string(audio[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(audio[4:8]))+8 != uint64(len(audio)) {
		return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
	}
	var rate uint32
	var align uint16
	var dataSize int
	hasFormat := false
	for offset := 12; offset < len(audio); {
		if offset+8 > len(audio) {
			return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
		}
		size := int(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size > len(audio)-start {
			return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
		}
		switch string(audio[offset : offset+4]) {
		case "fmt ":
			if hasFormat || size < 16 {
				return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
			}
			hasFormat = true
			format := binary.LittleEndian.Uint16(audio[start : start+2])
			channels := binary.LittleEndian.Uint16(audio[start+2 : start+4])
			rate = binary.LittleEndian.Uint32(audio[start+4 : start+8])
			align = binary.LittleEndian.Uint16(audio[start+12 : start+14])
			bits := binary.LittleEndian.Uint16(audio[start+14 : start+16])
			if format != 1 || channels != 1 || rate == 0 || (bits != 8 && bits != 16 && bits != 24 && bits != 32) || align != bits/8 || uint64(binary.LittleEndian.Uint32(audio[start+8:start+12])) != uint64(rate)*uint64(align) {
				return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
			}
		case "data":
			if dataSize != 0 || size == 0 {
				return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
			}
			dataSize = size
		}
		offset = start + size + size%2
		if offset > len(audio) {
			return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
		}
	}
	if !hasFormat || dataSize == 0 || dataSize%int(align) != 0 {
		return 0, 0, 0, fmt.Errorf("invalid finite mono PCM WAV")
	}
	return rate, dataSize, align, nil
}
