package localservice

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestSelectedSpeechPackageSetSourceRequiresCurrentProfileConsumptionEvidence(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	root := currentSpeechDependencyProfileRootForTest(t, svc, "speech.qwen3-tts.python")
	staleRoot := filepath.Join(t.TempDir(), "profiles", "stale")
	consumer := "speech.qwen3-tts.python"
	envKey := "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
	driverScript := engine.SpeechQwen3TTSDriverPath(root)

	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "python-profile.stale",
		EnvironmentKey:   localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, "python-profile.stale", svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    staleRoot,
		SelectedConsumers: []string{
			consumer,
		},
		VerifiedArtifacts: []string{
			filepath.Join(staleRoot, "bin", "python"),
		},
	}))
	upsertVerifiedSpeechPackageSetForTest(t, svc, consumer, root, envKey, engine.SpeechQwen3TTSDriverPath)

	record, identity, ok, detail := svc.selectedSpeechPackageSetSourceForConsumer(consumer, envKey, engine.SpeechQwen3TTSDriverPath)
	if !ok {
		t.Fatalf("expected valid current speech dependency profile, got detail=%q", detail)
	}
	if record.DependencyID != identity.DependencyID {
		t.Fatalf("selected dependency id = %q, want current profile %q", record.DependencyID, identity.DependencyID)
	}
	if record.CanonicalRoot != root || !stringSliceContains(record.VerifiedArtifacts, driverScript) {
		t.Fatalf("selected consumption projection = root %q artifacts %v, want root %q with driver", record.CanonicalRoot, record.VerifiedArtifacts, root)
	}
}

func TestMaterializeSpeechExecutionHostUsesOnlyExactCapabilityPackageSet(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	ttsRoot := currentSpeechDependencyProfileRootForTest(t, svc, "speech.qwen3-tts.python")
	asrRoot := currentSpeechDependencyProfileRootForTest(t, svc, "speech.qwen3-asr.python")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-tts.python", ttsRoot, "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD", engine.SpeechQwen3TTSDriverPath)
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr.python", asrRoot, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_CMD", engine.SpeechQwen3ASRDriverPath)

	endpoint, err := svc.MaterializeSpeechExecutionHost(context.Background(), capabilitydriver.AudioTranscribeContract, capabilitydriver.Qwen3ASRDriverID, 18330)
	if err != nil {
		t.Fatalf("materialize transcription Host: %v", err)
	}
	if endpoint != "http://127.0.0.1:18330" {
		t.Fatalf("transcription Host endpoint = %q", endpoint)
	}
	if mgr.startConfigCalls != 1 {
		t.Fatalf("configured speech start calls = %d, want 1", mgr.startConfigCalls)
	}
	cfg := mgr.lastStartConfig
	if cfg.SpeechHostPackageSetRoot != asrRoot || cfg.SpeechQwen3ASRPackageSetRoot != asrRoot {
		t.Fatalf("transcription roots = host %q asr %q, want %q", cfg.SpeechHostPackageSetRoot, cfg.SpeechQwen3ASRPackageSetRoot, asrRoot)
	}
	if cfg.SpeechQwen3TTSPackageSetRoot != "" {
		t.Fatalf("transcription Host prefetched qwen3_tts root %q", cfg.SpeechQwen3TTSPackageSetRoot)
	}
	if want := pythonDependencyProfileIdentityForConsumerTest(t, "speech.qwen3-asr.python").AcceleratorPlane; cfg.SpeechHostAcceleratorPlane != want {
		t.Fatalf("transcription Host accelerator plane = %q, want verified %q", cfg.SpeechHostAcceleratorPlane, want)
	}
}

func TestStopSpeechExecutionHostStopsExactManagedEngine(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	if err := svc.StopSpeechExecutionHost(); err != nil {
		t.Fatalf("stop speech ExecutionHost: %v", err)
	}
	if mgr.stopCalls != 1 || len(mgr.stopEngines) != 1 || mgr.stopEngines[0] != "speech" {
		t.Fatalf("stop calls=%d engines=%v, want one exact speech stop", mgr.stopCalls, mgr.stopEngines)
	}
}

