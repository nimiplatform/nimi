package localservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// awaitLocalEnvironmentDependencyJobTerminal polls a dependency job (started via
// an async Start/Retry/Repair RPC) until its background goroutine drives it to a
// terminal state, returning the terminal job projection.
func awaitLocalEnvironmentDependencyJobTerminal(t *testing.T, svc *Service, jobID string) *runtimev1.LocalEnvironmentDependencyJob {
	t.Helper()
	if jobID == "" {
		t.Fatal("awaitLocalEnvironmentDependencyJobTerminal: empty job id")
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(jobID)
		if !ok {
			t.Fatalf("local environment dependency job %s not found", jobID)
		}
		if localEnvironmentDependencyJobSettledForTest(job.State) {
			return localEnvironmentDependencyJobToProto(job)
		}
		if time.Now().After(deadline) {
			t.Fatalf("local environment dependency job %s did not settle (last=%q)", jobID, job.State)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t *testing.T, svc *Service, jobID string, bytesReceived int64, bytesTotal int64) *runtimev1.LocalEnvironmentDependencyJob {
	t.Helper()
	if jobID == "" {
		t.Fatal("awaitLocalEnvironmentDependencyJobDownloadingProgressForTest: empty job id")
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(jobID)
		if !ok {
			t.Fatalf("local environment dependency job %s not found", jobID)
		}
		if job.State == localEnvironmentStateDownloading &&
			job.BytesReceived == bytesReceived &&
			job.BytesTotal == bytesTotal {
			return localEnvironmentDependencyJobToProto(job)
		}
		if time.Now().After(deadline) {
			t.Fatalf("local environment dependency job %s did not reach downloading progress %d/%d (last state=%q bytes=%d/%d)", jobID, bytesReceived, bytesTotal, job.State, job.BytesReceived, job.BytesTotal)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func awaitLocalEnvironmentDependencyJobStateForTest(t *testing.T, svc *Service, jobID string, state string) *runtimev1.LocalEnvironmentDependencyJob {
	t.Helper()
	if jobID == "" {
		t.Fatal("awaitLocalEnvironmentDependencyJobStateForTest: empty job id")
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(jobID)
		if !ok {
			t.Fatalf("local environment dependency job %s not found", jobID)
		}
		if job.State == state {
			return localEnvironmentDependencyJobToProto(job)
		}
		if time.Now().After(deadline) {
			t.Fatalf("local environment dependency job %s did not reach state %q (last state=%q bytes=%d/%d)", jobID, state, job.State, job.BytesReceived, job.BytesTotal)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

// writeLocalEnvironmentAssetEntryForTest stages a model entry at the canonical
// managed-download bundle layout that installManagedDownloadedModel produces and
// the materializer verify path (resolveManagedModelEntryAbsolutePath) resolves:
// `<modelsRoot>/resolved/<logicalModelID>/<entry>` for any record carrying a
// logical model id, falling back to `<modelsRoot>/<slug(assetID)>/<entry>` only
// for a record with no logical model id.
func writeLocalEnvironmentAssetEntryForTest(t *testing.T, svc *Service, asset *runtimev1.LocalAssetRecord, content string) string {
	t.Helper()
	modelsRoot := svc.resolvedLocalModelsPath()
	var target string
	if logicalModelID := strings.Trim(strings.TrimSpace(asset.GetLogicalModelId()), "/"); logicalModelID != "" && shouldUseLogicalManagedBundlePath(asset) {
		target = filepath.Join(runtimeManagedResolvedModelDir(modelsRoot, logicalModelID), filepath.FromSlash(asset.GetEntry()))
	} else {
		target = filepath.Join(modelsRoot, slugifyLocalModelID(asset.GetAssetId()), filepath.FromSlash(asset.GetEntry()))
	}
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
	started := resp.GetJob()
	if started.GetJobId() == "" {
		t.Fatal("expected job id")
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, started.GetJobId())
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
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
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

func TestCUDADependencyJobProjectsSharedAcceleratorDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	release := make(chan struct{})
	svc.SetEngineManager(&mockEngineManager{
		sharedAcceleratorDependencyRelease: release,
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

	downloading := awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t, svc, resp.GetJob().GetJobId(), 384, 1536)
	if downloading.GetPercent() != 25 {
		t.Fatalf("download percent = %d, want 25", downloading.GetPercent())
	}
	close(release)

	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", terminal.GetState())
	}
	if terminal.GetBytesReceived() != 0 || terminal.GetPercent() != 0 {
		t.Fatalf("terminal job retained stale progress: %+v", terminal)
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
	startTerminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, startResp.GetJob().GetJobId())
	if startTerminal.GetState() != localEnvironmentStateFailed || !startTerminal.GetRetryable() {
		t.Fatalf("start job = %+v, want retryable failed", startTerminal)
	}

	mgr.ensureManagedImageBackendErr = nil
	retryResp, err := svc.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
		JobId:     startTerminal.GetJobId(),
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("RetryLocalEnvironmentDependencyJob: %v", err)
	}
	retryTerminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, retryResp.GetJob().GetJobId())
	if retryTerminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("retry job state = %q, want ready_managed", retryTerminal.GetState())
	}
	if retryTerminal.GetSelectedSourceRecordId() == "" {
		t.Fatalf("retry job missing selected source record: %+v", retryTerminal)
	}
}

func TestRetryLocalEnvironmentDependencyJobRestoresConsumerScopeAfterRestart(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}
	dep := nativeSDCPPPlanDependencyForTest(t, svc, "stable-diffusion.cpp.metal", localEnvironmentAppleSilicon128GBProfile())
	startResp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	startTerminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, startResp.GetJob().GetJobId())
	if startTerminal.GetState() != localEnvironmentStateFailed || !startTerminal.GetRetryable() {
		t.Fatalf("start job = %+v, want retryable failed", startTerminal)
	}
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	restored.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "canonical_localai_derived",
			PackageFormat:     "oci_payload",
			LaunchMode:        "package_entrypoint",
			CanonicalRoot:     filepath.Join(runtimeDataRoot, "managed-image-backends", "metal-stablediffusion-ggml"),
			VerifiedArtifacts: []string{"run.sh", "metadata.json"},
			Detail:            "managed image backend package verified from canonical_localai_derived",
		},
	})
	retryResp, err := restored.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
		JobId:     startTerminal.GetJobId(),
		Confirmed: true,
	})
	if err != nil {
		t.Fatalf("RetryLocalEnvironmentDependencyJob after restore: %v", err)
	}
	retryTerminal := awaitLocalEnvironmentDependencyJobTerminal(t, restored, retryResp.GetJob().GetJobId())
	if retryTerminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("retry job state = %q, want ready_managed: %+v", retryTerminal.GetState(), retryTerminal)
	}
	source, ok := restored.localEnvironmentSelectedSourceRecordForDependency(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, "stable-diffusion.cpp.metal")
	if !ok {
		t.Fatalf("missing restored retry selected source for metal consumer")
	}
	if !stringSliceContains(source.SelectedConsumers, "stable-diffusion.cpp.metal") {
		t.Fatalf("selected source consumers = %v, want metal", source.SelectedConsumers)
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
		SelectedConsumers: []string{
			"llama.cpp.cuda",
		},
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
	repairTerminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if repairTerminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("repair job state = %q, want ready_managed", repairTerminal.GetState())
	}
	if repairTerminal.GetSelectedSourceRecordId() == "" || repairTerminal.GetSelectedSourceRecordId() != record.RecordID {
		t.Fatalf("repair job selected source = %q, want existing source %q", repairTerminal.GetSelectedSourceRecordId(), record.RecordID)
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

func nativeSDCPPPlanDependencyForTest(t *testing.T, svc *Service, consumer string, profile *runtimev1.LocalDeviceProfile) localEnvironmentPlanDependency {
	t.Helper()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    consumer,
		HostProfile:      profile,
		RuntimeDataRoot:  filepath.Join(t.TempDir(), "runtime-data"),
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeSDCPP)
	if dep.ConsumerScope != consumer {
		t.Fatalf("plan native SDCPP consumer = %q, want %q", dep.ConsumerScope, consumer)
	}
	if strings.Count(dep.EnvironmentKey, "|") != 4 {
		t.Fatalf("plan-generated EnvironmentKey must use five-part schema, got %q", dep.EnvironmentKey)
	}
	return dep
}

