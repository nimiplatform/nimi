package ai

import (
	"testing"
	"time"
)

// TestAITimeoutDefaultsMatchSpec verifies that compile-time timeout constants
// match the values declared in ai-timeout-defaults.yaml.  Each spec value is
// expressed in milliseconds; the test converts to time.Duration for comparison.
func TestAITimeoutDefaultsMatchSpec(t *testing.T) {
	tests := []struct {
		name   string
		got    time.Duration
		wantMS int
	}{
		// ExecuteScenario_text_generate → 30 000 ms
		{name: "defaultGenerateTimeout", got: defaultGenerateTimeout, wantMS: 30_000},
		// StreamScenario_first_packet → 10 000 ms
		{name: "defaultStreamFirstTimeout", got: defaultStreamFirstTimeout, wantMS: 10_000},
		// StreamScenario_total → 120 000 ms
		{name: "defaultStreamTotalTimeout", got: defaultStreamTotalTimeout, wantMS: 120_000},
		// ExecuteScenario_text_embed → 20 000 ms
		{name: "defaultEmbedTimeout", got: defaultEmbedTimeout, wantMS: 20_000},
		// SubmitScenarioJob_image → 120 000 ms
		{name: "defaultGenerateImageTimeout", got: defaultGenerateImageTimeout, wantMS: 120_000},
		// SubmitScenarioJob_video → 300 000 ms
		{name: "defaultGenerateVideoTimeout", got: defaultGenerateVideoTimeout, wantMS: 300_000},
		// StreamScenario_speech_synthesize → 45 000 ms
		{name: "defaultSynthesizeTimeout", got: defaultSynthesizeTimeout, wantMS: 45_000},
		// SubmitScenarioJob_stt → 90 000 ms
		{name: "defaultTranscribeTimeout", got: defaultTranscribeTimeout, wantMS: 90_000},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			want := time.Duration(tt.wantMS) * time.Millisecond
			if tt.got != want {
				t.Fatalf("%s = %s, want %s (spec %d ms)", tt.name, tt.got, want, tt.wantMS)
			}
		})
	}
}

// TestMinStreamChunkBytesMatchesSpec ensures minStreamChunkBytes satisfies
// K-STREAM-006 (32 bytes minimum flush threshold).
func TestMinStreamChunkBytesMatchesSpec(t *testing.T) {
	const specMinBytes = 32
	if minStreamChunkBytes != specMinBytes {
		t.Fatalf("minStreamChunkBytes = %d, want %d (K-STREAM-006)", minStreamChunkBytes, specMinBytes)
	}
}
