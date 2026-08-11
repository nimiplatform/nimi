package localservice

import (
	"context"
	"path/filepath"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestSpeechExecutionHostReusesOnlyExactActivatedProfileIdentity(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	consumer := "speech.qwen3-tts.python"
	root := currentSpeechDependencyProfileRootForTest(t, svc, consumer)
	upsertVerifiedSpeechPackageSetForTest(
		t,
		svc,
		consumer,
		root,
		"NIMI_RUNTIME_SPEECH_QWEN3_TTS_CMD",
		engine.SpeechQwen3TTSDriverPath,
	)
	cfg, err := svc.configuredManagedSpeechEngineConfigForCapability(
		capabilitydriver.AudioSynthesizeContract,
		capabilitydriver.Qwen3TTSDriverID,
		18330,
	)
	if err != nil {
		t.Fatalf("configure speech Host: %v", err)
	}
	if !strings.Contains(cfg.ExecutionHostIdentity, "profile_root=") ||
		!strings.Contains(cfg.ExecutionHostIdentity, "profile_digest="+filepath.Base(root)) ||
		!strings.Contains(cfg.ExecutionHostIdentity, "accelerator_plane="+cfg.SpeechHostAcceleratorPlane) ||
		!strings.Contains(cfg.ExecutionHostIdentity, "driver=speech:"+capabilitydriver.AudioSynthesizeContract+":"+capabilitydriver.Qwen3TTSDriverID) {
		t.Fatalf("speech Host identity is incomplete: %q", cfg.ExecutionHostIdentity)
	}

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:                "speech",
		Status:                "healthy",
		Port:                  cfg.Port,
		PID:                   991,
		ExecutionHostIdentity: cfg.ExecutionHostIdentity,
	}}
	svc.SetEngineManager(mgr)
	if _, err := svc.MaterializeSpeechExecutionHost(
		context.Background(),
		capabilitydriver.AudioSynthesizeContract,
		capabilitydriver.Qwen3TTSDriverID,
		cfg.Port,
	); err != nil {
		t.Fatalf("reuse exact speech Host: %v", err)
	}
	if mgr.stopCalls != 0 || mgr.startConfigCalls != 0 {
		t.Fatalf("exact speech Host was replaced: stop=%d start=%d", mgr.stopCalls, mgr.startConfigCalls)
	}

	stale := cfg
	stale.SpeechHostPackageSetRoot = filepath.Join(filepath.Dir(root), "stale-profile-digest")
	mgr.status.ExecutionHostIdentity = speechExecutionHostIdentity(
		capabilitydriver.AudioSynthesizeContract,
		capabilitydriver.Qwen3TTSDriverID,
		stale,
	)
	if _, err := svc.MaterializeSpeechExecutionHost(
		context.Background(),
		capabilitydriver.AudioSynthesizeContract,
		capabilitydriver.Qwen3TTSDriverID,
		cfg.Port,
	); err != nil {
		t.Fatalf("replace stale-profile speech Host: %v", err)
	}
	if mgr.stopCalls != 1 || mgr.startConfigCalls != 1 {
		t.Fatalf("stale-profile speech Host lifecycle = stop %d start %d, want 1/1", mgr.stopCalls, mgr.startConfigCalls)
	}
	if mgr.lastStartConfig.ExecutionHostIdentity != cfg.ExecutionHostIdentity {
		t.Fatalf("replacement speech Host identity = %q, want %q", mgr.lastStartConfig.ExecutionHostIdentity, cfg.ExecutionHostIdentity)
	}
}

