package capabilitydriver

// These exact Drivers consume only the GGUF magic in their format probes.
// Their original complete file names/sizes, fixed content IDs, exact bindings
// and Job-time payload verification remain separate, unchanged requirements.
// Metadata-driven AudioCppTTS/ASR/ReferenceVoice Drivers do not inherit this.
// @nimi-authority: rule.nimi.runtime.local-compute.r100
func (MiniMaxMusic3AudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}

func (HTDemucsAudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}

func (YuE2AudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}

func (SheetSage2AudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}

func (VeVo2AudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}

func (Qwen3TTSAudioCppDriver) ModelAssetFormatProbeBytes(ModelAssetFormatProbeInput) int64 {
	return 4
}
