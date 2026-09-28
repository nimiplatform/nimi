package nimillm

import "encoding/binary"

// geminiWAVPCM16 narrows the shared Gemini unary WAV carrier to the sample
// width declared by the admitted TTS output and inline transcription input.
// The caller also validates the complete RIFF structure, channel count, rate
// and nonempty data through finiteASRWAVInfo.
func geminiWAVPCM16(audio []byte) bool {
	for offset := 12; offset+8 <= len(audio); {
		size := int(binary.LittleEndian.Uint32(audio[offset+4 : offset+8]))
		start := offset + 8
		if size < 0 || size > len(audio)-start {
			return false
		}
		if string(audio[offset:offset+4]) == "fmt " {
			return size >= 16 && binary.LittleEndian.Uint16(audio[start+14:start+16]) == 16
		}
		offset = start + size + size%2
	}
	return false
}
