package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
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

func TestEnsureFirstRunSpeechEngineReadyRequiresHealthyStatus(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "unhealthy",
		Detail:   "startup health failed: process exited with status 0xc0000142",
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
	if !strings.Contains(err.Error(), "process exited with status 0xc0000142") {
		t.Fatalf("expected bounded supervisor failure detail, got: %v", err)
	}
	if mgr.startConfigCalls != 1 {
		t.Fatalf("expected StartEngineWithConfig to be called once, got %d", mgr.startConfigCalls)
	}
}

func TestEnsureFirstRunSpeechEngineReadyPublishesSpeechProviderEndpoint(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	sink := &capturingLocalProviderEndpointSink{}
	svc.SetLocalProviderEndpointSink(sink)
	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "healthy",
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
	if err != nil {
		t.Fatalf("ensure first-run speech engine ready: %v", err)
	}
	if sink.providerID != "speech" {
		t.Fatalf("published provider id = %q, want speech", sink.providerID)
	}
	if sink.endpoint != "http://127.0.0.1:8330/v1" {
		t.Fatalf("published endpoint = %q, want speech /v1 endpoint", sink.endpoint)
	}
}

func TestEnsureFirstRunSpeechEngineReadyRegistersSpeechResidency(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	svc.localModelKeepAlive = 0

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "healthy",
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
	if err != nil {
		t.Fatalf("ensure first-run speech engine ready: %v", err)
	}
	svc.runResidencySweep(context.Background())
	if !containsString(mgr.stopEngines, "speech") {
		t.Fatalf("expected speech engine idle-stop after first-run residency expires, got %#v", mgr.stopEngines)
	}
}

func TestEnsureFirstRunSpeechEngineReadyFailsBeforeStartWhenPackageSetArtifactsMissing(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine: "speech",
		Status: "healthy",
	}}
	svc.SetEngineManager(mgr)
	svc.localModelsPath = filepath.Join(t.TempDir(), "models")

	ttsRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	asrRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-asr")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr.python", "local-speech-qwen3-asr.package-set", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)

	driverScript := engine.SpeechQwen3TTSDriverPath(ttsRoot)
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "local-speech-qwen3-tts.package-set",
		EnvironmentKey:   "python.package-set|local-speech-qwen3-tts.package-set|host|darwin/arm64|root",
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    ttsRoot,
		SelectedConsumers: []string{
			"speech.qwen3-tts.python",
		},
		VerifiedArtifacts: []string{
			filepath.Join(ttsRoot, "bin", "python"),
			driverScript,
		},
		ActivationEnvDelta: []string{
			"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD='python' '" + driverScript + "'",
		},
	}))

	err := svc.ensureFirstRunSpeechEngineReady(context.Background(), runtimeBaselineReadinessRecord{
		ActivationReadyResponses: []runtimeBaselineActivationConsumerEvidence{
			{ConsumerID: "speech.qwen3-asr.python"},
			{ConsumerID: "speech.qwen3-tts.python"},
		},
	})
	if err == nil {
		t.Fatalf("expected missing speech package-set artifacts to fail before engine start")
	}
	if !strings.Contains(err.Error(), "fails local artifact verification") {
		t.Fatalf("unexpected error: %v", err)
	}
	if mgr.startConfigCalls != 0 {
		t.Fatalf("expected StartEngineWithConfig to be skipped, got %d calls", mgr.startConfigCalls)
	}
}

