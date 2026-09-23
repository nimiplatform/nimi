package localexecution

import (
	"context"
	"fmt"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

type AudioInstrumentPartBody struct {
	Kind runtimev1.AudioInstrumentPartKind
	Body io.ReadCloser
}

type AudioSeparationResult struct {
	Vocals       io.ReadCloser
	Background   io.ReadCloser
	Instrument   []AudioInstrumentPartBody
	SampleRateHz int32
	Channels     int32
	SampleCount  int64
	Usage        *runtimev1.UsageStats
}

type AudioSeparationExecutionHost interface {
	ExecuteAudioSeparation(context.Context, *capabilitydriver.AudioSeparateInvocationPlan, SpeechExecutionStartFunc) (AudioSeparationResult, error)
}

// @nimi-authority: rule.nimi.runtime.ai-provider.audio-separation
func ValidateAudioSeparation(value *runtimev1.AudioSeparation, artifacts []*runtimev1.ScenarioArtifact) error {
	if value == nil || len(artifacts) < 2 {
		return fmt.Errorf("audio separation requires its two distinct committed artifact identities")
	}
	if value.GetVocalsArtifactId() == "" || value.GetBackgroundArtifactId() == "" || value.GetVocalsArtifactId() == value.GetBackgroundArtifactId() ||
		value.GetVocalsArtifactId() != artifacts[0].GetArtifactId() || value.GetBackgroundArtifactId() != artifacts[1].GetArtifactId() {
		return fmt.Errorf("audio separation requires its two distinct committed artifact identities")
	}
	parts := value.GetInstrumentParts()
	if len(artifacts) != 2+len(parts) {
		return fmt.Errorf("audio separation artifact set does not match its instrument parts")
	}
	seenKinds := map[runtimev1.AudioInstrumentPartKind]bool{}
	seenIDs := map[string]bool{value.GetVocalsArtifactId(): true, value.GetBackgroundArtifactId(): true}
	for index, part := range parts {
		kind := part.GetPart()
		if part == nil || (kind != runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_DRUMS && kind != runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_BASS && kind != runtimev1.AudioInstrumentPartKind_AUDIO_INSTRUMENT_PART_KIND_OTHER) || seenKinds[kind] || seenIDs[part.GetArtifactId()] {
			return fmt.Errorf("audio separation instrument part identity is invalid")
		}
		seenKinds[kind] = true
		seenIDs[part.GetArtifactId()] = true
		if part.GetArtifactId() != artifacts[2+index].GetArtifactId() {
			return fmt.Errorf("audio separation instrument part is out of order")
		}
	}
	for _, artifact := range artifacts {
		if artifact == nil || !strings.HasPrefix(artifact.GetMimeType(), "audio/") || artifact.GetSizeBytes() <= 0 || artifact.GetSampleRateHz() <= 0 || artifact.GetChannels() <= 0 || artifact.GetDurationMs() < 0 {
			return fmt.Errorf("audio separation artifact metadata is invalid")
		}
	}
	if artifacts[0].GetDurationMs() != artifacts[1].GetDurationMs() || artifacts[0].GetSampleRateHz() != artifacts[1].GetSampleRateHz() || artifacts[0].GetChannels() != artifacts[1].GetChannels() {
		return fmt.Errorf("audio separation artifacts do not preserve the same timeline")
	}
	for _, artifact := range artifacts[2:] {
		if artifact.GetDurationMs() != artifacts[0].GetDurationMs() || artifact.GetSampleRateHz() != artifacts[0].GetSampleRateHz() || artifact.GetChannels() != artifacts[0].GetChannels() {
			return fmt.Errorf("audio separation instrument parts do not preserve the same timeline")
		}
	}
	return nil
}
