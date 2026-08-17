package localservice

import (
	"context"
	"fmt"
	"log/slog"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"github.com/nimiplatform/nimi/runtime/internal/filedownload"
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

func TestApplyLocalEnvironmentPlanRequiresCapabilityConfirmation(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.ApplyLocalEnvironmentPlan(context.Background(), &runtimev1.ApplyLocalEnvironmentPlanRequest{
		Resolution: &runtimev1.ResolveLocalEnvironmentPlanRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract},
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("ApplyLocalEnvironmentPlan error = %v, want FailedPrecondition", err)
	}
	if got := len(svc.localEnvironmentDependencyJobs); got != 0 {
		t.Fatalf("ApplyLocalEnvironmentPlan admitted %d jobs before confirmation, want 0", got)
	}
}

func TestApplyLocalEnvironmentPlanRejectsChangedCompletePlanBeforeAdmission(t *testing.T) {
	svc := newTestService(t)
	selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.LlamaCapabilityContract, capabilitydriver.LlamaGemma4E2BRecipeID, capabilitydriver.Identity{
		ImplementationID: capabilitydriver.LlamaImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    capabilitydriver.LlamaDriverDialect,
	})

	_, err := svc.ApplyLocalEnvironmentPlan(context.Background(), &runtimev1.ApplyLocalEnvironmentPlanRequest{
		Resolution:     &runtimev1.ResolveLocalEnvironmentPlanRequest{CapabilityContract: capabilitydriver.LlamaCapabilityContract},
		ExpectedPlanId: "localenv_plan_stale",
		Confirmed:      true,
	})
	if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "plan changed after confirmation") {
		t.Fatalf("ApplyLocalEnvironmentPlan error = %v, want stale-plan FailedPrecondition", err)
	}
	if got := len(svc.localEnvironmentDependencyJobs); got != 0 {
		t.Fatalf("ApplyLocalEnvironmentPlan admitted %d jobs for a stale complete plan, want 0", got)
	}
}

func TestLocalEnvironmentPlanIdentityBindsRequiredDAGWithoutBindingTransientState(t *testing.T) {
	base := localEnvironmentPlan{
		PackID:                     "local-speech",
		HostProfileID:              "host-profile",
		PlatformTuple:              "windows/amd64/cuda",
		RuntimeDataRoot:            `D:\Nimi`,
		ConsumerScope:              "speech.qwen3-tts.python",
		CloudOnlyImpact:            "none",
		RequiredDependencyFamilies: []string{localEnvironmentFamilyPythonRuntime},
		AggregateSizeKnown:         false,
		StorageCategories:          []string{"environments"},
		SourceOwners:               []string{"RuntimeLocalService"},
		NoSystemMutation:           true,
		Dependencies: []localEnvironmentPlanDependency{{
			EnvironmentKey:   "python.runtime|python-3.12-cp312|runtime-root",
			DependencyFamily: localEnvironmentFamilyPythonRuntime,
			DependencyID:     "python-3.12-cp312",
			ConsumerScope:    "speech.qwen3-tts.python",
			Required:         true,
			State:            "missing",
			SourceKind:       localEnvironmentSourceManaged,
		}},
	}
	confirmedID := localEnvironmentPlanIdentity(base)
	progressed := base
	progressed.Dependencies = append([]localEnvironmentPlanDependency(nil), base.Dependencies...)
	progressed.Dependencies[0].State = localEnvironmentStateInstalling
	if got := localEnvironmentPlanIdentity(progressed); got != confirmedID {
		t.Fatalf("transient execution state changed confirmed DAG identity: before=%q after=%q", confirmedID, got)
	}
	changed := base
	changed.Dependencies = append([]localEnvironmentPlanDependency(nil), base.Dependencies...)
	changed.Dependencies[0].DependencyID = "python-3.13-cp313"
	if got := localEnvironmentPlanIdentity(changed); got == confirmedID {
		t.Fatalf("required dependency identity change retained stale plan id %q", got)
	}
}

