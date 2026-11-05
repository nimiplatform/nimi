package capabilitydriver

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode"

	"github.com/nimiplatform/nimi/runtime/internal/ggufmeta"
)

const audioCppEmbeddedSpecKey = "audiocpp.model_spec.json"

// @nimi-authority: rule.nimi.runtime.local-compute.audio-cpp-current-tts
// Read the selected package's voice enum, not the newer engine's built-in
// model spec. Older and substituted packages may contain different presets.
func audioCppPresetSpec(reader io.ReadSeeker, family string) ([]SpeechPresetVoice, string, error) {
	summary, err := ggufmeta.InspectMetadataUntilString(reader, audioCppEmbeddedSpecKey)
	if err != nil {
		return nil, "", fmt.Errorf("read embedded audio.cpp voice spec: %w", err)
	}
	raw, ok := summary.StringValue(audioCppEmbeddedSpecKey)
	version, versionOK := summary.Uint64Value("audiocpp.model_spec.version")
	if !ok || !versionOK || version != 1 {
		return nil, "", fmt.Errorf("embedded audio.cpp voice spec is missing")
	}
	var spec struct {
		Version int    `json:"schema_version"`
		Family  string `json:"family"`
		Options struct {
			Request []struct {
				Name    string          `json:"name"`
				Type    string          `json:"type"`
				Values  []string        `json:"values"`
				Default json.RawMessage `json:"default"`
			} `json:"request"`
		} `json:"options"`
	}
	if err = json.Unmarshal([]byte(raw), &spec); err != nil || spec.Version != 1 || spec.Family != family {
		return nil, "", fmt.Errorf("embedded audio.cpp voice spec identity is invalid")
	}
	var voices []SpeechPresetVoice
	defaultID := ""
	for _, option := range spec.Options.Request {
		if option.Name != "voice_id" {
			continue
		}
		if voices != nil || option.Type != "enum" || len(option.Values) == 0 || len(option.Values) > 512 || json.Unmarshal(option.Default, &defaultID) != nil {
			return nil, "", fmt.Errorf("embedded audio.cpp voice enum is invalid")
		}
		seen := map[string]bool{}
		for _, id := range option.Values {
			if id == "" || len(id) > 128 || id != strings.TrimSpace(id) || strings.IndexFunc(id, unicode.IsControl) >= 0 || seen[id] {
				return nil, "", fmt.Errorf("embedded audio.cpp voice id is invalid")
			}
			seen[id] = true
			voices = append(voices, SpeechPresetVoice{VoiceID: id, Name: id})
		}
		if !seen[defaultID] {
			return nil, "", fmt.Errorf("embedded audio.cpp default voice is not declared")
		}
	}
	if len(voices) == 0 {
		return nil, "", fmt.Errorf("embedded audio.cpp package has no preset voices")
	}
	return voices, defaultID, nil
}

func audioCppPresetProbeValid(probe []byte, family string) bool {
	_, _, err := audioCppPresetSpec(bytes.NewReader(probe), family)
	return err == nil
}

func (d AudioCppTTSDriver) withEmbeddedPresetVoices(binding InvocationExactBinding) (AudioCppTTSDriver, error) {
	if !d.spec.embeddedPresetVoices {
		return d, nil
	}
	file, err := os.Open(binding.AbsolutePath)
	if err != nil {
		return d, invocationError(InvocationFailureInvalidBinding, fmt.Errorf("read selected audio.cpp preset catalog: %w", err))
	}
	defer file.Close()
	voices, defaultID, err := audioCppPresetSpec(io.NewSectionReader(file, 0, MaxAssetFormatProbeBytes), d.spec.family)
	if err != nil {
		return d, invocationError(InvocationFailureInvalidBinding, err)
	}
	for i := range voices {
		voices[i].SupportedLangs = append([]string(nil), d.spec.languages...)
	}
	d.spec.presetVoices = voices
	d.spec.defaultPreset = defaultID
	return d, nil
}

func audioCppReferenceWAVSupported(value []byte, spec audioCppTTSSpec) bool {
	seconds, ok := audioCppWAVDuration(value)
	return ok && (spec.referenceMinSeconds == 0 || seconds >= spec.referenceMinSeconds) && (spec.referenceMaxSeconds == 0 || seconds <= spec.referenceMaxSeconds)
}
