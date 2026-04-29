package runtimeagent

import (
	"math"
	"strings"
	"unicode"
)

// Wave 3 — Voice/lipsync synthesis adapter for committed assistant turns.
//
// Per spec K-AGCORE-051 (`.nimi/spec/runtime/kernel/agent-presentation-stream-contract.md`)
// runtime owns timeline truth for lipsync frames; provider selection is
// explicitly outside the rule. This file admits a deterministic, in-process
// synthesizer that produces lipsync frames from committed assistant text
// without external dependencies. Real TTS providers (Piper / kokoro / cloud
// providers) integrate by implementing the same `voiceLipsyncSynthesizer`
// interface and registering through constructor injection.
//
// The synthetic adapter does NOT produce audio bytes. It produces:
//   - audio_artifact_id with `synthetic://lipsync/<turn_id>` prefix so
//     consumers can detect frame-only timelines and fail-close audio playback.
//   - audio_mime_type = `application/x-nimi-synthetic-lipsync` (clearly
//     non-audio MIME) so any client treating it as audio fails closed.
//   - frame timing derived from character cadence (~14 chars/sec) and a
//     per-syllable open/close envelope so the avatar gets visually plausible
//     mouth movement aligned with the committed text length.

const (
	syntheticVoiceArtifactScheme = "synthetic://lipsync"
	syntheticVoiceMimeType       = "application/x-nimi-synthetic-lipsync"

	syntheticLipsyncFrameDurationMs    int64   = 80
	syntheticLipsyncMinTotalMs         int64   = 600
	syntheticLipsyncCharMs             int64   = 70
	syntheticLipsyncMaxFrames          int     = 256
	syntheticLipsyncEnvelopePeak       float64 = 0.78
	syntheticLipsyncEnvelopeFloor      float64 = 0.04
	syntheticLipsyncWordBoundaryDamp   float64 = 0.32
	syntheticLipsyncPunctuationDampDur int64   = 120
)

type voiceLipsyncSynthesisInput struct {
	TurnID    string
	MessageID string
	Text      string
}

type voiceLipsyncSynthesisOutput struct {
	AudioArtifactID string
	AudioMimeType   string
	DurationMs      int64
	Frames          []publicChatLipsyncFrameProjection
}

// voiceLipsyncSynthesizer is the runtime-injected adapter contract. Real TTS
// providers MUST also produce frames (mouth_open_y + audio_level per
// K-AGCORE-051) regardless of whether they emit audio bytes.
type voiceLipsyncSynthesizer interface {
	synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error)
}

type syntheticVoiceLipsyncSynthesizer struct{}

func newSyntheticVoiceLipsyncSynthesizer() syntheticVoiceLipsyncSynthesizer {
	return syntheticVoiceLipsyncSynthesizer{}
}

func (syntheticVoiceLipsyncSynthesizer) synthesize(input voiceLipsyncSynthesisInput) (voiceLipsyncSynthesisOutput, error) {
	turnID := strings.TrimSpace(input.TurnID)
	text := strings.TrimSpace(input.Text)
	// Empty text is not a synthesis target — caller should skip emission.
	if turnID == "" || text == "" {
		return voiceLipsyncSynthesisOutput{}, nil
	}

	frames := buildSyntheticLipsyncFrames(text)
	if len(frames) == 0 {
		return voiceLipsyncSynthesisOutput{}, nil
	}

	last := frames[len(frames)-1]
	totalDuration := last.OffsetMs + last.DurationMs

	return voiceLipsyncSynthesisOutput{
		AudioArtifactID: syntheticVoiceArtifactScheme + "/" + turnID,
		AudioMimeType:   syntheticVoiceMimeType,
		DurationMs:      totalDuration,
		Frames:          frames,
	}, nil
}