func TestStartNativeSDCPPDependencyJobPromotesDarwinLocalAIOCISelectedSource(t *testing.T) {
	svc := newTestService(t)
	dep := nativeSDCPPPlanDependencyForTest(t, svc, "stable-diffusion.cpp.metal", localEnvironmentAppleSilicon128GBProfile())
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "canonical_localai_derived",
			PackageFormat:     "oci_payload",
			LaunchMode:        "package_entrypoint",
			CanonicalRoot:     `/tmp/nimi/runtime/managed-image-backends/metal-stablediffusion-ggml`,
			VerifiedArtifacts: []string{"run.sh", "metadata.json"},
			Detail:            "managed image backend package verified from canonical_localai_derived",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	if job.GetSelectedSourceRecordId() == "" {
		t.Fatal("expected selected source record id")
	}
	if got := svc.engineManagerOrNil().(*mockEngineManager).managedImageBackendConfigs[0].PackageSource; got != "canonical_localai_derived" {
		t.Fatalf("requested package source = %q, want canonical_localai_derived", got)
	}
	if job.GetEnvironmentKey() != dep.EnvironmentKey {
		t.Fatalf("job EnvironmentKey = %q, want plan key %q", job.GetEnvironmentKey(), dep.EnvironmentKey)
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
	if source.GetEnvironmentKey() != dep.EnvironmentKey {
		t.Fatalf("selected source EnvironmentKey = %q, want plan key %q", source.GetEnvironmentKey(), dep.EnvironmentKey)
	}
	if source.GetCanonicalRoot() == "" || len(source.GetVerifiedArtifacts()) == 0 {
		t.Fatalf("selected source missing verification evidence: %+v", source)
	}
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "stable-diffusion.cpp.metal" {
		t.Fatalf("selected consumers = %v, want stable-diffusion.cpp.metal", got)
	}
	if source.GetVersion() != "canonical_localai_derived" ||
		!stringSliceContains(source.GetCompatibilityEvidence(), "package_format=oci_payload") {
		t.Fatalf("selected source is not canonical LocalAI OCI evidence: %+v", source)
	}
}

func TestStartLocalEnvironmentDependencyJobFailsClosedForAmbiguousConsumerContract(t *testing.T) {
	svc := newTestService(t)
	runtimeDataRoot := filepath.Join(t.TempDir(), "runtime-data")
	profile := localEnvironmentAppleSilicon128GBProfile()
	metalPlan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:           "local-image-native",
		ConsumerScope:    "stable-diffusion.cpp.metal",
		HostProfile:      profile,
		RuntimeDataRoot:  runtimeDataRoot,
		AssetID:          "image/test-sd",
		CompanionAssetID: "image/test-lora",
		ParentAssetID:    "image/test-sd",
	})
	metalDep := findLocalEnvironmentDependency(t, metalPlan, localEnvironmentFamilyNativeSDCPP)
	cpuDep := metalDep
	cpuDep.ConsumerScope = "stable-diffusion.cpp.cpu"
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{cpuDep})

	_, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   metalDep.EnvironmentKey,
		DependencyFamily: metalDep.DependencyFamily,
		DependencyId:     metalDep.DependencyID,
		Confirmed:        true,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want FailedPrecondition for ambiguous shared key", err)
	}

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   metalDep.EnvironmentKey,
		DependencyFamily: metalDep.DependencyFamily,
		DependencyId:     metalDep.DependencyID,
		SourceKind:       metalDep.SourceKind,
		Confirmed:        true,
		ConsumerScope:    metalDep.ConsumerScope,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob with consumer scope: %v", err)
	}
	if got := resp.GetJob().GetConsumerScope(); got != metalDep.ConsumerScope {
		t.Fatalf("started job consumer scope = %q, want %q", got, metalDep.ConsumerScope)
	}
}