func TestStopSpeechExecutionHostIsIdempotentWhenManagedHostIsAbsent(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	root := t.TempDir()
	mgr, err := engine.NewManager(nil, engine.ManagedRoots{
		Environments: filepath.Join(root, "environments"),
		Dependencies: filepath.Join(root, "dependencies"),
	}, nil)
	if err != nil {
		t.Fatalf("create real engine Manager: %v", err)
	}
	svc.SetEngineManager(engine.NewServiceAdapter(mgr))

	if err := svc.StopSpeechExecutionHost(); err != nil {
		t.Fatalf("idempotent absent speech ExecutionHost stop: %v", err)
	}
}

func TestMaterializeSpeechExecutionHostSelectsTransformersNativeASRPackageSet(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	root := currentSpeechDependencyProfileRootForTest(t, svc, "speech.qwen3-asr-transformers.python")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr-transformers.python", root, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD", engine.SpeechQwen3ASRTransformersDriverPath)

	endpoint, err := svc.MaterializeSpeechExecutionHost(context.Background(), capabilitydriver.AudioTranscribeContract, capabilitydriver.Qwen3ASRTransformersDriverID, 18331)
	if err != nil {
		t.Fatalf("materialize Transformers-native transcription Host: %v", err)
	}
	if endpoint != "http://127.0.0.1:18331" {
		t.Fatalf("transcription Host endpoint = %q", endpoint)
	}
	cfg := mgr.lastStartConfig
	if cfg.SpeechHostPackageSetRoot != root || cfg.SpeechQwen3ASRTransformersPackageSetRoot != root {
		t.Fatalf("Transformers transcription roots = host %q driver %q, want %q", cfg.SpeechHostPackageSetRoot, cfg.SpeechQwen3ASRTransformersPackageSetRoot, root)
	}
	if cfg.SpeechQwen3ASRPackageSetRoot != "" || cfg.SpeechQwen3TTSPackageSetRoot != "" {
		t.Fatalf("Transformers transcription Host populated sibling roots: %+v", cfg)
	}
	if want := pythonDependencyProfileIdentityForConsumerTest(t, "speech.qwen3-asr-transformers.python").AcceleratorPlane; cfg.SpeechHostAcceleratorPlane != want {
		t.Fatalf("Transformers transcription Host accelerator plane = %q, want verified %q", cfg.SpeechHostAcceleratorPlane, want)
	}
}

func TestSelectedSpeechPackageSetSourceRejectsStaleOrNonManagedProfileConsumption(t *testing.T) {
	tests := []struct {
		name       string
		wantDetail string
		mutate     func(t *testing.T, record *localEnvironmentSelectedSourceRecordState, root string)
	}{
		{
			name:       "non-managed source",
			wantDetail: "not Runtime-managed",
			mutate: func(_ *testing.T, record *localEnvironmentSelectedSourceRecordState, _ string) {
				record.SourceKind = localEnvironmentSourceSystem
			},
		},
		{
			name:       "stale profile identity",
			wantDetail: "stale profile identity",
			mutate: func(_ *testing.T, record *localEnvironmentSelectedSourceRecordState, _ string) {
				record.Version = "stale-profile"
			},
		},
		{
			name:       "stale profile hash",
			wantDetail: "stale profile_digest",
			mutate: func(_ *testing.T, record *localEnvironmentSelectedSourceRecordState, _ string) {
				record.Hashes["profile_digest"] = "stale-profile"
			},
		},
		{
			name:       "non-canonical profile root",
			wantDetail: "non-canonical profile root",
			mutate: func(_ *testing.T, record *localEnvironmentSelectedSourceRecordState, root string) {
				record.CanonicalRoot = filepath.Join(filepath.Dir(root), "other-profile")
			},
		},
		{
			name:       "static Driver drift",
			wantDetail: "static content drift",
			mutate: func(t *testing.T, _ *localEnvironmentSelectedSourceRecordState, root string) {
				driver := engine.SpeechQwen3TTSDriverPath(root)
				if err := os.Chmod(driver, 0o600); err != nil {
					t.Fatalf("make speech Driver writable: %v", err)
				}
				if err := os.WriteFile(driver, []byte("print('drifted')\n"), 0o600); err != nil {
					t.Fatalf("drift speech Driver: %v", err)
				}
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			svc := newLocalEnvironmentTestService(t)
			defer func() { svc.Close() }()
			consumer := "speech.qwen3-tts.python"
			envKey := "NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD"
			root := currentSpeechDependencyProfileRootForTest(t, svc, consumer)
			record := verifiedSpeechPackageSetRecordForTest(t, svc, consumer, root, envKey, engine.SpeechQwen3TTSDriverPath)
			test.mutate(t, &record, root)
			promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
			recordReadyPythonPackageSetConsumptionJobForTest(svc, promoted, consumer)

			_, _, ok, detail := svc.selectedSpeechPackageSetSourceForConsumer(consumer, envKey, engine.SpeechQwen3TTSDriverPath)
			if ok || !strings.Contains(detail, test.wantDetail) {
				t.Fatalf("stale speech profile accepted=%v detail=%q, want %q", ok, detail, test.wantDetail)
			}
		})
	}
}

