package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestSelectedSpeechPackageSetSourceRequiresDriverEvidenceAndSkipsLegacyAggregate(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	root := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	legacyRoot := filepath.Join(t.TempDir(), "speech", "0.1.0")
	consumer := "speech.qwen3-tts.python"
	envKey := "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
	driverScript := engine.SpeechQwen3TTSDriverPath(root)

	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "local-speech.package-set",
		EnvironmentKey:   "python.package-set|local-speech.package-set|host|darwin/arm64|root",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    legacyRoot,
		SelectedConsumers: []string{
			"speech.qwen3-asr.python",
			consumer,
		},
		VerifiedArtifacts: []string{
			filepath.Join(legacyRoot, "bin", "python"),
		},
		ActivationEnvDelta: nil,
	}))
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
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
	}))

	record, ok, detail := svc.selectedSpeechPackageSetSourceForConsumer(consumer, envKey, engine.SpeechQwen3TTSDriverPath)
	if !ok {
		t.Fatalf("expected valid split speech package-set source, got detail=%q", detail)
	}
	if record.DependencyID != "local-speech-qwen3-tts.package-set" {
		t.Fatalf("selected dependency id = %q, want split qwen3 tts record", record.DependencyID)
	}
}

func TestEnsureFirstRunSpeechEngineReadyRequiresHealthyStatus(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "unhealthy",
		Port:     8330,
		Endpoint: "http://127.0.0.1:8330",
	}}
	svc.SetEngineManager(mgr)
	svc.localModelsPath = filepath.Join(t.TempDir(), "models")

	ttsRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	asrRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-asr")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-tts.python", "local-speech-qwen3-tts.package-set", ttsRoot, "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr.python", "local-speech-qwen3-asr.package-set", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)

	err := svc.ensureFirstRunSpeechEngineReady(context.Background(), runtimeBaselineReadinessRecord{
		ActivationReadyResponses: []runtimeBaselineActivationConsumerEvidence{
			{ConsumerID: "speech.qwen3-asr.python"},
			{ConsumerID: "speech.qwen3-tts.python"},
		},
	})
	if err == nil {
		t.Fatalf("expected unhealthy speech engine status to fail first-run activation")
	}
	if !strings.Contains(err.Error(), "speech engine not healthy after activation") {
		t.Fatalf("unexpected error: %v", err)
	}
	if mgr.startConfigCalls != 1 {
		t.Fatalf("expected StartEngineWithConfig to be called once, got %d", mgr.startConfigCalls)
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
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
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
	}))
}