func TestPrepareLocalEnvironmentPlanApplyRestartsUnpromotedRepairAndPrerequisiteFailure(t *testing.T) {
	svc := newTestService(t)
	const consumer = "speech.qwen3-tts.python.cuda"
	dependencies := []localEnvironmentPlanDependency{
		{
			EnvironmentKey:   "python.package-set|profile-current|runtime-root",
			DependencyFamily: localEnvironmentFamilyPythonPackageSet,
			DependencyID:     "profile-current",
			ConsumerScope:    consumer,
			Required:         true,
			State:            localEnvironmentStateRepairRequired,
			SourceKind:       localEnvironmentSourceManaged,
		},
		{
			EnvironmentKey:   "python.torch-wheel|torch-current|runtime-root",
			DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
			DependencyID:     "torch-current",
			ConsumerScope:    consumer,
			Required:         true,
			State:            localEnvironmentStateFailed,
			SourceKind:       localEnvironmentSourceManaged,
		},
	}
	svc.rememberLocalEnvironmentPlanDependencyContracts(dependencies)
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs["historical-repair"] = localEnvironmentDependencyJobState{
		JobID:               "historical-repair",
		EnvironmentKey:      dependencies[0].EnvironmentKey,
		DependencyFamily:    dependencies[0].DependencyFamily,
		DependencyID:        dependencies[0].DependencyID,
		ConsumerScope:       consumer,
		State:               localEnvironmentStateRepairRequired,
		SourceKind:          localEnvironmentSourceManaged,
		RecoveryDisposition: localEnvironmentJobRecoveryRepairRequired,
		UpdatedAt:           "2026-08-10T00:00:01Z",
	}
	svc.localEnvironmentDependencyJobs["historical-prerequisite-failure"] = localEnvironmentDependencyJobState{
		JobID:               "historical-prerequisite-failure",
		EnvironmentKey:      dependencies[1].EnvironmentKey,
		DependencyFamily:    dependencies[1].DependencyFamily,
		DependencyID:        dependencies[1].DependencyID,
		ConsumerScope:       consumer,
		State:               localEnvironmentStateFailed,
		SourceKind:          localEnvironmentSourceManaged,
		Retryable:           false,
		ReasonCode:          "LOCAL_ENVIRONMENT_DEPENDENCY_PREREQUISITE_FAILED",
		RecoveryDisposition: localEnvironmentJobRecoveryNotRetryable,
		UpdatedAt:           "2026-08-10T00:00:02Z",
	}
	svc.mu.Unlock()

	actions, err := svc.prepareLocalEnvironmentPlanApplyActions(localEnvironmentPlan{Dependencies: dependencies})
	if err != nil {
		t.Fatalf("prepareLocalEnvironmentPlanApplyActions: %v", err)
	}
	if len(actions) != 2 || actions[0].Kind != localEnvironmentPlanApplyStart || actions[1].Kind != localEnvironmentPlanApplyStart {
		t.Fatalf("repair/prerequisite-failure plan actions = %+v, want two fresh start admissions", actions)
	}
}

func TestPrepareLocalEnvironmentPlanApplyRejectsCurrentNonRetryableFailureBeforeAdmission(t *testing.T) {
	svc := newTestService(t)
	dependency := localEnvironmentPlanDependency{
		EnvironmentKey:   "python.torch-wheel|torch-failed|runtime-root",
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyID:     "torch-failed",
		ConsumerScope:    "speech.qwen3-tts.python.cuda",
		Required:         true,
		State:            localEnvironmentStateFailed,
		SourceKind:       localEnvironmentSourceManaged,
	}
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{dependency})
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs["current-failed"] = localEnvironmentDependencyJobState{
		JobID:               "current-failed",
		EnvironmentKey:      dependency.EnvironmentKey,
		DependencyFamily:    dependency.DependencyFamily,
		DependencyID:        dependency.DependencyID,
		ConsumerScope:       dependency.ConsumerScope,
		State:               localEnvironmentStateFailed,
		SourceKind:          localEnvironmentSourceManaged,
		Retryable:           false,
		RecoveryDisposition: localEnvironmentJobRecoveryNotRetryable,
		UpdatedAt:           "2026-08-10T00:00:00Z",
	}
	before := len(svc.localEnvironmentDependencyJobs)
	svc.mu.Unlock()

	_, err := svc.prepareLocalEnvironmentPlanApplyActions(localEnvironmentPlan{Dependencies: []localEnvironmentPlanDependency{dependency}})
	if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "not retryable") {
		t.Fatalf("prepareLocalEnvironmentPlanApplyActions error = %v, want non-retryable FailedPrecondition", err)
	}
	if got := len(svc.localEnvironmentDependencyJobs); got != before {
		t.Fatalf("failed complete-DAG preflight mutated jobs: before=%d after=%d", before, got)
	}
}