func TestStartNativeSDCPPDependencyJobPromotesWindowsRuntimeWrapperSelectedSource(t *testing.T) {
	svc := newTestService(t)
	dep := nativeSDCPPPlanDependencyForTest(t, svc, stableDiffusionCUDAConsumerID, localEnvironmentNvidiaProfile())
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "canonical_runtime_wrapper",
			PackageFormat:     "direct_archive",
			LaunchMode:        "runtime_wrapper",
			CanonicalRoot:     `C:\nimi\runtime\managed-image-backends\sd-win-cuda12-x64-stablediffusion-ggml`,
			VerifiedArtifacts: []string{"sd.exe", "metadata.json"},
			Detail:            "managed image backend package verified from canonical_runtime_wrapper",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", job.GetState())
	}
	mgr := svc.engineManagerOrNil().(*mockEngineManager)
	if got := mgr.managedImageBackendConfigs[0].PackageSource; got != "canonical_runtime_wrapper" {
		t.Fatalf("requested package source = %q, want canonical_runtime_wrapper", got)
	}
	source, ok := svc.localEnvironmentSelectedSourceRecord(job.GetEnvironmentKey())
	if !ok {
		t.Fatal("expected selected source record")
	}
	if source.EnvironmentKey != dep.EnvironmentKey {
		t.Fatalf("selected source EnvironmentKey = %q, want plan key %q", source.EnvironmentKey, dep.EnvironmentKey)
	}
	if got := source.SelectedConsumers; len(got) != 1 || got[0] != "stable-diffusion.cpp.cuda" {
		t.Fatalf("selected consumers = %v, want stable-diffusion.cpp.cuda", got)
	}
	if source.Version != "canonical_runtime_wrapper" ||
		!stringSliceContains(source.CompatibilityEvidence, "package_format=direct_archive") ||
		!stringSliceContains(source.CompatibilityEvidence, "launch_mode=runtime_wrapper") {
		t.Fatalf("selected source is not canonical Windows runtime-wrapper evidence: %+v", source)
	}
}

func TestNativeSDCPPDependencyJobProjectsManagedBackendDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	dep := nativeSDCPPPlanDependencyForTest(t, svc, stableDiffusionCUDAConsumerID, localEnvironmentNvidiaProfile())
	release := make(chan struct{})
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendDependencyRelease: release,
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "canonical_runtime_wrapper",
			PackageFormat:     "direct_archive",
			LaunchMode:        "runtime_wrapper",
			CanonicalRoot:     `C:\nimi\runtime\managed-image-backends\sd-win-cuda12-x64-stablediffusion-ggml`,
			VerifiedArtifacts: []string{"sd.exe", "metadata.json"},
			Detail:            "managed image backend package verified from canonical_runtime_wrapper",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		job, ok := svc.localEnvironmentDependencyJob(resp.GetJob().GetJobId())
		if !ok {
			t.Fatalf("job %s not found", resp.GetJob().GetJobId())
		}
		if job.State == localEnvironmentStateDownloading && job.BytesReceived == 256 && job.BytesTotal == 1024 && job.Percent == 25 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("job did not project managed backend download progress: %+v", job)
		}
		time.Sleep(5 * time.Millisecond)
	}

	close(release)
	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", terminal.GetState())
	}
	if terminal.GetBytesReceived() != 0 || terminal.GetPercent() != 0 {
		t.Fatalf("terminal job retained stale progress: %+v", terminal)
	}
}

