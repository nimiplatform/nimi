package runtimeartifact

func validCanonicalAudioMetadata(record ArtifactRecord) bool {
	facts := record.CanonicalAudio
	if facts == nil {
		return true
	}
	return record.Owner != nil && record.MimeType == "audio/wav" && facts.SampleRateHz >= 8000 && facts.SampleRateHz <= 96000 && (facts.Channels == 1 || facts.Channels == 2) && facts.FrameCount > 0 && facts.FrameCount <= uint64(facts.SampleRateHz)*600 && facts.DataOffset >= 44 && facts.DataOffset <= record.SizeBytes && int64(facts.FrameCount)*int64(facts.Channels)*4 <= record.SizeBytes-facts.DataOffset
}