func TestEnsureFirstRunSpeechEngineReadyRefreshesBoundSpeechAssets(t *testing.T) {
	const (
		asrAssetID = "local.stt.qwen3-asr-0.6b.safetensors"
		ttsAssetID = "local.tts.qwen3-tts-customvoice-0.6b.safetensors"
	)
	probedEndpoints := make([]string, 0, 2)
	svc := newTestServiceWithProbe(t, func(_ context.Context, endpoint string) endpointProbeResult {
		probedEndpoints = append(probedEndpoints, endpoint)
		return endpointProbeResult{
			healthy:   true,
			responded: true,
			detail:    "probe succeeded",
			probeURL:  endpoint,
			models:    []string{asrAssetID, ttsAssetID},
			modelCaps: map[string][]string{
				asrAssetID: {"audio.transcribe"},
				ttsAssetID: {"audio.synthesize"},
			},
		}
	})
	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:   "speech",
		Status:   "healthy",
		PID:      1234,
		Port:     8330,
		Endpoint: "http://127.0.0.1:8330",
	}}
	svc.SetEngineManager(mgr)
	svc.SetManagedSpeechEndpoint("http://127.0.0.1:8330/v1")

	ttsRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-tts")
	asrRoot := filepath.Join(t.TempDir(), "speech", "0.1.0-qwen3-asr")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-tts.python", "local-speech-qwen3-tts.package-set", ttsRoot, "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr.python", "local-speech-qwen3-asr.package-set", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)

	asr := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      asrAssetID,
		capabilities: []string{"audio.transcribe"},
		engine:       "speech",
		entry:        "model.safetensors",
		files:        []string{"model.safetensors"},
	})
	writeManagedBundleFilesForTest(t, svc, asr, []string{"model.safetensors"}, map[string][]byte{
		"model.safetensors": []byte("fake-asr"),
	})
	tts := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      ttsAssetID,
		capabilities: []string{"audio.synthesize"},
		engine:       "speech",
		entry:        "model.safetensors",
		files:        []string{"model.safetensors", "voices.json"},
	})
	writeManagedBundleFilesForTest(t, svc, tts, []string{"model.safetensors", "voices.json"}, map[string][]byte{
		"model.safetensors": []byte("fake-tts"),
		"voices.json":       []byte(`{"voices":["af"]}`),
	})
	for _, model := range []*runtimev1.LocalAssetRecord{asr, tts} {
		if _, err := svc.updateModelAvailabilityAndWarmState(
			model.GetLocalAssetId(),
			runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY,
			runtimev1.LocalWarmState_LOCAL_WARM_STATE_FAILED,
			"seed unhealthy",
			true,
		); err != nil {
			t.Fatalf("seed unhealthy speech asset %q: %v", model.GetAssetId(), err)
		}
	}

	err := svc.ensureFirstRunSpeechEngineReady(context.Background(), runtimeBaselineReadinessRecord{
		ActivationReadyResponses: []runtimeBaselineActivationConsumerEvidence{
			{ConsumerID: "speech.qwen3-asr.python", BoundAssetID: asrAssetID},
			{ConsumerID: "speech.qwen3-tts.python", BoundAssetID: ttsAssetID},
		},
	})
	if err != nil {
		t.Fatalf("ensure first-run speech engine ready: %v", err)
	}
	if mgr.startConfigCalls != 0 {
		t.Fatalf("expected already-bound speech engine to skip configured start, got %d", mgr.startConfigCalls)
	}
	if len(probedEndpoints) != 2 {
		t.Fatalf("expected one health refresh per bound speech asset, got %#v", probedEndpoints)
	}
	for _, model := range []*runtimev1.LocalAssetRecord{asr, tts} {
		stored := svc.modelByID(model.GetLocalAssetId())
		if stored == nil {
			t.Fatalf("missing refreshed speech asset %q", model.GetAssetId())
		}
		if stored.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_ACTIVE {
			t.Fatalf("speech asset %q status = %s detail=%q", model.GetAssetId(), stored.GetStatus(), stored.GetHealthDetail())
		}
		if stored.GetWarmState() != runtimev1.LocalWarmState_LOCAL_WARM_STATE_COLD {
			t.Fatalf("speech asset %q warm_state = %s", model.GetAssetId(), stored.GetWarmState())
		}
	}
}

type capturingLocalProviderEndpointSink struct {
	providerID string
	endpoint   string
	apiKey     string
}

func (s *capturingLocalProviderEndpointSink) SetLocalProviderEndpoint(providerID string, endpoint string, apiKey string) {
	s.providerID = providerID
	s.endpoint = endpoint
	s.apiKey = apiKey
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
