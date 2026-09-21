package musicscore

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"unicode/utf8"
)

const TimelineMIME = "application/vnd.nimi.music-timeline+json"
const MaxTimelineBytes = 16 << 20

type TimelineAudioInfo struct {
	SampleRateHz uint32 `json:"sampleRateHz"`
	Channels     uint32 `json:"channels"`
	FrameCount   uint64 `json:"frameCount"`
	DurationMS   uint64 `json:"durationMs"`
}
type TimelineRange struct {
	StartFrame uint64 `json:"startFrame"`
	EndFrame   uint64 `json:"endFrame"`
}
type TimelineEvent struct {
	Kind                string  `json:"kind"`
	StartFrame          uint64  `json:"startFrame"`
	EndFrame            *uint64 `json:"endFrame,omitempty"`
	MIDIPitch           *int    `json:"midiPitch,omitempty"`
	TrackIndex          *int    `json:"trackIndex,omitempty"`
	EighthsFromDownbeat *int    `json:"eighthsFromDownbeat,omitempty"`
	MeterNumerator      *int    `json:"meterNumerator,omitempty"`
	MeterDenominator    *int    `json:"meterDenominator,omitempty"`
	Label               string  `json:"label,omitempty"`
}
type Timeline struct {
	Version          int               `json:"version"`
	SourceArtifactID string            `json:"sourceArtifactId"`
	AudioInfo        TimelineAudioInfo `json:"audioInfo"`
	InputRange       TimelineRange     `json:"inputRange"`
	Events           []TimelineEvent   `json:"events"`
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription-timeline
func ValidateTimeline(t Timeline) error {
	i := t.AudioInfo
	if t.Version != 1 || strings.TrimSpace(t.SourceArtifactID) == "" || len(t.SourceArtifactID) > 512 || strings.ContainsRune(t.SourceArtifactID, 0) || !utf8.ValidString(t.SourceArtifactID) || i.SampleRateHz < 8000 || i.SampleRateHz > 96000 || i.Channels < 1 || i.Channels > 2 || i.FrameCount < 1 || i.FrameCount > uint64(i.SampleRateHz)*600 || i.DurationMS != i.FrameCount*1000/uint64(i.SampleRateHz) || t.InputRange.EndFrame <= t.InputRange.StartFrame || t.InputRange.EndFrame > i.FrameCount || len(t.Events) > 100000 {
		return fmt.Errorf("music timeline source, range or bound is invalid")
	}
	for index, e := range t.Events {
		if e.StartFrame < t.InputRange.StartFrame || e.StartFrame >= t.InputRange.EndFrame || (index > 0 && e.StartFrame < t.Events[index-1].StartFrame) {
			return fmt.Errorf("music timeline event ordering or frame is invalid")
		}
		switch e.Kind {
		case "note":
			if e.EndFrame == nil || *e.EndFrame <= e.StartFrame || *e.EndFrame > t.InputRange.EndFrame || e.MIDIPitch == nil || *e.MIDIPitch < 0 || *e.MIDIPitch > 127 || e.TrackIndex == nil || *e.TrackIndex < 0 || *e.TrackIndex > 255 || e.EighthsFromDownbeat != nil || e.MeterNumerator != nil || e.MeterDenominator != nil || e.Label != "" {
				return fmt.Errorf("music timeline note is invalid")
			}
		case "beat":
			if e.EndFrame != nil || e.MIDIPitch != nil || e.TrackIndex != nil || e.EighthsFromDownbeat == nil || *e.EighthsFromDownbeat < 0 || *e.EighthsFromDownbeat > 255 || e.Label != "" || (e.MeterNumerator == nil) != (e.MeterDenominator == nil) {
				return fmt.Errorf("music timeline beat is invalid")
			}
			if e.MeterNumerator != nil && (*e.MeterNumerator < 1 || *e.MeterNumerator > 32 || *e.MeterDenominator < 1 || *e.MeterDenominator > 32 || (*e.MeterDenominator&(*e.MeterDenominator-1)) != 0) {
				return fmt.Errorf("music timeline meter is invalid")
			}
		case "chord", "key", "section":
			if e.EndFrame != nil || e.MIDIPitch != nil || e.TrackIndex != nil || e.EighthsFromDownbeat != nil || e.MeterNumerator != nil || e.MeterDenominator != nil || strings.TrimSpace(e.Label) == "" || len(e.Label) > 128 || !utf8.ValidString(e.Label) || strings.ContainsAny(e.Label, "\x00\r\n") {
				return fmt.Errorf("music timeline label event is invalid")
			}
		default:
			return fmt.Errorf("music timeline kind is unsupported")
		}
	}
	return nil
}

func MarshalTimeline(t Timeline) ([]byte, error) {
	if err := ValidateTimeline(t); err != nil {
		return nil, err
	}
	data, err := json.Marshal(t)
	if err != nil || len(data) > MaxTimelineBytes {
		return nil, fmt.Errorf("music timeline encoding exceeds its bound")
	}
	return data, nil
}

func ParseTimeline(data []byte) (Timeline, error) {
	var t Timeline
	if len(data) == 0 || len(data) > MaxTimelineBytes {
		return t, fmt.Errorf("music timeline size is invalid")
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&t); err != nil {
		return t, fmt.Errorf("decode music timeline: %w", err)
	}
	if err := decoder.Decode(new(any)); err != io.EOF {
		return t, fmt.Errorf("music timeline has trailing content")
	}
	return t, ValidateTimeline(t)
}
