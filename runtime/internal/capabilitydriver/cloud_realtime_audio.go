package capabilitydriver

import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"

// @nimi-authority: rule.nimi.runtime.ai-provider.r113
// Open returns the captured driver's PCM tuple before any microphone samples
// are accepted. The Host already captures the negotiated tuple.
func realtimeInputAudioAtRate(proposed *runtimev1.AiRealtimeAudioFormat, rate uint32) (*runtimev1.AiRealtimeAudioFormat, error) {
	if proposed == nil || proposed.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE || proposed.GetChannelCount() != 1 ||
		(proposed.GetSampleRateHz() != 16000 && proposed.GetSampleRateHz() != 24000) ||
		(proposed.GetFrameDurationMs() != 20 && proposed.GetFrameDurationMs() != 100) ||
		proposed.GetMaximumFrameBytes() != proposed.GetSampleRateHz()*proposed.GetFrameDurationMs()*2/1000 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: rate}
	}
	return &runtimev1.AiRealtimeAudioFormat{Codec: proposed.Codec, SampleRateHz: rate, ChannelCount: 1, FrameDurationMs: proposed.FrameDurationMs, MaximumFrameBytes: rate * proposed.FrameDurationMs * 2 / 1000}, nil
}

func (openAIRealtimeDriver) NegotiateInputAudio(proposed *runtimev1.AiRealtimeAudioFormat) (*runtimev1.AiRealtimeAudioFormat, error) {
	return realtimeInputAudioAtRate(proposed, 24000)
}
func (dashScopeRealtimeDriver) NegotiateInputAudio(proposed *runtimev1.AiRealtimeAudioFormat) (*runtimev1.AiRealtimeAudioFormat, error) {
	return realtimeInputAudioAtRate(proposed, 16000)
}
func (geminiRealtimeDriver) NegotiateInputAudio(proposed *runtimev1.AiRealtimeAudioFormat) (*runtimev1.AiRealtimeAudioFormat, error) {
	return realtimeInputAudioAtRate(proposed, 16000)
}