func TestStartNativeSDCPPDependencyJobRejectsOfficialDirectArchiveSource(t *testing.T) {
	svc := newTestService(t)
	dep := nativeSDCPPPlanDependencyForTest(t, svc, "stable-diffusion.cpp.metal", localEnvironmentAppleSilicon128GBProfile())
	svc.SetEngineManager(&mockEngineManager{
		managedImageBackendStatus: &engine.ManagedImageBackendDependencyStatus{
			BackendName:       "stablediffusion-ggml",
			PackageSource:     "experimental_official_sdcpp",
			PackageFormat:     "direct_archive",
			LaunchMode:        "runtime_wrapper",
			CanonicalRoot:     `/tmp/nimi/runtime/managed-image-backends/official-sdcpp`,
			VerifiedArtifacts: []string{"sd-cli"},
			Detail:            "official stable-diffusion.cpp archive should not satisfy W6 native chain",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   dep.EnvironmentKey,
		DependencyFamily: dep.DependencyFamily,
		DependencyId:     dep.DependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateRepairRequired || job.GetSelectedSourceRecordId() != "" {
		t.Fatalf("official direct archive must not promote selected source, got %+v", job)
	}
	if _, ok := svc.localEnvironmentSelectedSourceRecord(job.GetEnvironmentKey()); ok {
		t.Fatal("official direct archive must not leave a ready selected source record")
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
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
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

func TestNativeLlamaDependencyJobProjectsEngineDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	release := make(chan struct{})
	svc.SetEngineManager(&mockEngineManager{
		engineBinaryDependencyRelease: release,
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

	downloading := awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t, svc, resp.GetJob().GetJobId(), 300, 1200)
	if downloading.GetPercent() != 25 {
		t.Fatalf("download percent = %d, want 25", downloading.GetPercent())
	}
	close(release)

	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", terminal.GetState())
	}
	if terminal.GetBytesReceived() != 0 || terminal.GetPercent() != 0 {
		t.Fatalf("terminal job retained stale progress: %+v", terminal)
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
		EnvironmentKey:   "native-engine-package.llama|llama.cpp.package|host|windows/amd64|root|llama.cpp.cuda",
		DependencyFamily: localEnvironmentFamilyNativeLlama,
		DependencyId:     "llama.cpp.package",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", job.GetState())
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
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
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
	if got := source.GetSelectedConsumers(); len(got) != 1 || got[0] != "media.diffusers.cuda" {
		t.Fatalf("selected consumers = %v, want media.diffusers.cuda", got)
	}
}

func TestPythonUVDependencyJobProjectsDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	release := make(chan struct{})
	svc.SetEngineManager(&mockEngineManager{
		uvToolDependencyRelease: release,
		uvToolDependencyStatus: &engine.UVToolDependencyStatus{
			Version:          "0.11.8",
			ExecutablePath:   `C:\nimi\engines\uv\uv.exe`,
			SourceRoot:       `C:\nimi\engines\uv`,
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

	downloading := awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t, svc, resp.GetJob().GetJobId(), 128, 512)
	if downloading.GetPercent() != 25 {
		t.Fatalf("download percent = %d, want 25", downloading.GetPercent())
	}
	close(release)

	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed", terminal.GetState())
	}
	if terminal.GetBytesReceived() != 0 || terminal.GetPercent() != 0 {
		t.Fatalf("terminal job retained stale progress: %+v", terminal)
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
		EnvironmentKey:   "python.tool.uv|uv|host|windows/amd64|root|speech.qwen3-tts.python",
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateRepairRequired {
		t.Fatalf("job state = %q, want repair_required", job.GetState())
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledSkipsVerifiedInstalledAsset is
// the regression guard for the first-run model.asset materializer install seam:
// an installed asset whose bundle verifies under the current configured models
// root must not be re-downloaded.
func TestEnsureLocalEnvironmentModelAssetInstalledSkipsVerifiedInstalledAsset(t *testing.T) {
	svc := newTestService(t)
	server := failingHFDownloadServerForTest(t)
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	const assetID = "local/embed-installed"
	const logicalModelID = "nimi/embed-installed"
	const entry = "model.gguf"
	payload := validTestGGUF()
	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, payload),
	}
	bundleDir := writeResolvedModelBundleForTest(
		t,
		svc.resolvedLocalModelsPath(),
		logicalModelID,
		assetID,
		entry,
		payload,
	)
	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: filepath.Join(bundleDir, "asset.manifest.json"),
	})
	if err != nil {
		t.Fatalf("ImportLocalAsset: %v", err)
	}
	model := imported.GetAsset()

	if err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), model.GetAssetId()); err != nil {
		t.Fatalf("ensureLocalEnvironmentModelAssetInstalled for an installed asset: %v", err)
	}
	if err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), model.GetLocalAssetId()); err == nil {
		t.Fatal("local_asset_id must not be accepted as a model.asset dependency id")
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledRebindsAfterDataRootChange is
// the regression for a real macOS first-run failure: Product Control selected a
// new empty data root while the Runtime registry retained an installed asset
// row sourced from the previous root. The materializer must not treat that row
// as proof that the current root contains the model. It downloads into the
// current root, then rebinds the existing row in place so verification succeeds
// without creating an ambiguous duplicate asset.
func TestEnsureLocalEnvironmentModelAssetInstalledRebindsAfterDataRootChange(t *testing.T) {
	svc := newTestService(t)

	const assetID = "local/embed-data-root-rebind"
	const logicalModelID = "nimi/embed-data-root-rebind"
	const entry = "model.gguf"
	payload := validTestGGUF()
	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, payload),
	}

	oldModelsRoot := svc.resolvedLocalModelsPath()
	oldBundleDir := writeResolvedModelBundleForTest(
		t,
		oldModelsRoot,
		logicalModelID,
		assetID,
		entry,
		payload,
	)
	imported, err := svc.ImportLocalAsset(context.Background(), &runtimev1.ImportLocalAssetRequest{
		ManifestPath: filepath.Join(oldBundleDir, "asset.manifest.json"),
	})
	if err != nil {
		t.Fatalf("ImportLocalAsset from old data root: %v", err)
	}
	oldLocalAssetID := imported.GetAsset().GetLocalAssetId()
	svc.mu.Lock()
	svc.assets[oldLocalAssetID].Status = runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_UNHEALTHY
	svc.assets[oldLocalAssetID].HealthDetail = "entry missing under newly selected data root"
	svc.mu.Unlock()

	newModelsRoot := filepath.Join(t.TempDir(), "models")
	svc.localModelsPath = newModelsRoot
	if _, _, _, _, err := svc.verifyLocalEnvironmentModelAsset(context.Background(), assetID); err == nil {
		t.Fatal("precondition: stale registry row unexpectedly verified under the new empty data root")
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/"+entry {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	if err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), assetID); err != nil {
		t.Fatalf("ensureLocalEnvironmentModelAssetInstalled after data-root change: %v", err)
	}

	rebound := svc.installedAssetRecordForAssetID(assetID)
	if rebound == nil {
		t.Fatal("materializer did not retain an installed asset record")
	}
	if got := rebound.GetLocalAssetId(); got != oldLocalAssetID {
		t.Fatalf("materializer replaced local asset identity: got=%q want=%q", got, oldLocalAssetID)
	}
	if got := rebound.GetStatus(); got != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_INSTALLED {
		t.Fatalf("rebound status = %s, want INSTALLED", got)
	}
	if got := strings.TrimSpace(rebound.GetHealthDetail()); got != "" {
		t.Fatalf("rebound health detail was not cleared: %q", got)
	}
	if repo := strings.TrimSpace(rebound.GetSource().GetRepo()); strings.HasPrefix(repo, "file://"+oldModelsRoot) {
		t.Fatalf("materializer retained the old data-root source after rebind: %q", repo)
	}

	model, entryPath, entryHash, _, err := svc.verifyLocalEnvironmentModelAsset(context.Background(), assetID)
	if err != nil {
		t.Fatalf("verifyLocalEnvironmentModelAsset after rebind: %v", err)
	}
	if model == nil || entryHash == "" {
		t.Fatalf("verified rebound asset is incomplete: model=%v hash=%q", model, entryHash)
	}
	if !strings.HasPrefix(entryPath, newModelsRoot+string(filepath.Separator)) {
		t.Fatalf("rebound entry path = %q, want it under %q", entryPath, newModelsRoot)
	}

	activeRecords := 0
	svc.mu.RLock()
	for _, candidate := range svc.assets {
		if candidate != nil &&
			candidate.GetStatus() != runtimev1.LocalAssetStatus_LOCAL_ASSET_STATUS_REMOVED &&
			candidate.GetAssetId() == assetID {
			activeRecords++
		}
	}
	svc.mu.RUnlock()
	if activeRecords != 1 {
		t.Fatalf("active records for %q = %d, want exactly one rebound record", assetID, activeRecords)
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledFailsClosedOnCatalogMiss asserts
// the materializer install seam fails closed: a resolved asset id with neither
// an installed record nor a verified catalog descriptor returns an error so the
// materializer job fails rather than reporting pseudo-success.
func TestEnsureLocalEnvironmentModelAssetInstalledFailsClosedOnCatalogMiss(t *testing.T) {
	svc := newTestService(t)

	err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), "local.chat.no-such-asset")
	if err == nil {
		t.Fatal("expected ensureLocalEnvironmentModelAssetInstalled to fail closed on a catalog miss")
	}
	if status.Code(err) != codes.NotFound {
		t.Fatalf("expected a NotFound install failure, got %v", err)
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledIgnoresNonAssetSpecificID
// asserts a non-asset-specific dependency id (a resolver fail-close pack
// placeholder) is left for the verify step: no download is attempted and no
// hard failure is raised, so the job projects the established repair_required
// outcome rather than a download failure.
func TestEnsureLocalEnvironmentModelAssetInstalledIgnoresNonAssetSpecificID(t *testing.T) {
	svc := newTestService(t)

	if err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), "local-text.model-asset"); err != nil {
		t.Fatalf("expected a non-asset-specific dependency id to be ignored, got %v", err)
	}
}