func TestMediaExecutionHostReusesOnlyExactActivatedProfileIdentity(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	consumer, identity := currentMediaDependencyProfileIdentityForTest(t, managedMediaImageProfileConsumerBase)
	root := filepath.Join(svc.localEnvironmentRuntimeDataRoot(), "environments", "python-profiles", identity.ProfileDigest)
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     identity.DependencyID,
		EnvironmentKey: localEnvironmentPythonProfileKey(
			localEnvironmentFamilyPythonPackageSet,
			identity.DependencyID,
			svc.localEnvironmentRuntimeDataRoot(),
		),
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     root,
		Version:           identity.ProfileDigest,
		Hashes:            pythonDependencyProfileHashes(identity),
		SelectedConsumers: []string{consumer},
		VerifiedArtifacts: []string{mediaProfileInterpreterPathForTest(root), filepath.Join(root, "media_server.py")},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	writePythonDependencyProfileStaticFilesForTest(t, root, consumer, identity)
	promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, promoted, consumer)

	selection := engine.ImageSupervisedMatrixSelection{
		Matched:        true,
		EntryID:        "windows-python-pipeline",
		ProductState:   engine.ImageProductStateSupported,
		BackendClass:   engine.ImageBackendClassPythonPipeline,
		ControlPlane:   engine.ImageControlPlaneRuntime,
		ExecutionPlane: engine.EngineMedia,
		Entry: &engine.ImageSupervisedMatrixEntry{
			EntryID:        "windows-python-pipeline",
			ProductState:   engine.ImageProductStateSupported,
			BackendClass:   engine.ImageBackendClassPythonPipeline,
			ControlPlane:   engine.ImageControlPlaneRuntime,
			ExecutionPlane: engine.EngineMedia,
		},
	}
	cfg, err := svc.configuredManagedMediaEngineConfig(8321, engine.MediaModePipelineSupervised, &selection, managedMediaImageProfileConsumerBase)
	if err != nil {
		t.Fatalf("configure media Host: %v", err)
	}
	if !strings.Contains(cfg.ExecutionHostIdentity, "profile_digest="+identity.ProfileDigest) ||
		!strings.Contains(cfg.ExecutionHostIdentity, "accelerator_plane="+cfg.MediaHostAcceleratorPlane) ||
		!strings.Contains(cfg.ExecutionHostIdentity, "driver=media:media_server.py:"+string(cfg.MediaMode)) {
		t.Fatalf("media Host identity is incomplete: %q", cfg.ExecutionHostIdentity)
	}

	mgr := &mockEngineManager{status: &EngineInfo{
		Engine:                "media",
		Status:                "healthy",
		Port:                  cfg.Port,
		PID:                   992,
		ExecutionHostIdentity: cfg.ExecutionHostIdentity,
	}}
	svc.SetEngineManager(mgr)
	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "image-local-id",
		AssetId:      "local/image",
		Engine:       "media",
		Capabilities: []string{"image.generate"},
	}
	if err := svc.bootstrapSelectionAwareManagedMediaEngine(context.Background(), model, selection); err != nil {
		t.Fatalf("reuse exact media Host: %v", err)
	}
	if mgr.stopCalls != 0 || mgr.startConfigCalls != 0 {
		t.Fatalf("exact media Host was replaced: stop=%d start=%d", mgr.stopCalls, mgr.startConfigCalls)
	}

	stale := cfg
	stale.MediaHostPackageSetRoot = filepath.Join(filepath.Dir(root), "stale-profile-digest")
	mgr.status.ExecutionHostIdentity = mediaExecutionHostIdentity(stale)
	if err := svc.bootstrapSelectionAwareManagedMediaEngine(context.Background(), model, selection); err != nil {
		t.Fatalf("replace stale-profile media Host: %v", err)
	}
	if mgr.stopCalls != 1 || mgr.startConfigCalls != 1 {
		t.Fatalf("stale-profile media Host lifecycle = stop %d start %d, want 1/1", mgr.stopCalls, mgr.startConfigCalls)
	}
	if mgr.lastStartConfig.ExecutionHostIdentity != cfg.ExecutionHostIdentity {
		t.Fatalf("replacement media Host identity = %q, want %q", mgr.lastStartConfig.ExecutionHostIdentity, cfg.ExecutionHostIdentity)
	}
}
