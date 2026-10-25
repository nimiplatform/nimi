package capabilitydriver

import "io"

// Qwen3 speech binding projection consumes only its entry's tensor header.
// Every declared file still passes the LocalService size, content and path
// checks; unused companion bytes are not additional format evidence.
func probeQwen3SpeechModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	if !input.Entry {
		return nil, nil
	}
	return probeSafetensorsHeader(source, size)
}

func (Qwen3TTSDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	return probeQwen3SpeechModelAsset(input, source, size)
}

// Qwen3VoiceLibraryDriver inherits this probe for each of its two exact axes.
func (Qwen3VoiceCreateDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	return probeQwen3SpeechModelAsset(input, source, size)
}

func (Qwen3ASRDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	return probeQwen3SpeechModelAsset(input, source, size)
}

// Qwen3ASRAlignedDriver inherits this probe for model and aligner entries.
func (Qwen3ASRTransformersDriver) ProbeModelAsset(input ModelAssetFormatProbeInput, source io.ReaderAt, size int64) ([]byte, error) {
	return probeQwen3SpeechModelAsset(input, source, size)
}