// TestStartModelAssetDependencyJobFailsClosedWhenResolvedAssetUninstallable is
// the end-to-end regression for the first-run gap: the model.asset materializer
// job now drives the install seam, so a resolved asset id that cannot be
// installed (catalog miss) yields a `failed` job — not a silent repair_required
// with nothing downloaded.
func TestStartModelAssetDependencyJobFailsClosedWhenResolvedAssetUninstallable(t *testing.T) {
	svc := newTestService(t)

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "model.asset|local.chat.no-such-asset|host|darwin/arm64|root|llama.cpp.cpu",
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     "local.chat.no-such-asset",
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateFailed {
		t.Fatalf("job state = %q, want failed for an uninstallable resolved asset", job.GetState())
	}
}

// TestStartModelAssetDependencyJobDownloadsVerifiesAndReachesReadyManaged is the
// end-to-end regression for the fresh-install download-root bug and the
// install-vs-verify bundle layout reconciliation: a first-run model.asset
// materializer job downloads + stages the resolved catalog asset under the
// single config-sourced runtime models root (`resolvedLocalModelsPath()`), at
// the canonical `resolved/<logicalModelID>/` layout, then the verify path
// resolves that exact layout and the job reaches `ready_managed` — not a silent
// `repair_required` from a layout disagreement, and never a relative `resolved/`
// directory rooted at the runtime process CWD.
func TestStartModelAssetDependencyJobDownloadsVerifiesAndReachesReadyManaged(t *testing.T) {
	svc := newTestService(t)
	modelsRoot := svc.resolvedLocalModelsPath()

	payload := validTestGGUF()
	sum := sha256.Sum256(payload)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/Qwen/Qwen3-Embedding-8B-GGUF/resolve/main/model.gguf" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write(payload)
	}))
	defer func() { server.Close() }()
	svc.hfDownloadBaseURL = server.URL
	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		{
			TemplateId:     "local/embed-data-root",
			Title:          "Embedding Data Root",
			AssetId:        "local/embed-data-root",
			LogicalModelId: "nimi/embed-data-root",
			Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
			Engine:         "llama",
			Entry:          "model.gguf",
			Files:          []string{"model.gguf"},
			License:        "apache-2.0",
			Repo:           "Qwen/Qwen3-Embedding-8B-GGUF",
			Revision:       "main",
			Hashes:         map[string]string{"model.gguf": "sha256:" + hex.EncodeToString(sum[:])},
		},
	}

	// The plan layer still embeds the desktop-owned data root in the environment
	// key; the runtime no longer reads it back per-request — it stages under the
	// config-sourced models root.
	dataRoot := t.TempDir()
	dependencyID := "local/embed-data-root"
	environmentKey := localEnvironmentKey(
		localEnvironmentFamilyModelAsset,
		dependencyID,
		"host_data_root_test",
		"darwin/arm64",
		dataRoot,
	)
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyID:     dependencyID,
		ConsumerScope:    "llama.cpp.cuda",
	}})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     dependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())

	// The downloaded bundle is staged + activated by installManagedDownloadedModel
	// at `<modelsRoot>/resolved/<logicalModelID>/` — and the verify path resolves
	// that exact layout, so the job reaches ready_managed.
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed (download → verify → ready)", job.GetState())
	}
	stagedAsset := filepath.Join(
		runtimeManagedResolvedModelDir(modelsRoot, "nimi/embed-data-root"),
		"model.gguf",
	)
	if _, err := os.Stat(stagedAsset); err != nil {
		t.Fatalf("materializer job did not stage the asset under the configured models root %q: %v", modelsRoot, err)
	}
	if !strings.HasPrefix(stagedAsset, modelsRoot) {
		t.Fatalf("staged asset %q is not under the configured models root %q", stagedAsset, modelsRoot)
	}
	// The runtime CWD must never receive a relative `resolved/` staging dir —
	// that is the exact e2e regression this packet fixes.
	if cwd, err := os.Getwd(); err == nil {
		if entries, err := os.ReadDir(filepath.Join(cwd, "resolved")); err == nil && len(entries) > 0 {
			t.Fatalf("materializer job staged a relative resolved/ dir into the runtime CWD %q", cwd)
		}
	}
}