// buildSyntheticLipsyncFrames returns deterministic mouth-open frames whose
// total length covers the natural cadence of `text`. Each frame is exactly
// `syntheticLipsyncFrameDurationMs` long; mouth_open_y oscillates per syllable
// with envelope dampening on whitespace and punctuation so the avatar visibly
// pauses between words.
func buildSyntheticLipsyncFrames(text string) []publicChatLipsyncFrameProjection {
	visibleChars := countVisibleChars(text)
	if visibleChars == 0 {
		return nil
	}

	totalMs := int64(visibleChars) * syntheticLipsyncCharMs
	if totalMs < syntheticLipsyncMinTotalMs {
		totalMs = syntheticLipsyncMinTotalMs
	}
	frameCount := int(totalMs / syntheticLipsyncFrameDurationMs)
	if frameCount < 1 {
		frameCount = 1
	}
	if frameCount > syntheticLipsyncMaxFrames {
		frameCount = syntheticLipsyncMaxFrames
	}

	cadence := buildSyllableCadence(text, frameCount)

	frames := make([]publicChatLipsyncFrameProjection, 0, frameCount)
	for i := 0; i < frameCount; i++ {
		offset := int64(i) * syntheticLipsyncFrameDurationMs
		envelope := cadence[i]
		mouthOpen := clampUnit(envelope)
		// audio_level mirrors envelope but slightly compressed so the avatar's
		// audio meter doesn't bottom out on word boundaries.
		audioLevel := clampUnit(envelope*0.85 + 0.05)
		frames = append(frames, publicChatLipsyncFrameProjection{
			FrameSequence: uint64(i + 1),
			OffsetMs:      offset,
			DurationMs:    syntheticLipsyncFrameDurationMs,
			MouthOpenY:    mouthOpen,
			AudioLevel:    audioLevel,
		})
	}
	return frames
}

// buildSyllableCadence produces a per-frame envelope vector. The envelope
// follows a 2.5-Hz syllabic carrier (typical speech rate) with damping at
// word boundaries so the mouth visibly closes on whitespace. The carrier is
// deterministic (no rand) so test fixtures stay reproducible.
func buildSyllableCadence(text string, frameCount int) []float64 {
	envelope := make([]float64, frameCount)
	if frameCount == 0 {
		return envelope
	}
	// Word-boundary mask: indices where the dominant frame phase falls inside
	// a whitespace / punctuation run get damped.
	boundaryMask := buildBoundaryMask(text, frameCount)
	for i := 0; i < frameCount; i++ {
		// 2.5Hz syllabic carrier mapped to frame index. With 80ms per frame,
		// one syllable cycle ≈ 5 frames.
		phase := float64(i) * 2.0 * math.Pi / 5.0
		// Half-rectified sine yields plausible open/close mouth shape.
		base := math.Abs(math.Sin(phase))
		level := syntheticLipsyncEnvelopeFloor + (syntheticLipsyncEnvelopePeak-syntheticLipsyncEnvelopeFloor)*base
		if boundaryMask[i] {
			level = syntheticLipsyncEnvelopeFloor + (level-syntheticLipsyncEnvelopeFloor)*syntheticLipsyncWordBoundaryDamp
		}
		envelope[i] = level
	}
	return envelope
}

// buildBoundaryMask returns a per-frame boolean indicating whether the
// corresponding character run is whitespace or punctuation. Used to dampen
// mouth amplitude on word boundaries in `buildSyllableCadence`.
func buildBoundaryMask(text string, frameCount int) []bool {
	mask := make([]bool, frameCount)
	if frameCount == 0 {
		return mask
	}
	runes := []rune(text)
	if len(runes) == 0 {
		return mask
	}
	for i := 0; i < frameCount; i++ {
		// Map frame i back to a character index proportionally.
		ratio := float64(i) / float64(frameCount)
		idx := int(math.Floor(ratio * float64(len(runes))))
		if idx >= len(runes) {
			idx = len(runes) - 1
		}
		r := runes[idx]
		if unicode.IsSpace(r) || unicode.IsPunct(r) {
			mask[i] = true
		}
	}
	return mask
}

func countVisibleChars(text string) int {
	count := 0
	for _, r := range text {
		if unicode.IsSpace(r) {
			continue
		}
		count++
	}
	return count
}

func clampUnit(value float64) float64 {
	if math.IsNaN(value) || math.IsInf(value, 0) {
		return 0
	}
	if value < 0 {
		return 0
	}
	if value > 1 {
		return 1
	}
	return value
}
