package capabilitydriver

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"math"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/musicscore"
)

type sheetSageEvent struct {
	Subbeat       int64            `json:"subbeat"`
	Time          float64          `json:"time"`
	WindowIndex   int              `json:"window_index"`
	SourceSubbeat int64            `json:"source_subbeat"`
	GlobalSubbeat int64            `json:"global_subbeat"`
	Tokens        map[string][]int `json:"tokens_by_field"`
	Notes         []struct {
		Pitch         int     `json:"pitch"`
		Track         int     `json:"track"`
		DurationBin   int     `json:"duration_bin"`
		DurationSteps int     `json:"duration_steps"`
		EndTime       float64 `json:"end_time"`
	} `json:"notes"`
}

var sheetStructureLabels = []string{"silence", "intro", "outro", "verse", "chorus", "bridge", "pre-chorus", "post-chorus", "interlude", "fade-out", "loop", "rap", "preshot", "irregular", "instrumental", "intro and verse", "pre-chorus and chorus", "verse and pre-chorus", "solo", "theme", "development", "variation", "pre-outro"}
var sheetPitchClasses = []string{"C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"}

func decodeSheetJSON(data []byte, target any) error {
	d := json.NewDecoder(bytes.NewReader(data))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		return err
	}
	if err := d.Decode(new(any)); err != io.EOF {
		return fmt.Errorf("SheetSage2 JSON has trailing content")
	}
	return nil
}