// writeResolvedModelBundleForTest stages a managed model bundle on disk at the
// canonical `<modelsRoot>/resolved/<logicalModelID>/` layout that a completed
// managed download produces: the GGUF artifact plus an `asset.manifest.json`
// whose `hashes` map records `sha256:<actual>` for each declared file. It
// returns the bundle directory.
func writeResolvedModelBundleForTest(
	t *testing.T,
	modelsRoot string,
	logicalModelID string,
	assetID string,
	entry string,
	payload []byte,
) string {
	t.Helper()
	bundleDir := runtimeManagedResolvedModelDir(modelsRoot, logicalModelID)
	if err := os.MkdirAll(bundleDir, 0o755); err != nil {
		t.Fatalf("mkdir resolved bundle dir: %v", err)
	}
	if err := os.WriteFile(filepath.Join(bundleDir, filepath.FromSlash(entry)), payload, 0o644); err != nil {
		t.Fatalf("write resolved bundle artifact: %v", err)
	}
	sum := sha256.Sum256(payload)
	manifest := managedModelManifestDescriptor{
		assetID:        assetID,
		kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
		logicalModelID: logicalModelID,
		capabilities:   []string{"text.embed"},
		engine:         "llama",
		entry:          entry,
		files:          []string{entry},
		license:        "apache-2.0",
		repo:           "Qwen/Qwen3-Embedding-8B-GGUF",
		revision:       "main",
		hashes:         map[string]string{entry: "sha256:" + hex.EncodeToString(sum[:])},
		integrityMode:  "verified",
	}
	if err := writeModelManifest(filepath.Join(bundleDir, "asset.manifest.json"), manifest); err != nil {
		t.Fatalf("write resolved bundle manifest: %v", err)
	}
	return bundleDir
}

