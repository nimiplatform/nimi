package ai

import (
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestIsSpeechVoiceSupported(t *testing.T) {
	voices := []*runtimev1.VoicePresetDescriptor{
		{VoiceId: "alloy"},
		{VoiceId: "nova"},
	}
	if !isSpeechVoiceSupported("", voices) {
		t.Fatalf("empty requested voice should be treated as supported")
	}
	if !isSpeechVoiceSupported("nova", voices) {
		t.Fatalf("exact voice id should match")
	}
	if !isSpeechVoiceSupported("NoVa", voices) {
		t.Fatalf("voice match should be case-insensitive")
	}
	if isSpeechVoiceSupported("unknown", voices) {
		t.Fatalf("unknown voice should be unsupported")
	}
}
