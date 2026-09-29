package localservice

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func checkSyncFixedDependencyFixtures(t *testing.T, root string) ([]localEnvironmentSelectedSourceRecordState, []engine.ManagedEnvironmentCheckResult) {
	t.Helper()
	codecRoot := filepath.Join(root, "dependencies", "media-codec", "fixture-codec")
	codec := engine.MediaCodecDependencyStatus{Version: "fixture-version", CanonicalRoot: codecRoot,
		VerifiedArtifacts: []string{filepath.Join(codecRoot, "ffmpeg.exe"), filepath.Join(codecRoot, "ffprobe.exe")}, Hashes: map[string]string{"ffmpeg.exe": "fixture-hash", "ffprobe.exe": "fixture-hash"}}
	sdRoot := filepath.Join(root, "environments", "managed-image-backends", "fixture-sd")
	sd := engine.ManagedImageBackendDependencyStatus{BackendName: "stablediffusion-ggml", PackageSource: "canonical_runtime_wrapper", PackageFormat: "direct_archive", LaunchMode: "runtime_wrapper",
		ReleaseTag: "fixture-release", SourceCommit: strings.Repeat("a", 40), ArchiveURL: "https://example.invalid/sd.zip", ArchiveSHA256: strings.Repeat("b", 64), CanonicalRoot: sdRoot, VerifiedArtifacts: []string{filepath.Join(sdRoot, "sd.exe")}}
	consumer := engine.TextDecisionConsumerID + ".cuda"
	wheel, err := engine.ResolvePythonTorchWheelDependencyIdentity(consumer)
	if err != nil {
		t.Fatal(err)
	}
	profile, err := engine.ResolvePythonDependencyProfileIdentity(engine.TextDecisionConsumerID, "windows/amd64", "cuda")
	if err != nil {
		t.Fatal(err)
	}
	cache := filepath.Join(root, "dependencies", "python-package-cache")
	records := []localEnvironmentSelectedSourceRecordState{
		{RecordID: "codec", DependencyFamily: localEnvironmentFamilyMediaCodec, DependencyID: engine.MediaCodecDependencyID, Version: codec.Version, CanonicalRoot: codecRoot,
			EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyMediaCodec, engine.MediaCodecDependencyID, "", "windows/amd64", root), VerifiedArtifacts: codec.VerifiedArtifacts, Hashes: codec.Hashes, SelectedConsumers: []string{"media-codec"}, CompatibilityEvidence: []string{"ffmpeg_ffprobe_verified"}},
		{RecordID: "sd", DependencyFamily: localEnvironmentFamilyNativeSDCPP, DependencyID: "stable-diffusion.cpp.package", Version: sd.ReleaseTag, CanonicalRoot: sdRoot,
			EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyNativeSDCPP, "stable-diffusion.cpp.package", "", "windows/amd64", root), VerifiedArtifacts: sd.VerifiedArtifacts, Hashes: map[string]string{"archive_sha256": sd.ArchiveSHA256}, SelectedConsumers: []string{"stable-diffusion.cpp.cuda"}, CompatibilityEvidence: []string{"package_source=canonical_runtime_wrapper"}},
		{RecordID: "torch", DependencyFamily: localEnvironmentFamilyPythonTorchWheel, DependencyID: localEnvironmentPythonTorchWheelDependencyID(wheel), Version: wheel.TorchVersion, CanonicalRoot: cache,
			EnvironmentKey: localEnvironmentPythonTorchWheelKey(wheel, "windows/amd64", root), VerifiedArtifacts: []string{cache}, Hashes: map[string]string{"wheel_lock_hash": wheel.WheelLockHash}, SelectedConsumers: []string{consumer},
			CompatibilityEvidence: []string{"wheel_index=" + strings.TrimPrefix(profile.PackageSource, "pypi=https://pypi.org/simple;pytorch="), "accelerator_plane=cuda", "cuda_abi=" + wheel.CUDAABI, "torch_version=" + wheel.TorchVersion, "import_probe=torch"}},
	}
	for i := range records {
		records[i].SourceKind = localEnvironmentSourceManaged
		records[i] = verifiedSelectedSourceRecordForTest(records[i])
		records[i].LastVerifiedAt = nowISO()
		if records[i].DependencyFamily == localEnvironmentFamilyPythonTorchWheel {
			records[i].SelectedConsumers = nil
		}
	}
	return records, []engine.ManagedEnvironmentCheckResult{
		{Kind: "media_codec", Reference: engine.MediaCodecDependencyID + "/" + codec.Version, Locator: "dependencies/media-codec/fixture-codec", Status: "unavailable", Reason: "MEDIA_CODEC_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", MediaCodec: &codec},
		{Kind: "managed_image_package", Reference: sd.BackendName + "/" + sd.ReleaseTag, Locator: "environments/managed-image-backends/fixture-sd", Status: "unavailable", Reason: "MANAGED_IMAGE_PACKAGE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", ImageBackend: &sd},
		{Kind: "python_profile", Reference: profile.ProfileDigest, Locator: "environments/python-profiles/" + profile.ProfileDigest, Status: "unavailable", Reason: "PYTHON_PROFILE_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED", PythonProfile: &engine.PythonDependencyProfileManifest{ValidationConsumer: engine.TextDecisionConsumerID, Identity: profile}},
	}
}

