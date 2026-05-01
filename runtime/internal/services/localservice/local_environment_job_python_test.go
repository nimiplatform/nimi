package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
)

func TestStartPythonRuntimeDependencyJobRequiresSelectedUVRecord(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.runtime|python.runtime|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     "python.runtime",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected uv record", resp.GetJob().GetState())
	}
}

func TestStartPythonRuntimeDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	uvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.SetEngineManager(&mockEngineManager{
		pythonRuntimeStatus: &engine.PythonRuntimeDependencyStatus{
			PythonVersion:   "Python 3.12.11",
			InterpreterPath: `C:\nimi\engines\media\0.1.0\Scripts\python.exe`,
			RuntimeRoot:     `C:\nimi\engines\media\0.1.0`,
			UVExecutable:    `C:\nimi\engines\uv\uv.exe`,
			Detail:          "Runtime-managed Python runtime verified through selected uv tool",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.runtime|python.runtime|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyId:     "python.runtime",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["selected_uv_record"]; got != uvRecord.RecordID {
		t.Fatalf("selected uv record hash = %q, want %q", got, uvRecord.RecordID)
	}
	if got := source.GetSelectedConsumers(); !stringSliceContains(got, "media.diffusers.cuda") || !stringSliceContains(got, "media.diffusers.cpu") {
		t.Fatalf("selected consumers = %v, want local-image python consumers", got)
	}
}

func TestStartPythonVenvDependencyJobRequiresSelectedPythonRuntimeRecord(t *testing.T) {
	svc := newTestService(t)
	svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.venv|local-image-python.venv|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     "local-image-python.venv",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected python.runtime record", resp.GetJob().GetState())
	}
}

func TestStartPythonVenvDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	uvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	runtimeRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonRuntime,
		DependencyID:      "python.runtime",
		EnvironmentKey:    "python.runtime|python.runtime|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\python-installations\cpython-3.12.11\python.exe`,
		Version:           "Python 3.12.11",
		VerifiedArtifacts: []string{`C:\nimi\engines\python-installations\cpython-3.12.11\python.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.SetEngineManager(&mockEngineManager{
		pythonVenvStatus: &engine.PythonVenvDependencyStatus{
			VenvRoot:        `C:\nimi\engines\media\0.1.0`,
			InterpreterPath: `C:\nimi\engines\media\0.1.0\Scripts\python.exe`,
			PythonRuntime:   `C:\nimi\engines\python-installations\cpython-3.12.11\python.exe`,
			UVExecutable:    `C:\nimi\engines\uv\uv.exe`,
			Detail:          "Runtime-managed Python venv verified through selected uv tool and Python runtime",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.venv|local-image-python.venv|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     "local-image-python.venv",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetCanonicalRoot() != `C:\nimi\engines\media\0.1.0` {
		t.Fatalf("canonical root = %q, want venv root", job.GetCanonicalRoot())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonVenv,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["selected_uv_record"]; got != uvRecord.RecordID {
		t.Fatalf("selected uv record hash = %q, want %q", got, uvRecord.RecordID)
	}
	if got := source.GetHashes()["selected_python_runtime_record"]; got != runtimeRecord.RecordID {
		t.Fatalf("selected python runtime record hash = %q, want %q", got, runtimeRecord.RecordID)
	}
	if got := source.GetSelectedConsumers(); !stringSliceContains(got, "media.diffusers.cuda") || !stringSliceContains(got, "media.diffusers.cpu") {
		t.Fatalf("selected consumers = %v, want local-image python consumers", got)
	}
}

func TestStartPythonPackageSetDependencyJobRequiresSelectedVenvRecord(t *testing.T) {
	svc := newTestService(t)
	svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|speech.qwen3-tts.python",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"speech.qwen3-tts.python"},
	})
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.package-set|local-speech.package-set|host|windows/amd64|root|speech.qwen3-tts.python",
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     "local-speech.package-set",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected python.venv record", resp.GetJob().GetState())
	}
}

func TestStartPythonPackageSetDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	uvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|speech.qwen3-tts.python",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"speech.qwen3-tts.python"},
	})
	venvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      "local-speech.venv",
		EnvironmentKey:    "python.venv|local-speech.venv|host|windows/amd64|root|speech.qwen3-tts.python",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\speech\0.1.0`,
		Version:           "Python 3.12.11",
		VerifiedArtifacts: []string{`C:\nimi\engines\speech\0.1.0\Scripts\python.exe`},
		SelectedConsumers: []string{"speech.qwen3-tts.python"},
	})
	svc.SetEngineManager(&mockEngineManager{
		pythonPackageSetStatus: &engine.PythonPackageSetDependencyStatus{
			PackageSetID:           "speech-qwen3-python-core",
			LockHash:               "9a9307c48e6d92fb600d63a330c126e93c8625978b753534e65926353b85a58e",
			VenvRoot:               `C:\nimi\engines\speech\0.1.0`,
			InterpreterPath:        `C:\nimi\engines\speech\0.1.0\Scripts\python.exe`,
			UVExecutable:           `C:\nimi\engines\uv\uv.exe`,
			Packages:               []string{"fastapi==0.121.1", "uvicorn[standard]==0.38.0", "python-multipart==0.0.26"},
			InstalledDistributions: []string{"fastapi==0.121.1", "python-multipart==0.0.26", "uvicorn==0.38.0"},
			ImportProbes:           []string{"fastapi", "uvicorn", "multipart"},
			Detail:                 "Runtime-managed Python package set verified from declared lock manifest",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.package-set|local-speech.package-set|host|windows/amd64|root|speech.qwen3-tts.python",
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     "local-speech.package-set",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["package_lock_hash"]; got != "9a9307c48e6d92fb600d63a330c126e93c8625978b753534e65926353b85a58e" {
		t.Fatalf("package lock hash = %q, want declared lock hash", got)
	}
	if got := source.GetHashes()["selected_uv_record"]; got != uvRecord.RecordID {
		t.Fatalf("selected uv record hash = %q, want %q", got, uvRecord.RecordID)
	}
	if got := source.GetHashes()["selected_venv_record"]; got != venvRecord.RecordID {
		t.Fatalf("selected venv record hash = %q, want %q", got, venvRecord.RecordID)
	}
	if got := source.GetSelectedConsumers(); !stringSliceContains(got, "speech.qwen3-tts.python") || !stringSliceContains(got, "speech.qwen3-asr.python") {
		t.Fatalf("selected consumers = %v, want speech consumers", got)
	}
}

func TestStartPythonTorchWheelDependencyJobRequiresCUDARecordForCUDAConsumer(t *testing.T) {
	svc := newTestService(t)
	svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      "local-image-python.venv",
		EnvironmentKey:    "python.venv|local-image-python.venv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\media\0.1.0`,
		Version:           "Python 3.12.11",
		VerifiedArtifacts: []string{`C:\nimi\engines\media\0.1.0\Scripts\python.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.SetEngineManager(&mockEngineManager{})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.torch-wheel|local-image-python.torch-wheel|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyId:     "local-image-python.torch-wheel",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without selected CUDA record", resp.GetJob().GetState())
	}
}

func TestStartPythonTorchWheelDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	uvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonUV,
		DependencyID:      "uv",
		EnvironmentKey:    "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\uv\uv.exe`,
		Version:           "0.11.8",
		VerifiedArtifacts: []string{`C:\nimi\engines\uv\uv.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	venvRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyPythonVenv,
		DependencyID:      "local-image-python.venv",
		EnvironmentKey:    "python.venv|local-image-python.venv|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\engines\media\0.1.0`,
		Version:           "Python 3.12.11",
		VerifiedArtifacts: []string{`C:\nimi\engines\media\0.1.0\Scripts\python.exe`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	cudaRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyCUDA,
		DependencyID:      cudaUserSpaceRuntimeDependencyID,
		EnvironmentKey:    "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|media.diffusers.cuda",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     `C:\nimi\runtime\dependencies\cuda`,
		VerifiedArtifacts: []string{`C:\nimi\runtime\dependencies\cuda\bin\cudart64_12.dll`},
		SelectedConsumers: []string{"media.diffusers.cuda"},
	})
	svc.SetEngineManager(&mockEngineManager{
		pythonTorchWheelStatus: &engine.PythonTorchWheelDependencyStatus{
			TorchVersion:     "2.7.1+cu126",
			TorchvisionSpec:  "torchvision==0.22.1",
			AcceleratorPlane: "cuda",
			CUDAABI:          "cu126",
			WheelIndex:       "https://download.pytorch.org/whl/cu126",
			WheelLockHash:    "f7e7402ad7ef255ac2da7116eb5406dd403107d98035172016f749efca404546",
			VenvRoot:         `C:\nimi\engines\media\0.1.0`,
			InterpreterPath:  `C:\nimi\engines\media\0.1.0\Scripts\python.exe`,
			UVExecutable:     `C:\nimi\engines\uv\uv.exe`,
			ImportProbes:     []string{"torch", "torchvision"},
			Detail:           "Runtime-managed Python torch wheel set verified from declared wheel index",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.torch-wheel|local-image-python.torch-wheel|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyId:     "local-image-python.torch-wheel",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["wheel_lock_hash"]; got != "f7e7402ad7ef255ac2da7116eb5406dd403107d98035172016f749efca404546" {
		t.Fatalf("wheel lock hash = %q, want declared wheel lock hash", got)
	}
	if got := source.GetHashes()["selected_uv_record"]; got != uvRecord.RecordID {
		t.Fatalf("selected uv record hash = %q, want %q", got, uvRecord.RecordID)
	}
	if got := source.GetHashes()["selected_venv_record"]; got != venvRecord.RecordID {
		t.Fatalf("selected venv record hash = %q, want %q", got, venvRecord.RecordID)
	}
	if got := source.GetHashes()["selected_cuda_record"]; got != cudaRecord.RecordID {
		t.Fatalf("selected cuda record hash = %q, want %q", got, cudaRecord.RecordID)
	}
	if got := source.GetSelectedConsumers(); !stringSliceContains(got, "media.diffusers.cuda") || !stringSliceContains(got, "media.diffusers.cpu") {
		t.Fatalf("selected consumers = %v, want local-image python consumers", got)
	}
}

func TestStartModelAssetDependencyJobRejectsPackPlaceholder(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|local-image-python.model-asset|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     "local-image-python.model-asset",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required for non asset-specific dependency id", resp.GetJob().GetState())
	}
}

func TestStartModelAssetDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	model := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-model-asset",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "model.safetensors",
		hashes:       map[string]string{"model.safetensors": "sha256:b899bf805912441a8767d3e01859281ab3a1cd7b18edea93f5e54c18b648b54c"},
	})
	writeLocalEnvironmentAssetEntryForTest(t, svc, model, "verified-model-asset")

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|asset:" + model.GetLocalAssetId() + "|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     "asset:" + model.GetLocalAssetId(),
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyModelAsset,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["entry_sha256"]; got != "b899bf805912441a8767d3e01859281ab3a1cd7b18edea93f5e54c18b648b54c" {
		t.Fatalf("entry sha = %q, want verified model hash", got)
	}
	if got := source.GetHashes()["local_asset_id"]; got != model.GetLocalAssetId() {
		t.Fatalf("local asset hash = %q, want %q", got, model.GetLocalAssetId())
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "media.diffusers.cpu" {
		t.Fatalf("selected consumers = %v, want media.diffusers.cpu", got)
	}
}

func TestStartModelCompanionDependencyJobRequiresParentModelAssetRecord(t *testing.T) {
	svc := newTestService(t)
	companion := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-companion",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "vae.safetensors",
	})
	writeLocalEnvironmentAssetEntryForTest(t, svc, companion, "verified-companion")

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.companion-asset|asset:" + companion.GetLocalAssetId() + "|host|windows/amd64|root|media.diffusers.cpu",
		DependencyFamily: localEnvironmentFamilyModelCompanion,
		DependencyId:     "asset:" + companion.GetLocalAssetId(),
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed without parent model.asset selected source", resp.GetJob().GetState())
	}
}

func TestStartModelCompanionDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	parent := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-parent",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "model.safetensors",
	})
	companion := mustInstallSupervisedLocalModel(t, svc, installLocalAssetParams{
		assetID:      "image/test-vae",
		capabilities: []string{"image"},
		engine:       "media",
		entry:        "vae.safetensors",
	})
	writeLocalEnvironmentAssetEntryForTest(t, svc, parent, "verified-parent")
	writeLocalEnvironmentAssetEntryForTest(t, svc, companion, "verified-companion")
	parentRecord := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyModelAsset,
		DependencyID:      "asset-id:" + parent.GetAssetId(),
		EnvironmentKey:    "model.asset|asset-id:" + parent.GetAssetId() + "|host|windows/amd64|root",
		SourceKind:        localEnvironmentSourceManaged,
		CanonicalRoot:     "parent-root",
		Hashes:            map[string]string{"local_asset_id": parent.GetLocalAssetId()},
		SelectedConsumers: []string{"media.diffusers.cpu"},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.companion-asset|asset-id:" + companion.GetAssetId() + "|parent-asset-id:" + parent.GetAssetId() + "|host|windows/amd64|root",
		DependencyFamily: localEnvironmentFamilyModelCompanion,
		DependencyId:     "asset-id:" + companion.GetAssetId() + "|parent-asset-id:" + parent.GetAssetId(),
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyModelCompanion,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["parent_model_asset_record"]; got != parentRecord.RecordID {
		t.Fatalf("parent record hash = %q, want %q", got, parentRecord.RecordID)
	}
	if got := source.GetHashes()["companion_local_asset_id"]; got != companion.GetLocalAssetId() {
		t.Fatalf("companion asset hash = %q, want %q", got, companion.GetLocalAssetId())
	}
}

func TestStartNativeSDCPPDependencyJobRepairRequiredWithoutEvidence(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName: "stablediffusion-ggml",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "env",
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
		DependencyId:     "stable-diffusion.cpp.package",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", resp.GetJob().GetState())
	}
}
