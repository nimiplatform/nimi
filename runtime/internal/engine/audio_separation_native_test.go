package engine

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/audiomedia"
)

func TestNativeStemsMustPreserveSubmittedSourceTimeline(t *testing.T) {
	source := &runtimev1.LocalAppAudioInfo{SampleRateHz: 44100, Channels: 2, FrameCount: 1102511}
	if err := nativeStemsPreserveSource(audiomedia.Facts{SampleRateHz: 44100, Channels: 2, FrameCount: 1102511}, source); err != nil {
		t.Fatalf("complete stems rejected: %v", err)
	}
	for _, stems := range []audiomedia.Facts{
		{SampleRateHz: 44100, Channels: 2, FrameCount: 1102500},
		{SampleRateHz: 44100, Channels: 2, FrameCount: 1102512},
		{SampleRateHz: 48000, Channels: 2, FrameCount: 1102511},
		{SampleRateHz: 44100, Channels: 1, FrameCount: 1102511},
	} {
		if err := nativeStemsPreserveSource(stems, source); err == nil {
			t.Fatalf("stems that trim, pad or change the domain were admitted: %+v", stems)
		}
	}
	if err := nativeStemsPreserveSource(audiomedia.Facts{SampleRateHz: 44100, Channels: 2, FrameCount: 1}, nil); err == nil {
		t.Fatal("stems without captured source facts were admitted")
	}
}
