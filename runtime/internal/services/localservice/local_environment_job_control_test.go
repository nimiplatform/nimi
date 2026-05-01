package localservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func writeLocalEnvironmentAssetEntryForTest(t *testing.T, svc *Service, asset *runtimev1.LocalAssetRecord, content string) string {
	t.Helper()
	target := filepath.Join(svc.resolvedLocalModelsPath(), slugifyLocalModelID(asset.GetAssetId()), filepath.FromSlash(asset.GetEntry()))
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		t.Fatalf("mkdir asset entry: %v", err)
	}
	if err := os.WriteFile(target, []byte(content), 0o644); err != nil {
		t.Fatalf("write asset entry: %v", err)
	}
	return target
}

func TestStartLocalEnvironmentDependencyJobRequiresConfirmation(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "env",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId:     cudaUserSpaceRuntimeDependencyID,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want FailedPrecondition", err)
	}
}

func TestStartLocalEnvironmentDependencyJobReturnsFailedRuntimeOwnedJob(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|desktop.local-model-center",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId:     cudaUserSpaceRuntimeDependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetJobId() == "" {
		t.Fatal("expected job id")
	}
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed when engine manager is unavailable", job.GetState())
	}

	listResp, err := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{
		EnvironmentKey: job.GetEnvironmentKey(),
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentDependencyJobs: %v", err)
	}
	if len(listResp.GetJobs()) != 1 || listResp.GetJobs()[0].GetJobId() != job.GetJobId() {
		t.Fatalf("listed jobs = %#v, want failed Runtime-owned job", listResp.GetJobs())
	}
}

func TestCancelLocalEnvironmentDependencyJobProjectsCancelledRetryable(t *testing.T) {
	svc := newTestService(t)
	job, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   "env",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyID:     cudaUserSpaceRuntimeDependencyID,
	}, nil)
	if err != nil {
		t.Fatalf("startLocalEnvironmentDependencyJob: %v", err)
	}

	resp, err := svc.CancelLocalEnvironmentDependencyJob(context.Background(), &runtimev1.CancelLocalEnvironmentDependencyJobRequest{
		JobId: job.JobID,
	})
	if err != nil {
		t.Fatalf("CancelLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateCancelled {
		t.Fatalf("job state = %q, want cancelled", resp.GetJob().GetState())
	}
	if !resp.GetJob().GetRetryable() {
		t.Fatal("cancelled dependency job should remain retryable")
	}
}

func TestRepairLocalEnvironmentDependencyRequiresSelectedSource(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.RepairLocalEnvironmentDependency(context.Background(), &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey:   "missing-env",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId:     cudaUserSpaceRuntimeDependencyID,
		Confirmed:        true,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("RepairLocalEnvironmentDependency error = %v, want FailedPrecondition", err)
	}
}

func TestStartCUDADependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
			DependencyID:      cudaUserSpaceRuntimeDependencyID,
			ConsumerID:        "media.diffusers.cuda",
			State:             engine.SharedAcceleratorDependencyReadyManaged,
			Source:            "runtime_managed",
			CanonicalRoot:     `C:\nimi\runtime\dependencies\cuda`,
			Detail:            "nvidia_cuda_user_space_runtime state=ready_managed source=runtime_managed",
			RequiredArtifacts: []string{"cudart64_12.dll", "cublas64_12.dll", "cublasLt64_12.dll"},
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId:     cudaUserSpaceRuntimeDependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetCanonicalRoot() == "" || job.GetSelectedSourceRecordId() == "" {
		t.Fatalf("job missing selected source promotion fields: %+v", job)
	}

	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyCUDA,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "media.diffusers.cuda" {
		t.Fatalf("selected consumers = %v, want media.diffusers.cuda", got)
	}
	if len(source.GetVerifiedArtifacts()) != 3 {
		t.Fatalf("verified artifacts = %v, want CUDA runtime artifact set", source.GetVerifiedArtifacts())
	}
}

