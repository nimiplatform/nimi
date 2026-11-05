package capabilitydriver

import (
	"encoding/json"
	"fmt"
	"slices"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/agentintent"
)

const dashScope38RealtimeModel = "qwen3.8-omni-flash-realtime"

// @nimi-authority: rule.nimi.runtime.ai-provider.r115
// Qwen3.8 keeps response turns. Native automatic response and interruption must
// remain disabled even when the caller selects server-side speech detection.
type dashScope38RealtimeMapper struct{ dashScopeRealtimeDriver }

func (d dashScope38RealtimeMapper) MapOpen(id string, target CloudRealtimeTarget, input CloudRealtimeOpen) ([]byte, error) {
	if target.ProviderModelID() != dashScope38RealtimeModel || input.InputAudio == nil ||
		input.InputAudio.GetCodec() != runtimev1.AiRealtimeAudioCodec_AI_REALTIME_AUDIO_CODEC_PCM_S16LE ||
		input.InputAudio.GetSampleRateHz() != 16000 || input.InputAudio.GetChannelCount() != 1 {
		return nil, &RealtimeInputFormatError{ExpectedSampleRateHz: 16000}
	}
	detection, err := dashScope38TurnDetection(input.TurnDetection)
	if err != nil {
		return nil, err
	}
	modalities := []string{"text"}
	if input.AudioOutput {
		modalities = append(modalities, "audio")
	}
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{
		"modalities": modalities, "instructions": input.InitialInstruction,
		"audio": map[string]any{
			"input":  map[string]any{"format": map[string]any{"type": "pcm", "sample_rate": 16000, "sample_format": "s16le", "channels": 1, "packing": "interleaved", "channel_layout": "mono"}},
			"output": map[string]any{"format": map[string]any{"type": "pcm", "sample_rate": 24000}, "voice": "Tina"},
		},
		"input_audio_transcription": map[string]any{"model": "qwen3-asr-flash-realtime"},
		"turn_detection":            detection, "tools": d.SelfIntentionTools(input.SelfIntention), "enable_search": false,
	}})
}

func dashScope38TurnDetection(mode runtimev1.AiRealtimeTurnDetectionMode) (any, error) {
	detection, err := dashScopeRealtimeTurnDetection(mode)
	if config, ok := detection.(map[string]any); ok {
		config["interrupt_response"] = false
	}
	return detection, err
}

func (dashScope38RealtimeMapper) SelfIntentionTools(enabled bool) []any {
	tools := agentintent.NativeTools(enabled)
	for i, raw := range tools {
		tool := raw.(map[string]any)
		tools[i] = map[string]any{"type": "function", "function": map[string]any{"name": tool["name"], "description": tool["description"], "parameters": tool["parameters"]}}
	}
	return tools
}

func (d dashScope38RealtimeMapper) SelfIntentionToolsUpdate(id string, enabled bool, mode runtimev1.AiRealtimeTurnDetectionMode) ([]byte, error) {
	detection, err := dashScope38TurnDetection(mode)
	if err != nil {
		return nil, err
	}
	return json.Marshal(map[string]any{"event_id": id, "type": "session.update", "session": map[string]any{"tools": d.SelfIntentionTools(enabled), "turn_detection": detection, "enable_search": false}})
}

type dashScope38AudioFormat struct {
	Type         string `json:"type"`
	SampleRate   int    `json:"sample_rate"`
	SampleFormat string `json:"sample_format"`
	Channels     int    `json:"channels"`
	Packing      string `json:"packing"`
	Layout       string `json:"channel_layout"`
}

func (d dashScope38RealtimeMapper) NormalizeEvent(raw []byte, expected CloudRealtimeOpen) ([]CloudRealtimeEvent, error) {
	var event struct {
		Type    string `json:"type"`
		Session *struct {
			Model      string   `json:"model"`
			Modalities []string `json:"modalities"`
			Voice      string   `json:"voice"`
			Audio      struct {
				Input struct {
					Format dashScope38AudioFormat `json:"format"`
				} `json:"input"`
				Output struct {
					Format dashScope38AudioFormat `json:"format"`
					Voice  string                 `json:"voice"`
				} `json:"output"`
			} `json:"audio"`
			Transcription struct {
				Model string `json:"model"`
			} `json:"input_audio_transcription"`
			Detection json.RawMessage `json:"turn_detection"`
			Search    bool            `json:"enable_search"`
			Tools     []struct {
				Type string `json:"type"`
			} `json:"tools"`
		} `json:"session"`
	}
	invalid := func() ([]CloudRealtimeEvent, error) {
		return nil, cloudInvocationError(CloudInvocationFailureResponse, fmt.Errorf("Qwen3.8 Realtime session differs from the requested configuration"))
	}
	if json.Unmarshal(raw, &event) != nil {
		return invalid()
	}
	if event.Type != "session.updated" {
		return d.dashScopeRealtimeDriver.NormalizeEvent(raw, expected)
	}
	s := event.Session
	if s == nil || s.Model != dashScope38RealtimeModel || s.Search || s.Transcription.Model != "qwen3-asr-flash-realtime" {
		return invalid()
	}
	if len(s.Modalities) != 1+boolInt(expected.AudioOutput) || !slices.Contains(s.Modalities, "text") || slices.Contains(s.Modalities, "audio") != expected.AudioOutput {
		return invalid()
	}
	in, out := s.Audio.Input.Format, s.Audio.Output.Format
	if in.Type != "pcm" || in.SampleRate != 16000 || in.SampleFormat != "s16le" || in.Channels != 1 || in.Packing != "interleaved" || in.Layout != "mono" || out.Type != "pcm" || out.SampleRate != 24000 {
		return invalid()
	}
	// The native session schema can echo the effective voice at either of its
	// documented locations. If both are returned they must agree.
	if s.Voice != "" && s.Voice != "Tina" || s.Audio.Output.Voice != "" && s.Audio.Output.Voice != "Tina" || s.Voice == "" && s.Audio.Output.Voice == "" {
		return invalid()
	}
	if !expected.SelfIntention && len(s.Tools) != 0 {
		return invalid()
	}
	for _, tool := range s.Tools {
		if tool.Type != "function" {
			return invalid()
		}
	}
	if expected.TurnDetection == runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_MANUAL {
		if string(s.Detection) != "null" {
			return invalid()
		}
	} else {
		var detection struct {
			Type      string `json:"type"`
			Create    *bool  `json:"create_response"`
			Interrupt *bool  `json:"interrupt_response"`
		}
		if expected.TurnDetection != runtimev1.AiRealtimeTurnDetectionMode_AI_REALTIME_TURN_DETECTION_MODE_SERVER_VAD || json.Unmarshal(s.Detection, &detection) != nil || detection.Type != "server_vad" || detection.Create == nil || *detection.Create || detection.Interrupt == nil || *detection.Interrupt {
			return invalid()
		}
	}
	return []CloudRealtimeEvent{{Kind: CloudRealtimeEventReady}}, nil
}

func boolInt(value bool) int {
	if value {
		return 1
	}
	return 0
}