func TestPrepareLocalEnvironmentPlanApplyRestartsFailedNativeSDCPPAfterCUDAReady(t *testing.T) {
	svc := newTestService(t)
	consumer := stableDiffusionCUDAConsumerID
	dependency := nativeSDCPPPlanDependencyForTest(t, svc, consumer, localEnvironmentNvidiaProfile())
	dependency.State = localEnvironmentStateFailed
	upsertReadyPythonPrerequisiteForTest(t, svc, localEnvironmentSelectedSourceRecordState{
		DependencyFamily:  localEnvironmentFamilyCUDA,
		DependencyID:      cudaUserSpaceRuntimeDependencyID,
		EnvironmentKey:    "accelerator.cuda.runtime|ready-after-backend-failure",
		SourceKind:        localEnvironmentSourceManaged,
		SelectedConsumers: []string{consumer},
	})
	svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{dependency})
	svc.mu.Lock()
	svc.localEnvironmentDependencyJobs["failed-before-cuda-ready"] = localEnvironmentDependencyJobState{
		JobID:               "failed-before-cuda-ready",
		EnvironmentKey:      dependency.EnvironmentKey,
		DependencyFamily:    dependency.DependencyFamily,
		DependencyID:        dependency.DependencyID,
		ConsumerScope:       consumer,
		State:               localEnvironmentStateFailed,
		SourceKind:          localEnvironmentSourceManaged,
		Retryable:           false,
		RecoveryDisposition: localEnvironmentJobRecoveryNotRetryable,
		UpdatedAt:           "2026-08-16T00:00:00Z",
	}
	svc.mu.Unlock()

	actions, err := svc.prepareLocalEnvironmentPlanApplyActions(localEnvironmentPlan{
		Dependencies: []localEnvironmentPlanDependency{dependency},
	})
	if err != nil {
		t.Fatalf("prepareLocalEnvironmentPlanApplyActions: %v", err)
	}
	if len(actions) != 1 || actions[0].Kind != localEnvironmentPlanApplyStart {
		t.Fatalf("native backend recovery actions = %+v, want one fresh start admission", actions)
	}
}

func TestStartLocalEnvironmentDependencyProfileJobRequiresRememberedPlanContract(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.venv|python-profile.forged|runtime-root",
		DependencyFamily: localEnvironmentFamilyPythonVenv,
		DependencyId:     "python-profile.forged",
		ConsumerScope:    "speech.tts",
		Confirmed:        true,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want FailedPrecondition without remembered plan contract", err)
	}
}

func TestStartPythonTorchWheelJobRequiresRememberedPlanContract(t *testing.T) {
	svc := newTestService(t)

	_, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.torch-wheel|forged",
		DependencyFamily: localEnvironmentFamilyPythonTorchWheel,
		DependencyId:     "python.torch-wheel.forged",
		ConsumerScope:    "speech.qwen3-tts.python.cuda",
		Confirmed:        true,
	})
	if status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want FailedPrecondition without remembered Torch plan contract", err)
	}
}

func TestStartLocalEnvironmentDependencyProfileJobRequiresExactRememberedPlanContract(t *testing.T) {
	const (
		environmentKey = "python.package-set|python-profile.expected|runtime-root"
		dependencyID   = "python-profile.expected"
		consumerScope  = "speech.tts"
	)

	for _, test := range []struct {
		name           string
		environmentKey string
		dependencyID   string
		consumerScope  string
		wantAdmission  bool
	}{
		{name: "exact", environmentKey: environmentKey, dependencyID: dependencyID, consumerScope: consumerScope, wantAdmission: true},
		{name: "environment key mismatch", environmentKey: environmentKey + ".forged", dependencyID: dependencyID, consumerScope: consumerScope},
		{name: "dependency id mismatch", environmentKey: environmentKey, dependencyID: dependencyID + ".forged", consumerScope: consumerScope},
		{name: "consumer mismatch", environmentKey: environmentKey, dependencyID: dependencyID, consumerScope: "speech.asr.package"},
	} {
		t.Run(test.name, func(t *testing.T) {
			svc := newTestService(t)
			svc.rememberLocalEnvironmentPlanDependencyContracts([]localEnvironmentPlanDependency{{
				EnvironmentKey:   environmentKey,
				DependencyFamily: localEnvironmentFamilyPythonPackageSet,
				DependencyID:     dependencyID,
				ConsumerScope:    consumerScope,
			}})

			resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
				EnvironmentKey:   test.environmentKey,
				DependencyFamily: localEnvironmentFamilyPythonPackageSet,
				DependencyId:     test.dependencyID,
				ConsumerScope:    test.consumerScope,
				Confirmed:        true,
			})
			if test.wantAdmission {
				if err != nil {
					t.Fatalf("StartLocalEnvironmentDependencyJob exact contract: %v", err)
				}
				if got := resp.GetJob().GetConsumerScope(); got != consumerScope {
					t.Fatalf("started job consumer scope = %q, want %q", got, consumerScope)
				}
				return
			}
			if status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("StartLocalEnvironmentDependencyJob error = %v, want FailedPrecondition for contract mismatch", err)
			}
		})
	}
}

