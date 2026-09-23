package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestVoiceConversionLengthUsesPublishedMillisecondFacts(t *testing.T) {
	cases := []struct {
		name         string
		sourceRate   uint32
		sourceFrames uint64
		outFrames    uint64
		wantRelation runtimev1.VoiceConversionLengthRelation
		wantDelta    int64
	}{
		// Full 191.635 s song at 44.1 kHz against a 191.670 s 24 kHz vocal:
		// 191670 - 191635 ms, not the truncated microsecond difference (34).
		{"full song with fractional source milliseconds", 44100, 8_451_125, 4_600_080, runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, 35},
		{"whole-millisecond range", 44100, 1_102_500, 600_720, runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, 30},
		{"shorter output", 44100, 441_000, 239_000, runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, -42},
		{"sub-millisecond difference", 44100, 44_101, 24_000, runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING, 0},
		{"exact duration", 44100, 44_100, 24_000, runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_EXACT, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			relation, delta := voiceConversionLength(tc.sourceRate, tc.sourceFrames, 24000, tc.outFrames)
			if relation != tc.wantRelation || delta != tc.wantDelta {
				t.Fatalf("got %v/%d, want %v/%d", relation, delta, tc.wantRelation, tc.wantDelta)
			}
			if err := validateVoiceConvertResult(voiceConvertResultForTest(tc.sourceRate, tc.sourceFrames, tc.outFrames, relation, delta)); err != nil {
				t.Fatalf("Runtime rejected its own length facts: %v", err)
			}
		})
	}
}

func TestVoiceConvertResultRejectsInconsistentLengthFacts(t *testing.T) {
	rounding := runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_MODEL_FRAME_ROUNDING
	exact := runtimev1.VoiceConversionLengthRelation_VOICE_CONVERSION_LENGTH_RELATION_EXACT
	for name, job := range map[string]*runtimev1.ScenarioJob{
		"truncated microsecond delta": voiceConvertResultForTest(44100, 8_451_125, 4_600_080, rounding, 34),
		"exact with a delta":          voiceConvertResultForTest(44100, 44_100, 24_024, exact, 1),
		"delta beyond rounding":       voiceConvertResultForTest(44100, 441_000, 264_000, rounding, 1000),
	} {
		if err := validateVoiceConvertResult(job); err == nil {
			t.Fatalf("%s: inconsistent length facts were accepted", name)
		}
	}
}

func voiceConvertResultForTest(sourceRate uint32, sourceFrames, outFrames uint64, relation runtimev1.VoiceConversionLengthRelation, delta int64) *runtimev1.ScenarioJob {
	return &runtimev1.ScenarioJob{
		ScenarioType: runtimev1.ScenarioType_SCENARIO_TYPE_AUDIO_VOICE_CONVERT,
		Status:       runtimev1.ScenarioJobStatus_SCENARIO_JOB_STATUS_COMPLETED,
		Artifacts:    []*runtimev1.ScenarioArtifact{{ArtifactId: "artifact-vocal", MimeType: "audio/wav", SizeBytes: int64(outFrames*4 + 56)}},
		VoiceConversion: &runtimev1.VoiceConversion{
			VocalArtifactId:  "artifact-vocal",
			SourceArtifactId: "artifact-source",
			SourceInfo:       &runtimev1.LocalAppAudioInfo{SampleRateHz: sourceRate, Channels: 2, FrameCount: sourceFrames, DurationMs: int64(sourceFrames * 1000 / uint64(sourceRate))},
			InputRange:       &runtimev1.AudioFrameRange{StartFrame: 0, EndFrame: sourceFrames},
			VocalInfo:        &runtimev1.LocalAppAudioInfo{SampleRateHz: 24000, Channels: 1, FrameCount: outFrames, DurationMs: int64(outFrames * 1000 / 24000)},
			LengthRelation:   relation,
			DurationDeltaMs:  delta,
		},
	}
}
