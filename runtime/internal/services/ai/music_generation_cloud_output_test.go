package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/grpcerr"
)

func TestElevenLabsChecksMeasuredOutputAgainstCapturedBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterElevenLabsMusic
	if err := validateCloudMusicMeasuredDuration(adapter, 600, 9930); err != nil {
		t.Fatal(err)
	}
	for _, duration := range []int64{0, 600001} {
		if err := validateCloudMusicMeasuredDuration(adapter, 600, duration); err == nil {
			t.Fatal("invalid measured output accepted")
		}
	}
}

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

func TestLyria35ChecksMeasuredSongAgainstCapturedUpperBudget(t *testing.T) {
	adapter := capabilitydriver.CloudMediaAdapterGeminiLyria35GenerateContent
	if err := validateCloudMusicMeasuredDuration(adapter, 300, 125000); err != nil {
		t.Fatalf("two-minute song inside five-minute captured budget: %v", err)
	}
	if err := validateCloudMusicMeasuredDuration(adapter, 300, 300000); err != nil {
		t.Fatalf("song exactly at captured 300-second ceiling: %v", err)
	}
	for _, sample := range []struct {
		budget   int32
		duration int64
	}{{120, 120000}, {300, 300001}, {0, 1000}} {
		err := validateCloudMusicMeasuredDuration(adapter, sample.budget, sample.duration)
		if reason, ok := grpcerr.ExtractReasonCode(err); !ok || reason != runtimev1.ReasonCode_AI_OUTPUT_INVALID {
			t.Fatalf("song budget=%d measured=%d reason=%v present=%v err=%v", sample.budget, sample.duration, reason, ok, err)
		}
	}
}
