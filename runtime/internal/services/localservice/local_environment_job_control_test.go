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
