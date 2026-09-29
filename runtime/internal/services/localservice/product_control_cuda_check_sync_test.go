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

type checkSyncCUDAEngineManager struct {
	*mockEngineManager
	statuses map[string]engine.SharedAcceleratorDependencyStatus
	material []engine.ManagedEnvironmentCheckResult
}

func (m *checkSyncCUDAEngineManager) ResolveSharedAcceleratorDependency(dependencyID string, _ string) engine.SharedAcceleratorDependencyStatus {
	return m.statuses[dependencyID]
}

func (m *checkSyncCUDAEngineManager) CheckSyncManagedEnvironment(context.Context, string) []engine.ManagedEnvironmentCheckResult {
	return m.material
}

func checkSyncCUDAFixture(root string, dependencyID string, version string, artifacts []string) (localEnvironmentSelectedSourceRecordState, engine.SharedAcceleratorDependencyStatus, engine.ManagedEnvironmentCheckResult) {
	canonicalRoot := filepath.Join(root, "dependencies", "accelerator-dependencies", dependencyID)
	detail := "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed"
	status := engine.SharedAcceleratorDependencyStatus{
		DependencyID: dependencyID, Version: version, HostProfileID: "windows-amd64-nvidia-cuda",
		State: engine.SharedAcceleratorDependencyReadyManaged, Source: "runtime_managed",
		CanonicalRoot: canonicalRoot, RequiredArtifacts: artifacts, Detail: detail,
	}
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		RecordID: "selected-" + dependencyID, DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyID: dependencyID, Version: version, SourceKind: localEnvironmentSourceManaged,
		EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyCUDA, dependencyID, status.HostProfileID, "windows/amd64", root),
		CanonicalRoot:  canonicalRoot, VerifiedArtifacts: artifacts,
		CompatibilityEvidence:   []string{detail},
		Hashes:                  map[string]string{"required_artifact_set": shortHash(strings.Join(normalizeStringSlice(artifacts), "|"))},
		SelectedConsumers:       []string{"llama.cpp.cuda"},
		SourceManifestRef:       "managed-cuda-runtime-source#fixture",
		VerificationEvidenceRef: "accelerator-cuda-runtime-evidence#fixture",
		AuditReasonCode:         "CHECK_SYNC_OWNER_MATERIAL_VERIFICATION_REQUIRED",
	})
	record.LastVerifiedAt = ""
	record.RepairState = localEnvironmentRepairRequired
	material := engine.ManagedEnvironmentCheckResult{
		Kind: "accelerator_dependency", Reference: dependencyID + "/" + version,
		Locator: filepath.ToSlash(filepath.Join("dependencies", "accelerator-dependencies", dependencyID)),
		Status:  "unavailable", Reason: "ACCELERATOR_DEPENDENCY_OWNER_MATERIAL_VERIFIED_SELECTION_REQUIRED",
	}
	return record, status, material
}

