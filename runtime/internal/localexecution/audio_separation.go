package localexecution

import (
	"context"
	"fmt"
	"io"
	"strings"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
)

type AudioSeparationResult struct {
	Vocals       io.ReadCloser
	Background   io.ReadCloser
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
	if value == nil || len(artifacts) != 2 || artifacts[0] == nil || artifacts[1] == nil ||
		value.GetVocalsArtifactId() == "" || value.GetBackgroundArtifactId() == "" || value.GetVocalsArtifactId() == value.GetBackgroundArtifactId() ||
		value.GetVocalsArtifactId() != artifacts[0].GetArtifactId() || value.GetBackgroundArtifactId() != artifacts[1].GetArtifactId() {
		return fmt.Errorf("audio separation requires its two distinct committed artifact identities")
	}
	for _, artifact := range artifacts {
		if !strings.HasPrefix(artifact.GetMimeType(), "audio/") || artifact.GetSizeBytes() <= 0 || artifact.GetSampleRateHz() <= 0 || artifact.GetChannels() <= 0 || artifact.GetDurationMs() < 0 {
			return fmt.Errorf("audio separation artifact metadata is invalid")
		}
	}
	if artifacts[0].GetDurationMs() != artifacts[1].GetDurationMs() || artifacts[0].GetSampleRateHz() != artifacts[1].GetSampleRateHz() || artifacts[0].GetChannels() != artifacts[1].GetChannels() {
		return fmt.Errorf("audio separation artifacts do not preserve the same timeline")
	}
	return nil
}
