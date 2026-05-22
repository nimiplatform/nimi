package daemon

import (
	"context"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

type fakeSpeechSelectedSourceLister struct {
	sources []*runtimev1.LocalEnvironmentSelectedSourceRecord
}

func (f fakeSpeechSelectedSourceLister) ListLocalEnvironmentSelectedSources(context.Context, *runtimev1.ListLocalEnvironmentSelectedSourcesRequest) (*runtimev1.ListLocalEnvironmentSelectedSourcesResponse, error) {
	return &runtimev1.ListLocalEnvironmentSelectedSourcesResponse{Sources: f.sources}, nil
}

func TestSpeechPackageSetRootForConsumerSkipsLegacyAggregateWithoutDriverEvidence(t *testing.T) {
	root := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	legacyRoot := filepath.Join(t.TempDir(), "speech", "0.1.0")
	consumer := "speech.qwen3-tts.python"
	envKey := "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
	driverScript := engine.SpeechQwen3TTSDriverPath(root)

	got, err := speechPackageSetRootForConsumer(context.Background(), fakeSpeechSelectedSourceLister{
		sources: []*runtimev1.LocalEnvironmentSelectedSourceRecord{
			{
				DependencyFamily: "python.package-set",
				DependencyId:     "local-speech.package-set",
				SourceKind:       "managed",
				CanonicalRoot:    legacyRoot,
				RepairState:      "none",
				SelectedConsumers: []string{
					"speech.qwen3-asr.python",
					consumer,
				},
				VerifiedArtifacts: []string{
					filepath.Join(legacyRoot, "bin", "python"),
				},
			},
			{
				DependencyFamily: "python.package-set",
				DependencyId:     "local-speech-qwen3-tts.package-set",
				SourceKind:       "managed",
				CanonicalRoot:    root,
				RepairState:      "none",
				SelectedConsumers: []string{
					consumer,
				},
				VerifiedArtifacts: []string{
					filepath.Join(root, "bin", "python"),
					driverScript,
				},
				ActivationEnvDelta: []string{
					envKey + "='python' '" + driverScript + "'",
				},
			},
		},
	}, consumer, envKey, engine.SpeechQwen3TTSDriverPath)
	if err != nil {
		t.Fatalf("speechPackageSetRootForConsumer: %v", err)
	}
	if got != root {
		t.Fatalf("root = %q, want %q", got, root)
	}
}
