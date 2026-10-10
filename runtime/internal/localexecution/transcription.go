package localexecution

import (
	"fmt"
	"math"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/encoding/protojson"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
const SpeechTranscriptMIME = "application/vnd.nimi.speech-transcript+json"
const MaxSpeechTranscriptBytes = 1 << 20
const MaxSpeechTranscriptWords = 16384

func ValidateSpeechTranscript(result *runtimev1.SpeechTranscript, requireTiming bool) error {
	if result == nil || !utf8.ValidString(result.GetText()) || strings.TrimSpace(result.GetText()) != result.GetText() {
		return fmt.Errorf("speech transcription result is missing or invalid")
	}
	if err := ValidateSpeechDiarization(result.GetDiarization()); err != nil {
		return err
	}
	encoded, err := protojson.Marshal(result)
	if err != nil || len(encoded) > MaxSpeechTranscriptBytes {
		return fmt.Errorf("speech transcription result exceeds its limit")
	}
	if result.GetStatus() == runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH {
		if result.GetText() != "" || result.GetLanguage() != "" || len(result.GetWords()) != 0 || (result.GetDiarization() != nil && result.GetDiarization().GetStatus() != runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS) {
			return fmt.Errorf("no-speech result contains transcription data")
		}
		return nil
	}
	if result.GetStatus() != runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_TRANSCRIBED || result.GetText() == "" {
		return fmt.Errorf("transcribed result requires text")
	}
	if len(result.GetLanguage()) > 64 || !utf8.ValidString(result.GetLanguage()) || strings.TrimSpace(result.GetLanguage()) != result.GetLanguage() {
		return fmt.Errorf("speech transcription language is invalid")
	}
	if len(result.GetWords()) > MaxSpeechTranscriptWords || (requireTiming && len(result.GetWords()) == 0) {
		return fmt.Errorf("speech transcription lacks requested alignment or exceeds its limit")
	}
	previousStart := float64(0)
	for _, word := range result.GetWords() {
		if word == nil || strings.TrimSpace(word.GetText()) == "" || !utf8.ValidString(word.GetText()) ||
			math.IsNaN(word.GetStartSeconds()) || math.IsNaN(word.GetEndSeconds()) || math.IsInf(word.GetStartSeconds(), 0) || math.IsInf(word.GetEndSeconds(), 0) ||
			word.GetStartSeconds() < previousStart || word.GetEndSeconds() < word.GetStartSeconds() {
			return fmt.Errorf("speech transcription alignment is invalid")
		}
		previousStart = word.GetStartSeconds()
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
func ValidateSpeechDiarization(result *runtimev1.SpeechDiarization) error {
	if result == nil {
		return nil
	}
	duration := result.GetDurationSeconds()
	if math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || len(result.GetIntervals()) > 16384 {
		return fmt.Errorf("diarization source duration or interval bound is invalid")
	}
	if result.GetStatus() == runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_NO_SPEAKERS {
		if len(result.GetIntervals()) != 0 {
			return fmt.Errorf("no-speakers result contains intervals")
		}
		return nil
	}
	if result.GetStatus() != runtimev1.SpeechDiarizationStatus_SPEECH_DIARIZATION_STATUS_DIARIZED || len(result.GetIntervals()) == 0 {
		return fmt.Errorf("diarized result requires actual intervals")
	}
	previous := float64(0)
	for _, interval := range result.GetIntervals() {
		label := interval.GetSpeakerId()
		start, end := interval.GetStartSeconds(), interval.GetEndSeconds()
		if interval == nil || label == "" || len(label) > 128 || !utf8.ValidString(label) || strings.TrimSpace(label) != label || math.IsNaN(start) || math.IsNaN(end) || math.IsInf(start, 0) || math.IsInf(end, 0) || start < previous || end <= start || end > duration {
			return fmt.Errorf("diarization interval is invalid or outside its source")
		}
		previous = start
	}
	return nil
}