// verifiedEmbeddingDescriptorForTest builds the verified catalog descriptor that
// is the K-LOCAL-010 SSOT for the adoption hash-verification authority.
func verifiedEmbeddingDescriptorForTest(assetID string, logicalModelID string, entry string, payload []byte) *runtimev1.LocalVerifiedAssetDescriptor {
	sum := sha256.Sum256(payload)
	return &runtimev1.LocalVerifiedAssetDescriptor{
		TemplateId:     assetID,
		Title:          "Embedding Adopt Bundle",
		AssetId:        assetID,
		LogicalModelId: logicalModelID,
		Kind:           runtimev1.LocalAssetKind_LOCAL_ASSET_KIND_EMBEDDING,
		Engine:         "llama",
		Entry:          entry,
		Files:          []string{entry},
		License:        "apache-2.0",
		Repo:           "Qwen/Qwen3-Embedding-8B-GGUF",
		Revision:       "main",
		Hashes:         map[string]string{entry: "sha256:" + hex.EncodeToString(sum[:])},
	}
}

// failingHFDownloadServerForTest returns an HTTP server that fails the test if
// any model file is requested — the adoption guarantee is ZERO download.
func failingHFDownloadServerForTest(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		t.Errorf("materializer issued a model download when a valid bundle was already on disk")
		http.Error(w, "no download expected", http.StatusInternalServerError)
	}))
}

// unavailableHFDownloadServerForTest keeps negative materialization tests on a
// deterministic local endpoint. A 404 is non-retryable, so the tests exercise
// the download fallthrough without contacting the public catalog.
func unavailableHFDownloadServerForTest() *httptest.Server {
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "model unavailable", http.StatusNotFound)
	}))
}

// TestEnsureLocalEnvironmentModelAssetInstalledAdoptsExistingBundle is the
// idempotent-materialization regression: when `~/.nimi` is cleared (empty
// in-memory registry) but the data-root bundle is intact, the materializer
// adopts the on-disk bundle and performs ZERO download.
func TestEnsureLocalEnvironmentModelAssetInstalledAdoptsExistingBundle(t *testing.T) {
	svc := newTestService(t)
	server := failingHFDownloadServerForTest(t)
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	modelsRoot := svc.resolvedLocalModelsPath()
	const assetID = "local/embed-adopt"
	const logicalModelID = "nimi/embed-adopt"
	const entry = "model.gguf"
	payload := validTestGGUF()

	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, payload),
	}
	writeResolvedModelBundleForTest(t, modelsRoot, logicalModelID, assetID, entry, payload)

	// The registry is empty (no installed record) — the asset is only on disk.
	if svc.installedAssetRecordForAssetID(assetID) != nil {
		t.Fatal("precondition: asset must not be in the in-memory registry")
	}

	if err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), ""+assetID); err != nil {
		t.Fatalf("ensureLocalEnvironmentModelAssetInstalled: %v", err)
	}

	// Adoption must have registered the asset record from the on-disk manifest.
	adopted := svc.installedAssetRecordForAssetID(assetID)
	if adopted == nil {
		t.Fatal("materializer did not adopt the on-disk bundle into the registry")
	}
	if got := strings.TrimSpace(adopted.GetAssetId()); got != assetID {
		t.Fatalf("adopted asset id = %q, want %q", got, assetID)
	}

	// The adopted record must pass the materializer verify step and yield a
	// resolved entry — the job would then reach ready_managed.
	model, entryPath, entryHash, _, err := svc.verifyLocalEnvironmentModelAsset(context.Background(), ""+assetID)
	if err != nil {
		t.Fatalf("verifyLocalEnvironmentModelAsset on the adopted record: %v", err)
	}
	if model == nil || strings.TrimSpace(entryPath) == "" || strings.TrimSpace(entryHash) == "" {
		t.Fatalf("verify of adopted record returned incomplete result (path=%q hash=%q)", entryPath, entryHash)
	}
}

