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
	if result.GetStatus() == runtimev1.SpeechTranscriptStatus_SPEECH_TRANSCRIPT_STATUS_NO_SPEECH {
		if result.GetText() != "" || result.GetLanguage() != "" || len(result.GetWords()) != 0 {
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
	encoded, err := protojson.Marshal(result)
	if err != nil || len(encoded) > MaxSpeechTranscriptBytes {
		return fmt.Errorf("speech transcription result exceeds its limit")
	}
	return nil
}