func TestRetryLocalEnvironmentDependencyProfileJobRequiresExactRememberedPlanContract(t *testing.T) {
	const (
		environmentKey = "python.runtime|python.runtime|runtime-root"
		dependencyID   = "python.runtime"
		consumerScope  = "speech.qwen3-asr.python"
	)
	svc := newTestService(t)
	started, err := svc.startLocalEnvironmentDependencyJob(context.Background(), localEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonRuntime,
		DependencyID:     dependencyID,
		ConsumerScope:    consumerScope,
		SourceKind:       localEnvironmentSourceManaged,
	}, func(context.Context, localEnvironmentDependencyJobState, localEnvironmentDependencyJobProgressReporter) (localEnvironmentDependencyJobResult, error) {
		return localEnvironmentDependencyJobResult{}, fmt.Errorf("download Python runtime: %w", filedownload.ErrTransientAttemptsExhausted)
	})
	if err != nil {
		t.Fatalf("seed retryable Python dependency job: %v", err)
	}
	failed := pollLocalEnvironmentDependencyJobToTerminal(t, svc, started.JobID)
	if !failed.Retryable {
		t.Fatalf("seeded Python dependency job retryable = false, want true")
	}
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonRuntime, dependencyID, environmentKey, "media.diffusers.cpu")

	_, err = svc.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
		JobId:     failed.JobID,
		Confirmed: true,
	})
	if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "retry is not admitted by the current plan") {
		t.Fatalf("RetryLocalEnvironmentDependencyJob error = %v, want exact-contract FailedPrecondition", err)
	}
}

func TestRetryLocalEnvironmentDependencyProfileJobRejectsDeterministicContractFailure(t *testing.T) {
	svc := newTestService(t)
	failed := startFailedLocalEnvironmentDependencyJobForTest(t, svc, localEnvironmentDependencyJobRequest{
		EnvironmentKey:   "python.package-set|python-profile.expected|runtime-root",
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyID:     "python-profile.expected",
		ConsumerScope:    "speech.qwen3-asr.python",
		SourceKind:       localEnvironmentSourceManaged,
	}, "immutable dependency profile lock/source identity mismatch")
	if failed.Retryable {
		t.Fatalf("deterministic profile failure projected retryable: %+v", failed)
	}

	_, err := svc.RetryLocalEnvironmentDependencyJob(context.Background(), &runtimev1.RetryLocalEnvironmentDependencyJobRequest{
		JobId:     failed.JobID,
		Confirmed: true,
	})
	if status.Code(err) != codes.FailedPrecondition || !strings.Contains(err.Error(), "job is not retryable") {
		t.Fatalf("RetryLocalEnvironmentDependencyJob error = %v, want non-retryable FailedPrecondition", err)
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
		ensureManagedImageBackendErr: fmt.Errorf("download failed: %w", filedownload.ErrTransientAttemptsExhausted),
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
	svc.SetEngineManager(&mockEngineManager{
		ensureManagedImageBackendErr: fmt.Errorf("download backend: %w", filedownload.ErrTransientAttemptsExhausted),
	})
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

func TestRepairPythonPackageSetMarksCanonicalSourceAcrossRestart(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "local-state.json")
	runtimeDataRoot := filepath.Join(dir, "runtime-data")
	svc, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("new service: %v", err)
	}

	const (
		dependencyID  = "python-profile.shared"
		imageConsumer = "media.diffusers.cuda"
		videoConsumer = "media.video-python.cuda"
	)
	environmentKey := localEnvironmentPythonProfileKey(localEnvironmentFamilyPythonPackageSet, dependencyID, runtimeDataRoot)
	profileRoot := filepath.Join(runtimeDataRoot, "environments", "python-profiles", "shared")
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily:      localEnvironmentFamilyPythonPackageSet,
		DependencyID:          dependencyID,
		EnvironmentKey:        environmentKey,
		CanonicalRoot:         profileRoot,
		Version:               "shared-profile-digest",
		CompatibilityEvidence: []string{"profile_digest=shared-profile-digest"},
		VerifiedArtifacts:     []string{filepath.Join(profileRoot, "media-driver.py")},
		Hashes:                map[string]string{"profile_digest": "shared-profile-digest"},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	record = svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, record, imageConsumer)
	recordReadyPythonPackageSetConsumptionJobForTest(svc, record, videoConsumer)

	resp, err := svc.RepairLocalEnvironmentDependency(context.Background(), &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonPackageSet,
		DependencyId:     dependencyID,
		ConsumerScope:    imageConsumer,
		Confirmed:        true,
		ReasonCode:       "consumer_driver_drift",
	})
	if err != nil {
		t.Fatalf("RepairLocalEnvironmentDependency: %v", err)
	}
	if got := resp.GetJob().GetConsumerScope(); got != imageConsumer {
		t.Fatalf("repair job consumer = %q, want %q", got, imageConsumer)
	}
	cancelled, err := svc.CancelLocalEnvironmentDependencyJob(context.Background(), &runtimev1.CancelLocalEnvironmentDependencyJobRequest{
		JobId: resp.GetJob().GetJobId(),
	})
	if err != nil {
		t.Fatalf("CancelLocalEnvironmentDependencyJob: %v", err)
	}
	if got := cancelled.GetJob().GetState(); got != localEnvironmentStateCancelled {
		t.Fatalf("cancelled repair job state = %q, want %q", got, localEnvironmentStateCancelled)
	}

	assertCanonicalRepair := func(t *testing.T, current *Service) {
		t.Helper()
		raw, ok := current.localEnvironmentSelectedSourceRecord(environmentKey)
		if !ok {
			t.Fatal("shared package-set record missing")
		}
		if !isLocalEnvironmentRepairActive(raw.RepairState) {
			t.Fatalf("canonical profile repair state = %q, want repair_required", raw.RepairState)
		}
		if len(raw.SelectedConsumers) != 0 {
			t.Fatalf("canonical Python selected source owns consumers: %v", raw.SelectedConsumers)
		}
		if len(raw.ActivationEnvDelta) != 0 {
			t.Fatalf("canonical Python selected source owns activation delta: %v", raw.ActivationEnvDelta)
		}
	}
	assertCanonicalRepair(t, svc)
	svc.Close()

	restored, err := New(slog.Default(), nil, statePath, 10, runtimeDataRoot)
	if err != nil {
		t.Fatalf("restore service: %v", err)
	}
	defer func() { restored.Close() }()
	assertCanonicalRepair(t, restored)
}