// @nimi-authority: rule.nimi.runtime.ai-provider.music-transcription-timeline
// Fixed audio.cpp f2b4937 SheetSage2 300-second vocabulary. Native token ids
// become musical labels and source frames; none enter the public artifact.
func normalizeSheetSage2Output(request *runtimev1.MusicTranscribeScenarioSpec, info *runtimev1.LocalAppAudioInfo, score, nativeEvents []byte) (*MusicTranscriptionOutput, error) {
	if request.GetSourceAudio().GetRange() == nil || info.GetSampleRateHz() < 8000 || info.GetSampleRateHz() > 96000 || request.GetSourceAudio().GetRange().GetEndFrame() <= request.GetSourceAudio().GetRange().GetStartFrame() || request.GetSourceAudio().GetRange().GetEndFrame() > info.GetFrameCount() {
		return nil, fmt.Errorf("SheetSage2 captured source is invalid")
	}
	if err := musicscore.ValidateABC(score, false); err != nil {
		return nil, fmt.Errorf("SheetSage2 score: %w", err)
	}
	if len(nativeEvents) == 0 || len(nativeEvents) > 33<<20 {
		return nil, fmt.Errorf("SheetSage2 event envelope exceeds its bound")
	}
	var envelope struct {
		ID         string `json:"id"`
		Kind       string `json:"kind"`
		Bytes      int    `json:"bytes"`
		PayloadHex string `json:"payload_hex"`
		Meta       struct {
			Extension string `json:"extension"`
			Format    string `json:"format"`
			MIME      string `json:"mime"`
		} `json:"meta"`
	}
	if err := decodeSheetJSON(nativeEvents, &envelope); err != nil {
		return nil, fmt.Errorf("SheetSage2 envelope: %w", err)
	}
	if envelope.ID != "events" || envelope.Kind != "custom" || envelope.Meta.Extension != "json" || envelope.Meta.Format != "sheetsage2-events-json" || envelope.Meta.MIME != "application/json" || envelope.Bytes < 1 || envelope.Bytes > musicscore.MaxTimelineBytes || len(envelope.PayloadHex) != envelope.Bytes*2 {
		return nil, fmt.Errorf("SheetSage2 event envelope is invalid")
	}
	payload, err := hex.DecodeString(envelope.PayloadHex)
	if err != nil {
		return nil, fmt.Errorf("SheetSage2 event payload: %w", err)
	}
	var native struct {
		Events []sheetSageEvent `json:"events"`
	}
	if err := decodeSheetJSON(payload, &native); err != nil {
		return nil, fmt.Errorf("SheetSage2 event payload: %w", err)
	}
	if len(native.Events) == 0 || len(native.Events) > 100000 || request.GetSourceAudio().GetRange() == nil || info == nil {
		return nil, fmt.Errorf("SheetSage2 event or source facts are missing")
	}
	rangeValue := request.GetSourceAudio().GetRange()
	timeline := musicscore.Timeline{Version: 1, SourceArtifactID: request.GetSourceAudio().GetArtifactId(),
		AudioInfo:  musicscore.TimelineAudioInfo{SampleRateHz: info.GetSampleRateHz(), Channels: info.GetChannels(), FrameCount: info.GetFrameCount(), DurationMS: info.GetFrameCount() * 1000 / uint64(info.GetSampleRateHz())},
		InputRange: musicscore.TimelineRange{StartFrame: rangeValue.GetStartFrame(), EndFrame: rangeValue.GetEndFrame()}, Events: []musicscore.TimelineEvent{}}
	frame := func(seconds float64, endpoint bool) (uint64, error) {
		span := rangeValue.GetEndFrame() - rangeValue.GetStartFrame()
		if math.IsNaN(seconds) || math.IsInf(seconds, 0) || seconds < 0 || seconds*float64(info.GetSampleRateHz()) > float64(span)+1 {
			return 0, fmt.Errorf("SheetSage2 event time is outside the source")
		}
		value := uint64(math.Round(seconds * float64(info.GetSampleRateHz())))
		if value > span {
			value = span
		}
		if !endpoint && value == span {
			value--
		}
		return rangeValue.GetStartFrame() + value, nil
	}
	chords := sheetFullChordLabels()
	for index, event := range native.Events {
		if index > 0 && event.Time < native.Events[index-1].Time {
			return nil, fmt.Errorf("SheetSage2 events are unordered")
		}
		start, err := frame(event.Time, false)
		if err != nil {
			return nil, err
		}
		for field := range event.Tokens {
			switch field {
			case "timestamp", "rhythm", "structure", "key", "chord", "melody":
			default:
				return nil, fmt.Errorf("SheetSage2 event field is unsupported")
			}
		}
		var numerator, denominator, eighth *int
		for _, token := range event.Tokens["rhythm"] {
			switch {
			case token >= 30517 && token < 30709:
				if numerator != nil {
					return nil, fmt.Errorf("SheetSage2 meter is duplicated")
				}
				n, d := (token-30517)/6+1, 1<<((token-30517)%6)
				numerator, denominator = &n, &d
			case token >= 30709 && token < 30965:
				if eighth != nil {
					return nil, fmt.Errorf("SheetSage2 beat is duplicated")
				}
				value := token - 30709
				eighth = &value
			default:
				return nil, fmt.Errorf("SheetSage2 rhythm token is unsupported")
			}
		}
		if numerator != nil && eighth == nil {
			return nil, fmt.Errorf("SheetSage2 meter lacks its beat")
		}
		if eighth != nil {
			timeline.Events = append(timeline.Events, musicscore.TimelineEvent{Kind: "beat", StartFrame: start, EighthsFromDownbeat: eighth, MeterNumerator: numerator, MeterDenominator: denominator})
		}
		for _, field := range []string{"structure", "key", "chord"} {
			if len(event.Tokens[field]) > 1 {
				return nil, fmt.Errorf("SheetSage2 label is duplicated")
			}
			for _, token := range event.Tokens[field] {
				kind, label := field, ""
				switch {
				case field == "structure" && token >= 30965 && token < 30988:
					kind, label = "section", sheetStructureLabels[token-30965]
				case field == "key" && token >= 30988 && token < 31012:
					value := token - 30988
					mode := ":major"
					if value >= 12 {
						mode = ":minor"
					}
					label = sheetPitchClasses[value%12] + mode
				case field == "chord" && token >= 31012 && token < 31037:
					value := token - 31012
					label = "N"
					if value > 0 {
						quality := ":maj"
						if value > 12 {
							quality = ":min"
						}
						label = sheetPitchClasses[(value-1)%12] + quality
					}
				case field == "chord" && token >= 31037 && token < 31398:
					label = chords[token-31037]
				default:
					return nil, fmt.Errorf("SheetSage2 label token is unsupported")
				}
				timeline.Events = append(timeline.Events, musicscore.TimelineEvent{Kind: kind, StartFrame: start, Label: label})
			}
		}
		for _, note := range event.Notes {
			if note.Track < 0 || note.Track > 1 {
				return nil, fmt.Errorf("SheetSage2 note track is unsupported")
			}
			end, err := frame(note.EndTime, true)
			if err != nil {
				return nil, err
			}
			pitch, track := note.Pitch, note.Track
			timeline.Events = append(timeline.Events, musicscore.TimelineEvent{Kind: "note", StartFrame: start, EndFrame: &end, MIDIPitch: &pitch, TrackIndex: &track})
		}
		if len(timeline.Events) > 100000 {
			return nil, fmt.Errorf("SheetSage2 normalized events exceed the bound")
		}
	}
	encoded, err := musicscore.MarshalTimeline(timeline)
	if err != nil {
		return nil, err
	}
	result := &MusicTranscriptionOutput{Completeness: runtimev1.MusicTranscriptionCompleteness_MUSIC_TRANSCRIPTION_COMPLETENESS_UNKNOWN}
	for _, format := range request.GetRequestedFormats() {
		switch format {
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_ABC:
			result.Scores = append(result.Scores, MusicTranscriptionScoreOutput{Format: runtimev1.MusicScoreFormat_MUSIC_SCORE_FORMAT_ABC, Part: runtimev1.MusicTranscriptionPart_MUSIC_TRANSCRIPTION_PART_LEAD_SHEET, Bytes: append([]byte(nil), score...)})
		case runtimev1.MusicTranscriptionFormat_MUSIC_TRANSCRIPTION_FORMAT_TIMELINE:
			result.TimelineJSON = encoded
		default:
			return nil, fmt.Errorf("SheetSage2 output format is unsupported")
		}
	}
	return result, nil
}

func sheetFullChordLabels() []string {
	labels := []string{"N"}
	for _, quality := range []string{"maj", "min", "dim", "aug", "maj7", "min7", "7", "hdim7", "dim7", "minmaj7", "sus2", "sus4", "sus4(b7)", "maj6", "min6"} {
		inversions := map[string][]string{"maj": {"/2", "/3", "/5"}, "min": {"/2", "/b3", "/5"}, "maj7": {"/3", "/5", "/7"}, "min7": {"/b3", "/5", "/b7"}, "7": {"/3", "/5", "/b7"}}
		for _, root := range sheetPitchClasses {
			for _, inversion := range append(inversions[quality], "") {
				labels = append(labels, root+":"+quality+inversion)
			}
		}
	}
	return labels
}