func TestProductControlCheckSyncPreservesVerifiedFixedDependenciesAcrossRepeatAndRestart(t *testing.T) {
	formerRoot := filepath.Join(t.TempDir(), "former")
	records, _ := checkSyncFixedDependencyFixtures(t, formerRoot)
	statePath := filepath.Join(formerRoot, "accounts", "runtime", "local-state.json")
	s, err := NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, filepath.Join(formerRoot, "models"), formerRoot)
	if err != nil {
		t.Fatal(err)
	}
	for _, record := range records {
		if record.DependencyFamily == localEnvironmentFamilyPythonTorchWheel {
			if err := os.MkdirAll(record.CanonicalRoot, 0755); err != nil {
				t.Fatal(err)
			}
		} else {
			writeSelectedSourceLocalArtifactsForTest(t, record)
		}
		s.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)] = record
	}
	s.mu.Lock()
	err = s.persistStateLocked()
	s.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	root := filepath.Join(t.TempDir(), "current")
	if err := os.CopyFS(root, os.DirFS(formerRoot)); err != nil {
		t.Fatal(err)
	}
	_, material := checkSyncFixedDependencyFixtures(t, root)
	for cycle := 0; cycle < 2; cycle++ {
		s, err = NewWithProductControlDataRoot(slog.Default(), nil, filepath.Join(root, "accounts", "runtime", "local-state.json"), 10, filepath.Join(root, "models"), root)
		if err != nil {
			t.Fatal(err)
		}
		s.SetEngineManager(&checkSyncCUDAEngineManager{mockEngineManager: &mockEngineManager{}, material: material})
		for repeat := 0; repeat < 2; repeat++ {
			result := s.reconcileProductControlCheckSyncEnvironments(context.Background(), ProductControlCheckSyncInput{DataRoot: root, RootActivationID: "rootact_test"})
			for _, record := range records {
				available := false
				for _, row := range result.Resources {
					available = available || row.Reference != nil && *row.Reference == record.RecordID && row.Status == "available"
				}
				if !available {
					t.Fatalf("cycle %d repeat %d: %s demoted: %+v", cycle, repeat, record.RecordID, result.Resources)
				}
			}
		}
		s.Close()
	}
}

func TestProductControlCheckSyncFixedDependenciesRejectMismatchedCustody(t *testing.T) {
	root := t.TempDir()
	records, material := checkSyncFixedDependencyFixtures(t, root)
	for _, record := range records {
		t.Run(record.RecordID, func(t *testing.T) {
			if !productControlCheckSyncEnvironmentMaterialSupportsRecord(record, material, nil, root) {
				t.Fatal("matching owner evidence rejected")
			}
			for name, mutate := range map[string]func(*localEnvironmentSelectedSourceRecordState){
				"root":    func(r *localEnvironmentSelectedSourceRecordState) { r.CanonicalRoot = filepath.Join(root, "foreign") },
				"version": func(r *localEnvironmentSelectedSourceRecordState) { r.Version = "wrong" },
				"hash": func(r *localEnvironmentSelectedSourceRecordState) {
					for k := range r.Hashes {
						r.Hashes[k] = "wrong"
					}
				},
				"artifact": func(r *localEnvironmentSelectedSourceRecordState) {
					r.VerifiedArtifacts = []string{filepath.Join(root, "foreign")}
				},
				"source": func(r *localEnvironmentSelectedSourceRecordState) { r.SourceKind = localEnvironmentSourceImported },
			} {
				t.Run(name, func(t *testing.T) {
					altered := record
					altered.Hashes = cloneStringMap(record.Hashes)
					mutate(&altered)
					if productControlCheckSyncEnvironmentMaterialSupportsRecord(altered, material, nil, root) {
						t.Fatal("mismatched selected source promoted")
					}
				})
			}
			if productControlCheckSyncEnvironmentMaterialSupportsRecord(record, nil, nil, root) {
				t.Fatal("absence of owner verification promoted")
			}
			failed := append([]engine.ManagedEnvironmentCheckResult(nil), material...)
			for i := range failed {
				failed[i].Reason = "OWNER_VERIFICATION_FAILED"
			}
			if productControlCheckSyncEnvironmentMaterialSupportsRecord(record, failed, nil, root) {
				t.Fatal("failed/static-only evidence promoted")
			}
			duplicated := append(append([]engine.ManagedEnvironmentCheckResult(nil), material...), material...)
			if productControlCheckSyncEnvironmentMaterialSupportsRecord(record, duplicated, nil, root) {
				t.Fatal("ambiguous evidence promoted")
			}
		})
	}
}
