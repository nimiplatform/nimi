package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"testing"
)

func TestProductionRealtimeNegotiatesNativePCMBeforeOpen(t *testing.T) {
	for _, tc := range []struct {
		name, model string
		driver      CloudRealtimeDriver
		rate        uint32
	}{
		{"openai", "gpt-realtime-2.1", openAIRealtimeDriver{}, 24000},
		{"dashscope", "qwen3.5-omni-flash-realtime", dashScopeRealtimeDriver{}, 16000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, proposedRate := range []uint32{16000, 24000} {
				proposed := &runtimev1.AiRealtimeAudioFormat{Codec: runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE, SampleRateHz: proposedRate, ChannelCount: 1, FrameDurationMs: 20, MaximumFrameBytes: proposedRate * 2 / 50}
				negotiated, err := tc.driver.NegotiateInputAudio(proposed)
				if err != nil || negotiated.GetSampleRateHz() != tc.rate || negotiated.GetMaximumFrameBytes() != tc.rate*2/50 || proposed.SampleRateHz != proposedRate {
					t.Fatalf("invalid negotiation: %+v %v", negotiated, err)
				}
				protocol, err := tc.driver.NewSession(CloudRealtimeTarget{provider: tc.name, providerModelID: tc.model}, CloudRealtimeOpen{InputAudio: negotiated, AudioOutput: true, TurnDetection: runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD, SelfIntention: true})
				if err != nil {
					t.Fatal(err)
				}
				if _, err := protocol.OpenWire("open"); err != nil {
					t.Fatal("negotiated tuple rejected by actual driver", err)
				}
				proposed.MaximumFrameBytes++
				if _, err := tc.driver.NegotiateInputAudio(proposed); err == nil {
					t.Fatal("malformed proposed tuple was repaired")
				}
			}
		})
	}
}