// TestStartModelAssetDependencyJobAdoptsExistingBundleReachesReadyManaged is the
// end-to-end idempotent-materialization regression: a first-run model.asset job
// over a pre-placed valid bundle reaches `ready_managed` with ZERO download.
func TestStartModelAssetDependencyJobAdoptsExistingBundleReachesReadyManaged(t *testing.T) {
	svc := newTestService(t)
	server := failingHFDownloadServerForTest(t)
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	modelsRoot := svc.resolvedLocalModelsPath()
	const assetID = "local/embed-adopt-e2e"
	const logicalModelID = "nimi/embed-adopt-e2e"
	const entry = "model.gguf"
	payload := validTestGGUF()

	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, payload),
	}
	writeResolvedModelBundleForTest(t, modelsRoot, logicalModelID, assetID, entry, payload)

	dependencyID := "" + assetID
	environmentKey := localEnvironmentKey(
		localEnvironmentFamilyModelAsset, dependencyID, "host_adopt_test", "darwin/arm64", t.TempDir(),
	)
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyID:     dependencyID,
		ConsumerScope:    "llama.cpp.cuda",
	}})
	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyModelAsset,
		DependencyId:     dependencyID,
		Confirmed:        true,
	})
	if err != nil {
		t.Fatalf("StartLocalEnvironmentDependencyJob: %v", err)
	}
	job := awaitLocalEnvironmentDependencyJobTerminal(t, svc, resp.GetJob().GetJobId())
	if job.GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("job state = %q, want ready_managed (adopt → verify → ready)", job.GetState())
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledDoesNotAdoptCorruptBundle is the
// fail-closed regression: a pre-placed bundle whose artifact hash does not match
// the catalog-admitted sha256 is NEVER adopted — the materializer falls through
// to the download path.
func TestEnsureLocalEnvironmentModelAssetInstalledDoesNotAdoptCorruptBundle(t *testing.T) {
	svc := newTestService(t)
	server := unavailableHFDownloadServerForTest()
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	modelsRoot := svc.resolvedLocalModelsPath()
	const assetID = "local/embed-adopt-corrupt"
	const logicalModelID = "nimi/embed-adopt-corrupt"
	const entry = "model.gguf"
	catalogPayload := validTestGGUF()

	// The catalog descriptor's admitted hash is over catalogPayload, but the
	// on-disk artifact carries different bytes — a hash mismatch.
	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, catalogPayload),
	}
	corruptPayload := append(validTestGGUF(), []byte("tampered-tail")...)
	writeResolvedModelBundleForTest(t, modelsRoot, logicalModelID, assetID, entry, corruptPayload)

	// The local endpoint rejects the download, proving the corrupt bundle was
	// NOT adopted (an adoption would have returned nil).
	err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), ""+assetID)
	if err == nil {
		t.Fatal("expected the materializer to fall through to download (not adopt a hash-mismatched bundle)")
	}
	if svc.installedAssetRecordForAssetID(assetID) != nil {
		t.Fatal("a hash-mismatched bundle must never be adopted into the registry")
	}
}

// TestEnsureLocalEnvironmentModelAssetInstalledDoesNotAdoptIncompleteBundle is
// the fail-closed regression for a bundle with a manifest but a missing declared
// artifact: it is NEVER adopted and falls through to the download path.
func TestEnsureLocalEnvironmentModelAssetInstalledDoesNotAdoptIncompleteBundle(t *testing.T) {
	svc := newTestService(t)
	server := unavailableHFDownloadServerForTest()
	defer server.Close()
	svc.hfDownloadBaseURL = server.URL

	modelsRoot := svc.resolvedLocalModelsPath()
	const assetID = "local/embed-adopt-incomplete"
	const logicalModelID = "nimi/embed-adopt-incomplete"
	const entry = "model.gguf"
	payload := validTestGGUF()

	svc.verified = []*runtimev1.LocalVerifiedAssetDescriptor{
		verifiedEmbeddingDescriptorForTest(assetID, logicalModelID, entry, payload),
	}
	// Stage the bundle, then delete the artifact so only the manifest remains.
	bundleDir := writeResolvedModelBundleForTest(t, modelsRoot, logicalModelID, assetID, entry, payload)
	if err := os.Remove(filepath.Join(bundleDir, entry)); err != nil {
		t.Fatalf("remove bundle artifact: %v", err)
	}

	err := svc.ensureLocalEnvironmentModelAssetInstalled(context.Background(), ""+assetID)
	if err == nil {
		t.Fatal("expected the materializer to fall through to download for an incomplete bundle")
	}
	if svc.installedAssetRecordForAssetID(assetID) != nil {
		t.Fatal("an incomplete bundle must never be adopted into the registry")
	}
}
