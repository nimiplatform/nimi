package localexecution

import (
	"math"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestSpeechTranscriptRequiresActualOrderedTiming(t *testing.T) {
	result := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED, Text: "Hello, world.", Language: "en"}
	if ValidateSpeechTranscript(result, true) == nil {
		t.Fatal("text alone cannot satisfy requested alignment")
	}
	result.Words = []*runtimev1.SpeechTranscriptWord{{Text: "Hello,", StartSeconds: 0.2, EndSeconds: 0.7}, {Text: "world.", StartSeconds: 1.1, EndSeconds: 1.6}}
	if err := ValidateSpeechTranscript(result, true); err != nil {
		t.Fatal(err)
	}
	result.Language = ""
	if err := ValidateSpeechTranscript(result, true); err != nil {
		t.Fatalf("actual timing does not require an invented language label: %v", err)
	}
	result.Words[1].StartSeconds = 0.1
	if ValidateSpeechTranscript(result, true) == nil {
		t.Fatal("reordered timing must fail")
	}
	result.Words[1].StartSeconds = math.NaN()
	if ValidateSpeechTranscript(result, true) == nil {
		t.Fatal("nonfinite timing must fail")
	}
}

func TestSpeechDiarizationPreservesRealOverlapAndRejectsContradictorySourceData(t *testing.T) {
	result := &runtimev1.SpeechDiarization{Status: runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_DIARIZED, DurationSeconds: 8, Intervals: []*runtimev1.SpeechSpeakerInterval{{SpeakerId: "speaker_1", StartSeconds: 0.6, EndSeconds: 6.8}, {SpeakerId: "speaker_2", StartSeconds: 6.5, EndSeconds: 8}}}
	if err := ValidateSpeechDiarization(result); err != nil {
		t.Fatal(err)
	}
	result.Intervals[1].EndSeconds = 8.0297
	if ValidateSpeechDiarization(result) == nil {
		t.Fatal("public source interval leaked model padding")
	}
	result.Intervals[1].EndSeconds = 8
	result.Intervals[1].StartSeconds = 0.1
	if ValidateSpeechDiarization(result) == nil {
		t.Fatal("unordered speaker intervals accepted")
	}
	result.Intervals = nil
	if ValidateSpeechDiarization(result) == nil {
		t.Fatal("empty diarized success accepted")
	}
	result.Status = runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS
	if err := ValidateSpeechDiarization(result); err != nil {
		t.Fatal(err)
	}
	result.DurationSeconds = math.NaN()
	if ValidateSpeechDiarization(result) == nil {
		t.Fatal("nonfinite actual duration accepted")
	}
}

func TestSpeechTranscriptDistinguishesNoSpeechFromEmptySuccess(t *testing.T) {
	result := &runtimev1.SpeechTranscript{Status: runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED}
	if ValidateSpeechTranscript(result, false) == nil {
		t.Fatal("empty transcribed success must fail")
	}
	result.Status = runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH
	if err := ValidateSpeechTranscript(result, true); err != nil {
		t.Fatal(err)
	}
	result.Text = "contradictory text"
	if ValidateSpeechTranscript(result, false) == nil {
		t.Fatal("no-speech result cannot carry text")
	}
}
