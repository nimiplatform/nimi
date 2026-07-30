package localservice

import (
	"path/filepath"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestSelectedSpeechPackageSetSourceRequiresDriverEvidenceAndSkipsAggregate(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	root := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	aggregateRoot := filepath.Join(t.TempDir(), "speech", "0.1.0")
	consumer := "speech.qwen3-tts.python"
	envKey := "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
	driverScript := engine.SpeechQwen3TTSDriverPath(root)

	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "local-speech.package-set",
		EnvironmentKey:   "python.package-set|local-speech.package-set|host|darwin/arm64|root",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    aggregateRoot,
		SelectedConsumers: []string{
			"speech.qwen3-asr.python",
			consumer,
		},
		VerifiedArtifacts: []string{
			filepath.Join(aggregateRoot, "bin", "python"),
		},
	}))
	splitRecord := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "local-speech-qwen3-tts.package-set",
		EnvironmentKey:   "python.package-set|local-speech-qwen3-tts.package-set|host|darwin/arm64|root",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    root,
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
	})
	writeSelectedSourceLocalArtifactsForTest(t, splitRecord)
	svc.upsertLocalEnvironmentSelectedSourceRecord(splitRecord)

	record, ok, detail := svc.selectedSpeechPackageSetSourceForConsumer(consumer, envKey, engine.SpeechQwen3TTSDriverPath)
	if !ok {
		t.Fatalf("expected valid split speech package-set source, got detail=%q", detail)
	}
	if record.DependencyID != "local-speech-qwen3-tts.package-set" {
		t.Fatalf("selected dependency id = %q, want split qwen3 tts record", record.DependencyID)
	}
}

func upsertVerifiedSpeechPackageSetForTest(
	t *testing.T,
	svc *Service,
	consumer string,
	dependencyID string,
	root string,
	envKey string,
	driverPath func(string) string,
) {
	t.Helper()
	driverScript := driverPath(root)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     dependencyID,
		EnvironmentKey:   "python.package-set|" + dependencyID + "|host|darwin/arm64|root",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    root,
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
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
}
