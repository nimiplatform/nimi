package capabilitydriver

import (
	"fmt"
	"math"
	"sort"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
)

// @nimi-authority: rule.nimi.runtime.ai-provider.music-note-events-output
func normalizeBasicPitchNotes(request *runtimev1.MusicTranscribeScenarioSpec, info *runtimev1.LocalAppAudioInfo, data []byte) (*MusicTranscriptionOutput, error) {
	if len(data) == 0 || len(data) > musicscore.MaxTimelineBytes || request == nil || request.GetSourceAudio().GetRange() == nil || info == nil {
		return nil, fmt.Errorf("Basic Pitch source or native output is missing")
	}
	var native struct {
		Version int `json:"version"`
		Notes   []struct {
			Start *float64 `json:"start"`
			End   *float64 `json:"end"`
			Pitch *int     `json:"pitch"`
		} `json:"notes"`
	}
	if err := decodeSheetJSON(data, &native); err != nil {
		return nil, fmt.Errorf("decode Basic Pitch notes: %w", err)
	}
	if native.Version != 1 || native.Notes == nil || len(native.Notes) > 100000 {
		return nil, fmt.Errorf("Basic Pitch native version or note count is invalid")
	}
	r := request.SourceAudio.Range
	rate := uint64(info.SampleRateHz)
	span := r.EndFrame - r.StartFrame
	if rate < 8000 || rate > 96000 || r.EndFrame <= r.StartFrame || r.EndFrame > info.FrameCount {
		return nil, fmt.Errorf("Basic Pitch captured source range is invalid")
	}
	timeline := musicscore.Timeline{Version: 1, SourceArtifactID: request.SourceAudio.ArtifactId, AudioInfo: musicscore.TimelineAudioInfo{SampleRateHz: info.SampleRateHz, Channels: info.Channels, FrameCount: info.FrameCount, DurationMS: info.FrameCount * 1000 / rate}, InputRange: musicscore.TimelineRange{StartFrame: r.StartFrame, EndFrame: r.EndFrame}, Events: []musicscore.TimelineEvent{}}
	notes := make([]musicscore.MIDINote, 0, len(native.Notes))
	for _, raw := range native.Notes {
		if raw.Start == nil || raw.End == nil || raw.Pitch == nil {
			return nil, fmt.Errorf("Basic Pitch native note facts are missing")
		}
		note := struct {
			Start, End float64
			Pitch      int
		}{*raw.Start, *raw.End, *raw.Pitch}
		if math.IsNaN(note.Start) || math.IsInf(note.Start, 0) || math.IsNaN(note.End) || math.IsInf(note.End, 0) || note.Start < 0 || note.End <= note.Start || note.Pitch < 21 || note.Pitch > 108 || note.End*float64(rate) > float64(span)+1 {
			return nil, fmt.Errorf("Basic Pitch native note pitch or timing is invalid")
		}
		start, end := uint64(math.Round(note.Start*float64(rate))), uint64(math.Round(note.End*float64(rate)))
		if end > span {
			end = span
		}
		if start >= span || end <= start {
			return nil, fmt.Errorf("Basic Pitch projected note span is invalid")
		}
		startTick, endTick := uint32(math.Round(note.Start*musicscore.MIDIResolution)), uint32(math.Round(float64(end)/float64(rate)*musicscore.MIDIResolution))
		if endTick <= startTick {
			return nil, fmt.Errorf("Basic Pitch note cannot be encoded at the admitted MIDI resolution")
		}
		notes = append(notes, musicscore.MIDINote{StartTick: startTick, EndTick: endTick, Pitch: note.Pitch})
		absoluteEnd, pitch, track := r.StartFrame+end, note.Pitch, 0
		timeline.Events = append(timeline.Events, musicscore.TimelineEvent{Kind: "note", StartFrame: r.StartFrame + start, EndFrame: &absoluteEnd, MIDIPitch: &pitch, TrackIndex: &track})
	}
	sort.SliceStable(timeline.Events, func(i, j int) bool { return timeline.Events[i].StartFrame < timeline.Events[j].StartFrame })
	output := &MusicTranscriptionOutput{Completeness: runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN}
	for _, format := range request.RequestedFormats {
		switch format {
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_MIDI:
			midi, err := musicscore.MarshalNoteMIDI(notes)
			if err != nil {
				return nil, err
			}
			output.Scores = append(output.Scores, MusicTranscriptionScoreOutput{Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_MIDI, Part: runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_NOTE_EVENTS, Bytes: midi})
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE:
			encoded, err := musicscore.MarshalTimeline(timeline)
			if err != nil {
				return nil, err
			}
			output.TimelineJSON = encoded
		default:
			return nil, fmt.Errorf("Basic Pitch requested an unsupported output")
		}
	}
	return output, nil
}