func TestRetryLocalEnvironmentDependencyJobReexecutesFailedJob(t *testing.T) {
	svc := newTestService(t)
	mgr := &mockEngineManager{
		ensureManagedImageBackendErr: errors.New("download failed"),
	}
	svc.SetEngineManager(mgr)

	startResp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "accelerator.cuda.runtime|nvidia-cuda-user-space-runtime|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId:     cudaUserSpaceRuntimeDependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if startResp.GetJob().GetState() != localEnvironmentStateFailed || !startResp.GetJob().GetRetryable() {
		t.Fatalf("start job = %+v, want retryable failed", startResp.GetJob())
	}

	mgr.ensureManagedImageBackendErr = nil
	retryResp, err := svc.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
		JobId:     startResp.GetJob().GetJobId(),
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("RetryLocalEnvironmentDependencyJob: %v", err)
	}
	if retryResp.GetJob().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("retry job state = %q, want ready_managed", retryResp.GetJob().GetState())
	}
	if retryResp.GetJob().GetSelectedSourceRecordId() == "" {
		t.Fatalf("retry job missing selected source record: %+v", retryResp.GetJob())
	}
}

func TestRepairLocalEnvironmentDependencyReverifiesSelectedSource(t *testing.T) {
	svc := newTestService(t)
	environmentKey := "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cuda"
	record := svc.upsertLocalEnvironmentSelectedSourceRecord(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyID:     "llama.cpp.package",
		EnvironmentKey:   environmentKey,
		SourceKind:       localEnvironmentSourceManaged,
		CanonicalRoot:    `C:\nimi\engines\llama\old`,
		RepairState:      localEnvironmentRepairRequired,
	})
	svc.SetEngineManager(&mockEngineManager{
		engineBinaryDependencyStatus: &engine.EngineBinaryDependencyStatus{
			Engine:           "llama",
			Version:          "b8645",
			BinaryPath:       `C:\nimi\engines\llama\b8645\llama-server.exe`,
			SHA256:           "fedcba9876543210",
			Platform:         "windows/amd64",
			AssetName:        "llama-b8645-bin-win-cuda-12.4-x64.zip",
			AcceleratorPlane: "cuda",
			Detail:           "llama engine package reverified from Runtime registry",
		},
	})

	resp, err := svc.RepairLocalEnvironmentDependency(context.Background(), &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
		ReasonCode:       "hash_mismatch",
	})
	if err != nil {
		t.Fatalf("RepairLocalEnvironmentDependency: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("repair job state = %q, want ready_managed", resp.GetJob().GetState())
	}
	if resp.GetJob().GetSelectedSourceRecordId() == "" || resp.GetJob().GetSelectedSourceRecordId() == record.RecordID {
		t.Fatalf("repair job selected source = %q, previous = %q", resp.GetJob().GetSelectedSourceRecordId(), record.RecordID)
	}
	repaired, ok := svc.localEnvironmentSelectedSourceRecord(environmentKey)
	if !ok {
		t.Fatal("expected repaired selected source record")
	}
	switch repaired.RepairState {
	case localEnvironmentRepairRequired, localEnvironmentRepairRunning, localEnvironmentRepairFailed:
		t.Fatalf("repair state = %q, want cleared after verification", repaired.RepairState)
	}
	if repaired.Hashes["sha256"] != "fedcba9876543210" {
		t.Fatalf("repaired sha256 = %q, want reverified hash", repaired.Hashes["sha256"])
	}
}

func TestStartNativeSDCPPDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "canonical_runtime_wrapper",
			CanonicalRoot:     `C:\nimi\runtime\managed-image-backends\sd-win-cuda12-x64-stablediffusion-ggml`,
			VerifiedArtifacts: []string{"sd.exe", "metadata.json"},
			Detail:            "managed image backend package verified from canonical_runtime_wrapper",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "native-engine-package.stablediffusion-ggml|stable-diffusion.cpp.package|host|windows/amd64|root|stable-diffusion.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
		DependencyId:     "stable-diffusion.cpp.package",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetSelectedSourceRecordId() == "" {
		t.Fatal("expected selected source record id")
	}

	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyNativeSDCPP,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	if len(sources.GetSources()) != 1 {
		t.Fatalf("selected sources len = %d, want 1", len(sources.GetSources()))
	}
	source := sources.GetSources()[0]
	if source.GetCanonicalRoot() == "" || len(source.GetVerifiedArtifacts()) == 0 {
		t.Fatalf("selected source missing verification evidence: %+v", source)
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "stable-diffusion.cpp.cuda" {
		t.Fatalf("selected consumers = %v, want stable-diffusion.cpp.cuda", got)
	}
}

func TestStartNativeLlamaDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		engineBinaryDependencyStatus: &engine.EngineBinaryDependencyStatus{
			Engine:           "llama",
			Version:          "b8645",
			BinaryPath:       `C:\nimi\engines\llama\b8645\llama-server.exe`,
			SHA256:           "0123456789abcdef",
			Platform:         "windows/amd64",
			AssetName:        "llama-b8645-bin-win-cuda-12.4-x64.zip",
			AcceleratorPlane: "cuda",
			Detail:           "llama engine package verified from Runtime registry",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetCanonicalRoot() == "" || job.GetSelectedSourceRecordId() == "" {
		t.Fatalf("job missing promoted source fields: %+v", job)
	}

	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyNativeLlama,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["sha256"]; got != "0123456789abcdef" {
		t.Fatalf("selected source sha256 = %q, want materialized hash", got)
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "llama.cpp.cuda" {
		t.Fatalf("selected consumers = %v, want llama.cpp.cuda", got)
	}
}

func TestStartNativeLlamaDependencyJobRepairRequiredWithoutHash(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		engineBinaryDependencyStatus: &engine.EngineBinaryDependencyStatus{
			Engine:     "llama",
			Version:    "b8645",
			BinaryPath: `C:\nimi\engines\llama\b8645\llama-server.exe`,
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "env",
		DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", resp.GetJob().GetState())
	}
}

func TestStartPythonUVDependencyJobPromotesVerifiedSelectedSource(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		uvToolDependencyStatus: &engine.UVToolDependencyStatus{
			Version:          "0.11.8",
			ExecutablePath:   `C:\nimi\engines\uv\uv.exe`,
			SourceRoot:       `C:\nimi\engines\uv`,
			ArchiveURL:       "https://releases.astral.sh/github/uv/releases/download/0.11.8/uv-x86_64-pc-windows-msvc.zip",
			ArchiveSHA256:    "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8",
			ArchiveAssetName: "uv-x86_64-pc-windows-msvc.zip",
			Platform:         "windows/amd64",
			Detail:           "Runtime-managed uv tool verified from pinned official archive",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.tool.uv|uv|host|windows/amd64|root|media.diffusers.cuda",
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := resp.GetJob()
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetCanonicalRoot() != `C:\nimi\engines\uv\uv.exe` {
		t.Fatalf("canonical root = %q, want uv executable", job.GetCanonicalRoot())
	}

	sources, err := svc.ListLocalEnvironmentSelectedSources(context.Background(), &runtimev1.ListLocalEnvironmentSelectedSourcesRequest{
		DependencyFamily: localEnvironmentFamilyPythonUV,
	})
	if err != nil {
		t.Fatalf("ListLocalEnvironmentSelectedSources: %v", err)
	}
	source := sources.GetSources()[0]
	if got := source.GetHashes()["archive_sha256"]; got != "c84629a56e0706b69a47ea35862208af827cb6fbfa1d0ca763c52c67594637e8" {
		t.Fatalf("archive hash = %q, want pinned uv archive hash", got)
	}
	if got := source.GetSelectedConsumers(); !stringSliceContains(got, "media.diffusers.cuda") || !stringSliceContains(got, "speech.qwen3-tts.python") {
		t.Fatalf("selected consumers = %v, want shared python consumers", got)
	}
}

func TestStartPythonUVDependencyJobRepairRequiredWithoutVersion(t *testing.T) {
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{
		uvToolDependencyStatus: &engine.UVToolDependencyStatus{
			ExecutablePath: "uv.exe",
			ArchiveSHA256:  "abc123",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "env",
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	if resp.GetJob().GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", resp.GetJob().GetState())
	}
}

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