func TestProductControlCheckSyncReopensBothManagedCUDASourcesFromCopiedRoot(t *testing.T) {
	formerRoot := filepath.Join(t.TempDir(), "former")
	currentRoot := filepath.Join(t.TempDir(), "current")
	statePath := filepath.Join(formerRoot, "accounts", "runtime", "local-state.json")
	first, err := NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, filepath.Join(formerRoot, "models"), formerRoot)
	if err != nil {
		t.Fatal(err)
	}
	fixtures := []struct {
		id, version string
		artifacts   []string
	}{
		{engine.NVIDIACUDAUserSpaceRuntimeDependencyID, "cuda_major=12", []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"}},
		{engine.NVIDIACUDA13UserSpaceRuntimeDependencyID, engine.NVIDIACUDA13UserSpaceRuntimeVersion, []string{"cublas64_13.dll", "cublasLt64_13.dll", "cufft64_12.dll", "cudart64_13.dll"}},
	}
	for _, fixture := range fixtures {
		record, _, _ := checkSyncCUDAFixture(formerRoot, fixture.id, fixture.version, fixture.artifacts)
		writeSelectedSourceLocalArtifactsForTest(t, record)
		first.mu.Lock()
		first.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(record)] = record
		if err := first.persistStateLocked(); err != nil {
			first.mu.Unlock()
			t.Fatal(err)
		}
		first.mu.Unlock()
	}
	first.Close()
	if err := os.CopyFS(currentRoot, os.DirFS(formerRoot)); err != nil {
		t.Fatal(err)
	}
	second, err := NewWithProductControlDataRoot(slog.Default(), nil, filepath.Join(currentRoot, "accounts", "runtime", "local-state.json"), 10, filepath.Join(currentRoot, "models"), currentRoot)
	if err != nil {
		t.Fatal(err)
	}
	fake := &checkSyncCUDAEngineManager{mockEngineManager: &mockEngineManager{}, statuses: map[string]engine.SharedAcceleratorDependencyStatus{}}
	for _, fixture := range fixtures {
		_, status, material := checkSyncCUDAFixture(currentRoot, fixture.id, fixture.version, fixture.artifacts)
		fake.statuses[fixture.id] = status
		fake.material = append(fake.material, material)
	}
	second.SetEngineManager(fake)
	result := second.reconcileProductControlCheckSyncEnvironments(context.Background(), ProductControlCheckSyncInput{RootActivationID: "rootact_test", DataRoot: currentRoot})
	if result.State != "completed" {
		t.Fatalf("environment owner = %+v", result)
	}
	for _, fixture := range fixtures {
		recordID := "selected-" + fixture.id
		found := false
		for _, resource := range result.Resources {
			found = found || resource.Reference != nil && *resource.Reference == recordID && resource.Status == "available"
		}
		if !found {
			t.Fatalf("CUDA record %s not reopened: %+v", recordID, result.Resources)
		}
		second.mu.RLock()
		reopened := second.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(localEnvironmentSelectedSourceRecordState{
			DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: fixture.id,
			EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyCUDA, fixture.id, "windows-amd64-nvidia-cuda", "windows/amd64", currentRoot),
		})]
		second.mu.RUnlock()
		if reopened.RecordID != recordID || reopened.RepairState == localEnvironmentRepairRequired || reopened.LastVerifiedAt == "" || !productControlPathsEqual(reopened.CanonicalRoot, filepath.Join(currentRoot, "dependencies", "accelerator-dependencies", fixture.id)) {
			t.Fatalf("CUDA record %s remains unverified: %+v", recordID, reopened)
		}
	}
	second.Close()
	third, err := NewWithProductControlDataRoot(slog.Default(), nil, filepath.Join(currentRoot, "accounts", "runtime", "local-state.json"), 10, filepath.Join(currentRoot, "models"), currentRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer third.Close()
	for _, fixture := range fixtures {
		third.mu.RLock()
		record := third.localEnvironmentSelectedSources[localEnvironmentSelectedSourceRecordKey(localEnvironmentSelectedSourceRecordState{
			DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: fixture.id,
			EnvironmentKey: localEnvironmentKey(localEnvironmentFamilyCUDA, fixture.id, "windows-amd64-nvidia-cuda", "windows/amd64", currentRoot),
		})]
		third.mu.RUnlock()
		if record.RecordID != "selected-"+fixture.id || record.LastVerifiedAt == "" || record.RepairState == localEnvironmentRepairRequired {
			t.Fatalf("CUDA verification did not survive restart: %+v", record)
		}
	}
}

func TestProductControlCheckSyncRejectsMismatchedCUDACustody(t *testing.T) {
	root := t.TempDir()
	record, status, material := checkSyncCUDAFixture(root, engine.NVIDIACUDAUserSpaceRuntimeDependencyID, "cuda_major=12", []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"})
	statuses := map[string]engine.SharedAcceleratorDependencyStatus{record.DependencyID: status}
	if !productControlCheckSyncEnvironmentMaterialSupportsRecord(record, []engine.ManagedEnvironmentCheckResult{material}, statuses, root) {
		t.Fatal("matching CUDA owner material rejected")
	}
	for name, mutate := range map[string]func(*localEnvironmentSelectedSourceRecordState){
		"wrong digest": func(value *localEnvironmentSelectedSourceRecordState) {
			value.Hashes["required_artifact_set"] = "wrong"
		},
		"wrong root": func(value *localEnvironmentSelectedSourceRecordState) {
			value.CanonicalRoot = filepath.Join(t.TempDir(), "foreign")
		},
		"wrong artifact": func(value *localEnvironmentSelectedSourceRecordState) { value.VerifiedArtifacts[0] = "other.dll" },
		"wrong version":  func(value *localEnvironmentSelectedSourceRecordState) { value.Version = "cuda_major=13" },
		"wrong source": func(value *localEnvironmentSelectedSourceRecordState) {
			value.SourceKind = localEnvironmentSourceImported
		},
	} {
		t.Run(name, func(t *testing.T) {
			changed := record
			changed.Hashes = cloneStringMap(record.Hashes)
			changed.VerifiedArtifacts = append([]string(nil), record.VerifiedArtifacts...)
			mutate(&changed)
			if productControlCheckSyncEnvironmentMaterialSupportsRecord(changed, []engine.ManagedEnvironmentCheckResult{material}, statuses, root) {
				t.Fatalf("mismatched CUDA source promoted: %+v", changed)
			}
		})
	}
	if productControlCheckSyncEnvironmentMaterialSupportsRecord(record, nil, statuses, root) {
		t.Fatal("CUDA source promoted without owner verification")
	}
	status.State = engine.SharedAcceleratorDependencyRepairRequired
	statuses[record.DependencyID] = status
	if productControlCheckSyncEnvironmentMaterialSupportsRecord(record, []engine.ManagedEnvironmentCheckResult{material}, statuses, root) {
		t.Fatal("CUDA source promoted when the current owner material requires repair")
	}
}