func nativeSDCPPPlanDependencyForTest(t *testing.T, svc *Service, consumer string, profile *runtimev1.LocalDeviceProfile) localEnvironmentPlanDependency {
	t.Helper()
	plan := svc.resolveLocalEnvironmentPlan(localEnvironmentPlanRequest{
		PackID:          "local-image-native",
		ConsumerScope:   consumer,
		HostProfile:     profile,
		RuntimeDataRoot: filepath.Join(t.TempDir(), "runtime-data"),
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
		PackID:          "local-image-native",
		ConsumerScope:   "stable-diffusion.cpp.metal",
		HostProfile:     profile,
		RuntimeDataRoot: runtimeDataRoot,
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
			Detail:            "official stable-diffusion.cpp archive should not satisfy the managed native chain",
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
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	environmentKey := localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonUV, "uv", environmentKey, consumer)
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
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		ConsumerScope:    consumer,
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
	if got := source.GetSelectedConsumers(); len(got) != 0 {
		t.Fatalf("canonical uv selected source owns consumers: %v", got)
	}
}

func TestPythonUVDependencyJobProjectsDownloadProgress(t *testing.T) {
	svc := newTestService(t)
	consumer, identity := currentMediaPythonDependencyProfileForTest(t)
	environmentKey := localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonUV, "uv", environmentKey, consumer)
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
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		ConsumerScope:    consumer,
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
	consumer := "speech.qwen3-tts.python"
	identity := currentPythonDependencyProfileIdentityForTest(t, consumer)
	environmentKey := localEnvironmentManagedUVKey(identity.PlatformTuple, svc.localEnvironmentRuntimeDataRoot())
	rememberPythonDependencyJobContractForTest(svc, localEnvironmentFamilyPythonUV, "uv", environmentKey, consumer)
	svc.SetEngineManager(&mockEngineManager{
		uvToolDependencyStatus: &engine.UVToolDependencyStatus{
			ExecutablePath: "uv.exe",
			ArchiveSHA256:  "abc123",
		},
	})

	resp, err := svc.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey:   environmentKey,
		DependencyFamily: localEnvironmentFamilyPythonUV,
		DependencyId:     "uv",
		ConsumerScope:    consumer,
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
