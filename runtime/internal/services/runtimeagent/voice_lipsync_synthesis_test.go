package runtimeagent

import (
	"strings"
	"testing"
)

func TestSyntheticVoiceLipsyncSynthesizerProducesMonotonicFrames(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-001",
		MessageID: "message-001",
		Text:      "Hello world this is a synthetic lipsync line.",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if !strings.HasPrefix(out.AudioArtifactID, syntheticVoiceArtifactScheme+"/turn-001") {
		t.Fatalf("audio artifact id missing synthetic prefix or turn id: %q", out.AudioArtifactID)
	}
	if out.AudioMimeType != syntheticVoiceMimeType {
		t.Fatalf("audio mime type expected %s, got %s", syntheticVoiceMimeType, out.AudioMimeType)
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected non-empty synthetic frame batch")
	}
	if out.DurationMs <= 0 {
		t.Fatalf("expected positive duration_ms, got %d", out.DurationMs)
	}

	var prevSeq uint64
	var prevOffset int64 = -1
	for i, frame := range out.Frames {
		if frame.FrameSequence != uint64(i+1) {
			t.Fatalf("frame[%d] sequence expected %d, got %d", i, i+1, frame.FrameSequence)
		}
		if frame.FrameSequence <= prevSeq {
			t.Fatalf("frame[%d] sequence not monotonic: %d <= %d", i, frame.FrameSequence, prevSeq)
		}
		if frame.OffsetMs < prevOffset {
			t.Fatalf("frame[%d] offset_ms not monotonic: %d < %d", i, frame.OffsetMs, prevOffset)
		}
		if frame.DurationMs != syntheticLipsyncFrameDurationMs {
			t.Fatalf("frame[%d] duration expected %d, got %d", i, syntheticLipsyncFrameDurationMs, frame.DurationMs)
		}
		if frame.MouthOpenY < 0 || frame.MouthOpenY > 1 {
			t.Fatalf("frame[%d] mouth_open_y out of [0,1]: %f", i, frame.MouthOpenY)
		}
		if frame.AudioLevel < 0 || frame.AudioLevel > 1 {
			t.Fatalf("frame[%d] audio_level out of [0,1]: %f", i, frame.AudioLevel)
		}
		prevSeq = frame.FrameSequence
		prevOffset = frame.OffsetMs
	}

	// Spec downstream check: the projection builder MUST accept this output unchanged.
	detail, err := publicChatBuildLipsyncFrameBatchDetail(publicChatLipsyncFrameBatchProjection{
		AudioArtifactID: out.AudioArtifactID,
		Frames:          out.Frames,
	})
	if err != nil {
		t.Fatalf("projection rejected synthesized frames: %v", err)
	}
	frames, ok := detail["frames"].([]any)
	if !ok || len(frames) != len(out.Frames) {
		t.Fatalf("projection frames mismatch: got %v", detail["frames"])
	}
}

func TestSyntheticVoiceLipsyncSynthesizerSkipsEmptyInputs(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()

	cases := []voiceLipsyncSynthesisInput{
		{TurnID: "", MessageID: "m", Text: "hi"},
		{TurnID: "t", MessageID: "m", Text: ""},
		{TurnID: "t", MessageID: "m", Text: "   "},
	}
	for i, input := range cases {
		out, err := synth.synthesize(input)
		if err != nil {
			t.Fatalf("case[%d]: unexpected error %v", i, err)
		}
		if out.AudioArtifactID != "" || out.AudioMimeType != "" || len(out.Frames) != 0 || out.DurationMs != 0 {
			t.Fatalf("case[%d]: expected zero-value output for empty input, got %+v", i, out)
		}
	}
}

func TestSyntheticVoiceLipsyncSynthesizerRespectsMaxFrameCap(t *testing.T) {
	t.Parallel()
	synth := newSyntheticVoiceLipsyncSynthesizer()
	longText := strings.Repeat("hello world ", 400)
	out, err := synth.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-long",
		MessageID: "m-long",
		Text:      longText,
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if len(out.Frames) > syntheticLipsyncMaxFrames {
		t.Fatalf("expected frame count <= %d, got %d", syntheticLipsyncMaxFrames, len(out.Frames))
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected non-empty frame batch on long input")
	}
}

func TestSyntheticVoiceLipsyncSynthesizerInstalledOnService(t *testing.T) {
	t.Parallel()
	svc := newRuntimeAgentServiceForPublicChatTest(t)
	if svc.voiceLipsync == nil {
		t.Fatalf("expected runtime Service to inject a default voiceLipsync synthesizer")
	}
	out, err := svc.voiceLipsync.synthesize(voiceLipsyncSynthesisInput{
		TurnID:    "turn-svc",
		MessageID: "msg-svc",
		Text:      "hello from service",
	})
	if err != nil {
		t.Fatalf("synthesize: %v", err)
	}
	if len(out.Frames) == 0 {
		t.Fatalf("expected synthesizer to produce frames via Service injection")
	}
}
