package localservice

import (
	"context"
	"path/filepath"
	"runtime"
	"strings"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestConfiguredManagedMediaEngineConfigUsesExactCurrentProfileConsumption(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	if _, err := svc.configuredManagedMediaEngineConfig(18321, engine.MediaModePipelineSupervised, nil, managedMediaImageProfileConsumerBase); err == nil ||
		!strings.Contains(err.Error(), "no selected source consumption projection") {
		t.Fatalf("missing media dependency profile error = %v", err)
	}

	consumer, identity := currentMediaDependencyProfileIdentityForTest(t, managedMediaImageProfileConsumerBase)
	root := filepath.Join(svc.localEnvironmentRuntimeDataRoot(), "environments", "python-profiles", identity.ProfileDigest)
	driver := filepath.Join(root, "media_server.py")
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     identity.DependencyID,
		EnvironmentKey: localEnvironmentPythonProfileKey(
			localEnvironmentFamilyPythonPackageSet,
			identity.DependencyID,
			svc.localEnvironmentRuntimeDataRoot(),
		),
		SourceKind:    localEnvironmentSourceManaged,
		CanonicalRoot: root,
		Version:       identity.ProfileDigest,
		Hashes:        pythonDependencyProfileHashes(identity),
		SelectedConsumers: []string{
			consumer,
		},
		VerifiedArtifacts: []string{mediaProfileInterpreterPathForTest(root), driver},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	writePythonDependencyProfileStaticFilesForTest(t, root, consumer, identity)
	promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, promoted, consumer)

	selection := &engine.ImageSupervisedMatrixSelection{EntryID: "test-selection-projection"}
	cfg, err := svc.configuredManagedMediaEngineConfig(18321, engine.MediaModePipelineSupervised, selection, managedMediaImageProfileConsumerBase)
	if err != nil {
		t.Fatalf("configured media Host: %v", err)
	}
	if cfg.MediaHostPackageSetRoot != root {
		t.Fatalf("media package-set root = %q, want %q", cfg.MediaHostPackageSetRoot, root)
	}
	wantPlane := strings.TrimPrefix(consumer, managedMediaImageProfileConsumerBase+".")
	if cfg.MediaHostAcceleratorPlane != wantPlane {
		t.Fatalf("media host accelerator plane = %q, want %q", cfg.MediaHostAcceleratorPlane, wantPlane)
	}
	if cfg.Port != 18321 || cfg.MediaMode != engine.MediaModePipelineSupervised || cfg.ImageSupervisedSelection != selection {
		t.Fatalf("configured media Host lost caller-owned selection: %+v", cfg)
	}
}

func TestConfiguredManagedMediaEngineConfigRejectsStaleProfileConsumption(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	consumer, identity := currentMediaDependencyProfileIdentityForTest(t, managedMediaImageProfileConsumerBase)
	root := filepath.Join(svc.localEnvironmentRuntimeDataRoot(), "environments", "python-profiles", identity.ProfileDigest)
	hashes := pythonDependencyProfileHashes(identity)
	hashes["profile_digest"] = "stale"
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     identity.DependencyID,
		EnvironmentKey: localEnvironmentPythonProfileKey(
			localEnvironmentFamilyPythonPackageSet,
			identity.DependencyID,
			svc.localEnvironmentRuntimeDataRoot(),
		),
		SourceKind:    localEnvironmentSourceManaged,
		CanonicalRoot: root,
		Version:       identity.ProfileDigest,
		Hashes:        hashes,
		SelectedConsumers: []string{
			consumer,
		},
		VerifiedArtifacts: []string{mediaProfileInterpreterPathForTest(root), filepath.Join(root, "media_server.py")},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	writePythonDependencyProfileStaticFilesForTest(t, root, consumer, identity)
	promoted := svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, promoted, consumer)

	if _, err := svc.configuredManagedMediaEngineConfig(18321, engine.MediaModePipelineSupervised, nil, managedMediaImageProfileConsumerBase); err == nil ||
		!strings.Contains(err.Error(), "stale profile_digest") {
		t.Fatalf("stale media dependency profile error = %v", err)
	}
}

func TestVideoMediaBootstrapUsesExactVideoProfileAndHostDerivedPlane(t *testing.T) {
	setLocalRuntimePlatformForTest(t, "windows", "amd64")
	setNvidiaGPUProbeForTest(t, true)
	svc := newLocalEnvironmentTestService(t)
	defer func() { svc.Close() }()

	consumer, identity := currentMediaDependencyProfileIdentityForTest(t, managedMediaVideoProfileConsumerBase)
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

	if _, err := svc.configuredManagedMediaEngineConfig(18321, engine.MediaModePipelineSupervised, nil, managedMediaImageProfileConsumerBase); err == nil ||
		!strings.Contains(err.Error(), "no selected source consumption projection") {
		t.Fatalf("video-only profile consumption must not authorize image composition, got %v", err)
	}

	mgr := &mockEngineManager{}
	svc.SetEngineManager(mgr)
	model := &runtimev1.LocalAssetRecord{
		LocalAssetId: "video-local-id",
		AssetId:      "local/wan-video",
		Engine:       "media",
		Kind:         runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_VIDEO,
		Capabilities: []string{"video.generate"},
	}
	svc.mu.Lock()
	svc.assets[model.GetLocalAssetId()] = cloneLocalAsset(model)
	svc.mu.Unlock()
	if err := svc.bootstrapLocalModelIfManaged(context.Background(), model); err != nil {
		t.Fatalf("bootstrap configured video media Host: %v", err)
	}
	if mgr.startCalls != 0 || mgr.startConfigCalls != 1 {
		t.Fatalf("video media bootstrap used wrong engine entry: plain=%d configured=%d", mgr.startCalls, mgr.startConfigCalls)
	}
	wantPlane := strings.TrimPrefix(consumer, managedMediaVideoProfileConsumerBase+".")
	if mgr.lastStartConfig.MediaHostPackageSetRoot != root || mgr.lastStartConfig.MediaHostAcceleratorPlane != wantPlane {
		t.Fatalf("video media bootstrap lost exact profile composition: %+v", mgr.lastStartConfig)
	}
	if mgr.lastStartConfig.MediaMode != engine.MediaModePipelineSupervised || mgr.lastStartConfig.ImageSupervisedSelection != nil {
		t.Fatalf("video media bootstrap changed pipeline topology: %+v", mgr.lastStartConfig)
	}
}

func mediaProfileInterpreterPathForTest(root string) string {
	if runtime.GOOS == "windows" {
		return filepath.Join(root, "Scripts", "python.exe")
	}
	return filepath.Join(root, "bin", "python")
}

func currentMediaDependencyProfileIdentityForTest(t *testing.T, consumerBase string) (string, engine.PythonDependencyProfileIdentity) {
	t.Helper()
	hostState := localEnvironmentHostProfileFromDeviceProfile(hostProfileOrCollected(nil))
	plane := "cpu"
	if localEnvironmentHostSupportsCUDA(hostState) {
		plane = "cuda"
	}
	consumer := strings.TrimSpace(consumerBase) + "." + plane
	identity, err := engine.ResolvePythonDependencyProfileIdentity(consumer, localEnvironmentPlatformTuple(hostState), plane)
	if err != nil {
		t.Fatalf("resolve current media dependency profile: %v", err)
	}
	return consumer, identity
}