func TestMaterializeSpeechExecutionHostSelectsTransformersNativeASRPackageSet(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()
	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)

	root := filepath.Join(t.TempDir(), "speech", "qwen3-asr-transformers")
	upsertVerifiedSpeechPackageSetForTest(t, svc, "speech.qwen3-asr-transformers.python", "local-speech-qwen3-asr-transformers.package-set", root, "NIMI_RUNTIME_SPEECH_QWEN3_ASR_TRANSFORMERS_CMD", engine.SpeechQwen3ASRTransformersDriverPath)

	endpoint, err := svc.MaterializeSpeechExecutionHost(context.Background(), capabilitydriver.AudioTranscribeContract, capabilitydriver.Qwen3ASRTransformersDriverID, 18331)
	if err != nil {
		t.Fatalf("materialize Transformers-native transcription Host: %v", err)
	}
	if endpoint != "http://127.0.0.1:18331" {
		t.Fatalf("transcription Host endpoint = %q", endpoint)
	}
	cfg := mgr.lastStartConfig
	if cfg.SpeechHostPackageSetRoot != root || cfg.SpeechQwen3ASRTransformersPackageSetRoot != root {
		t.Fatalf("Transformers transcription roots = host %q driver %q, want %q", cfg.SpeechHostPackageSetRoot, cfg.SpeechQwen3ASRTransformersPackageSetRoot, root)
	}
	if cfg.SpeechQwen3ASRPackageSetRoot != "" || cfg.SpeechQwen3TTSPackageSetRoot != "" {
		t.Fatalf("Transformers transcription Host populated sibling roots: %+v", cfg)
	}
}

func upsertVerifiedSpeechPackageSetForTest(
	t *testing.T,
	svc *Service,
	consumer string,
	root string,
	envKey string,
	driverPath func(string) string,
) {
	t.Helper()
	record := verifiedSpeechPackageSetRecordForTest(t, svc, consumer, root, envKey, driverPath)
	promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, promoted, consumer)
}

func verifiedSpeechPackageSetRecordForTest(
	t *testing.T,
	svc *Service,
	consumer string,
	root string,
	envKey string,
	driverPath func(string) string,
) localEnvironmentSelectedSourceRecordState {
	t.Helper()
	identity := pythonDependencyProfileIdentityForConsumerTest(t, consumer)
	driverScript := driverPath(root)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     identity.DependencyID,
		EnvironmentKey:   localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, identity.DependencyID, svc.localEnvironmentRuntimeDataRoot()),
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    root,
		Version:          identity.ProfileDigest,
		Hashes:           pythonDependencyProfileHashes(identity),
		VerifiedArtifacts: []string{
			filepath.Join(root, "bin", "python"),
			driverScript,
		},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	writePythonDependencyProfileStaticFilesForTest(t, root, consumer, identity)
	return record
}

func currentSpeechDependencyProfileRootForTest(t *testing.T, svc *Service, consumer string) string {
	t.Helper()
	identity := pythonDependencyProfileIdentityForConsumerTest(t, consumer)
	return filepath.Join(svc.localEnvironmentRuntimeDataRoot(), "environments", "python-profiles", identity.ProfileDigest)
}

func pythonDependencyProfileIdentityForConsumerTest(t *testing.T, consumer string) engine.PythonDependencyProfileIdentity {
	t.Helper()
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	acceleratorPlane := "cpu"
	if localEnvironmentHostSupportsCUDA(hostState) {
		acceleratorPlane = "cuda"
	}
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, localEnvironmentPlatformTuple(hostState), acceleratorPlane)
	if err != nil {
		t.Fatalf("resolve Python dependency profile for %s: %v", consumer, err)
	}
	return identity
}
