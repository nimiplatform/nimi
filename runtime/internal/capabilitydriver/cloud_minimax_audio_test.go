package capabilitydriver

import (
	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/protobuf/proto"
	"strings"
	"testing"
)

func TestMiniMaxFiniteSpeechExactModelsVoicesAndGenerationControls(t *testing.T) {
	for _, model := range MiniMaxSpeechModels() {
		for _, voice := range MiniMaxSpeechVoices() {
			t.Run(model+"/"+voice, func(t *testing.T) {
				req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_SpeechSynthesize{SpeechSynthesize: &runtimev1.SpeechSynthesizeScenarioSpec{Text: "Hello.", VoiceRef: &runtimev1.VoiceReference{Kind: runtimev1.VoiceReferenceKind_VOICE_REFERENCE_KIND_PRESET, Reference: &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: voice}}}}}}
				if err := validateMiniMaxSpeechRequest(req, model, CloudMediaStreamNone); err != nil {
					t.Fatal(err)
				}
				s := req.Spec.GetSpeechSynthesize()
				if s.GetAudioFormat() != "mp3" || s.GetSampleRateHz() != 32000 {
					t.Fatal("default not captured")
				}
				if voice == "Cantonese_GentleLady" && s.Language != "yue" {
					t.Fatal("required Cantonese boost missing")
				}
				for name, change := range map[string]func(*runtimev1.SpeechSynthesizeScenarioSpec){"empty volume": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Volume = proto.Float32(0) }, "fractional pitch": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = proto.Float32(.5) }, "unsupported pitch": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Pitch = proto.Float32(13) }, "text limit": func(s *runtimev1.SpeechSynthesizeScenarioSpec) { s.Text = strings.Repeat("中", 10000) }, "unknown voice": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.VoiceRef.Reference = &runtimev1.VoiceReference_PresetVoiceId{PresetVoiceId: "unknown"}
				}, "render hint": func(s *runtimev1.SpeechSynthesizeScenarioSpec) {
					s.VoiceRenderHints = &runtimev1.VoiceRenderHints{Speed: 1.2}
				}} {
					t.Run(name, func(t *testing.T) {
						copy := proto.Clone(req).(*runtimev1.SubmitScenarioJobRequest)
						change(copy.Spec.GetSpeechSynthesize())
						if err := validateMiniMaxSpeechRequest(copy, model, CloudMediaStreamNone); err == nil {
							t.Fatal("unsupported input discarded")
						}
					})
				}
				s.Emotion = "whisper"
				err := validateMiniMaxSpeechRequest(req, model, CloudMediaStreamNone)
				if strings.HasPrefix(model, "speech-2.8-") && err == nil || strings.HasPrefix(model, "speech-2.6-") && err != nil {
					t.Fatal("generation-specific emotion lost", err)
				}
			})
		}
	}
}
func TestMiniMaxMusicRequiresNativeLyricsOrInstrumentalAndCapturedCeiling(t *testing.T) {
	for _, model := range []string{"music-3.0", "music-2.6"} {
		s := &runtimev1.MusicGenerateScenarioSpec{Prompt: "A short song.", Lyrics: "[Verse]\nOwn words."}
		req := &runtimev1.SubmitScenarioJobRequest{Spec: &runtimev1.ScenarioSpec{Spec: &runtimev1.ScenarioSpec_MusicGenerate{MusicGenerate: s}}}
		if err := validateMiniMaxMusicRequest(req, model); err != nil || s.DurationSeconds != 600 {
			t.Fatal(err)
		}
		s.Lyrics = ""
		if validateMiniMaxMusicRequest(req, model) == nil {
			t.Fatal("implicit lyric generation admitted")
		}
		s.Instrumental = true
		if err := validateMiniMaxMusicRequest(req, model); err != nil {
			t.Fatal(err)
		}
		s.DurationSeconds = 10
		if validateMiniMaxMusicRequest(req, model) == nil {
			t.Fatal("native exact duration fabricated")
		}
		s.DurationSeconds = 600
		if validateMiniMaxMusicRequest(req, "music-3.0-free") == nil {
			t.Fatal("discontinued free model admitted")
		}
	}
}
