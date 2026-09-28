package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestLyriaClipChecksMeasuredAudioAgainstCapturedBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterGeminiLyriaClipGenerateContent
	if err := validateCloudMusicMeasuredDuration(adapter, 35, 30772); err != nil {
		t.Fatalf("measured real clip within captured budget: %v", err)
	}
	for _, tc := range []struct {
		budget   int32
		duration int64
	}{{budget: 30, duration: 30772}, {budget: 35, duration: 35001}, {budget: 35, duration: 0}} {
		err := validateCloudMusicMeasuredDuration(adapter, tc.budget, tc.duration)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("budget=%d duration=%d reason=%v present=%v err=%v", tc.budget, tc.duration, reason, ok, err)
		}
	}
	if err := validateCloudMusicMeasuredDuration(capabilitydriver.CloudMediaAdapterStabilityMusic, 30, 35001); err != nil {
		t.Fatalf("unrelated provider inherited Lyria limit: %v", err)
	}
}
