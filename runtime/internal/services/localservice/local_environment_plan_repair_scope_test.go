package localservice

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/engine"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Exercise public plan admission without claiming dependency materialization.
// The manager reports failed supply and starts no external process.
func TestPlanApplyRetriesCancelledConsumerWithoutRepairingAnotherConsumerSource(t *testing.T) {
	ctx := context.Background()
	svc := newTestService(t)
	defer svc.Close()
	svc.SetEngineManager(&mockEngineManager{sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
		DependencyID: cudaUserSpaceRuntimeDependencyID,
		State:        engine.SharedAcceleratorDependencyFailed,
		Source:       "runtime_managed",
		Detail:       "fixture: dependency verification failed",
	}})
	selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.TextEmbedCapabilityContract, capabilitydriver.LlamaEmbedGGUFRecipeID, capabilitydriver.Identity{
		ImplementationID: capabilitydriver.LlamaEmbedImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    capabilitydriver.LlamaEmbedDriverDialect,
	})
	resolution := &runtimev1.ResolveLocalEnvironmentPlanRequest{
		CapabilityContract: capabilitydriver.TextEmbedCapabilityContract,
		HostProfile:        localEnvironmentNvidiaProfile(),
	}
	initial, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
	if err != nil {
		t.Fatal(err)
	}
	var cuda, native *runtimev1.LocalEnvironmentPlanDependency
	for _, dep := range initial.GetPlan().GetDependencies() {
		switch dep.GetDependencyFamily() {
		case localEnvironmentFamilyCUDA:
			cuda = dep
		case localEnvironmentFamilyNativeLlama:
			native = dep
		}
	}
	if cuda == nil || native == nil || !cuda.GetRequired() || cuda.GetConsumerScope() != "llama.cpp.cuda" {
		t.Fatalf("public plan did not resolve supported CUDA consumer: %+v", initial.GetPlan())
	}
	request := func(dep *runtimev1.LocalEnvironmentPlanDependency) localEnvironmentDependencyJobRequest {
		return localEnvironmentDependencyJobRequest{
			EnvironmentKey: dep.GetEnvironmentKey(), DependencyFamily: dep.GetDependencyFamily(),
			DependencyID: dep.GetDependencyId(), ConsumerScope: dep.GetConsumerScope(),
			SourceKind: localEnvironmentSourceManaged,
		}
	}
	// An earlier caller cancelled this consumer's setup before source promotion.
	cancelled, err := svc.startLocalEnvironmentDependencyJob(ctx, request(cuda), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CancelLocalEnvironmentDependencyJob(ctx, &runtimev1.CancelLocalEnvironmentDependencyJobRequest{JobId: cancelled.JobID}); err != nil {
		t.Fatal(err)
	}
	// Keep the independent native dependency at its existing active job so this
	// probe does not ask its materializer to run.
	if _, err := svc.startLocalEnvironmentDependencyJob(ctx, request(native), nil); err != nil {
		t.Fatal(err)
	}

	// Another supported consumer has the same physical CUDA key and owns the
	// selected source; no llama consumption has ever been promoted for it.
	svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: cuda.GetDependencyId(),
		EnvironmentKey: cuda.GetEnvironmentKey(), SourceKind: localEnvironmentSourceManaged,
		CanonicalRoot:     filepath.Join(svc.runtimeDataRoot, "dependencies", "cuda"),
		SelectedConsumers: []string{stableDiffusionCUDAConsumerID},
	}))
	repair, err := svc.RepairLocalEnvironmentDependency(ctx, &runtimev1.RepairLocalEnvironmentDependencyRequest{
		EnvironmentKey: cuda.GetEnvironmentKey(), DependencyFamily: localEnvironmentFamilyCUDA,
		DependencyId: cuda.GetDependencyId(), ConsumerScope: stableDiffusionCUDAConsumerID,
		Confirmed: true, ReasonCode: "test_verification_failed",
	})
	if err != nil {
		t.Fatal(err)
	}
	terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, repair.GetJob().GetJobId())
	if terminal.GetState() != localEnvironmentStateFailed {
		t.Fatalf("repair fixture state=%s", terminal.GetState())
	}

	resolved, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
	if err != nil {
		t.Fatal(err)
	}
	for _, dep := range resolved.GetPlan().GetDependencies() {
		if dep.GetDependencyFamily() == localEnvironmentFamilyCUDA {
			t.Logf("public Resolve: state=%s consumer=%s key=%s", dep.GetState(), dep.GetConsumerScope(), dep.GetEnvironmentKey())
			if dep.GetState() != localEnvironmentStateCancelled {
				t.Fatalf("real plan state=%s, want cancelled", dep.GetState())
			}
		}
	}
	current, err := svc.resolveLocalEnvironmentPlanForApply(context.Background(), resolution)
	if err != nil {
		t.Fatal(err)
	}
	actions, err := svc.prepareLocalEnvironmentPlanApplyActions(current)
	if err != nil {
		t.Fatal(err)
	}
	for _, action := range actions {
		if action.Dependency.DependencyFamily == localEnvironmentFamilyCUDA {
			if action.Kind != localEnvironmentPlanApplyRetry {
				t.Fatalf("CUDA apply action=%s, want the cancelled consumer's retry", action.Kind)
			}
		}
	}
	_, err = svc.ApplyLocalEnvironmentPlan(ctx, &runtimev1.ApplyLocalEnvironmentPlanRequest{
		Resolution: resolution, ExpectedPlanId: resolved.GetPlan().GetPlanId(), Confirmed: true,
	})
	if err != nil {
		t.Fatalf("confirmed current plan must admit the cancelled consumer's retry: %v", err)
	}
	if retained, ok := svc.localEnvironmentDependencyJob(cancelled.JobID); !ok || retained.State != localEnvironmentStateCancelled {
		t.Fatal("retry changed the original terminal job")
	}
}

func TestPlanApplyPreparesNewConsumerOfRepairRequiredSharedSource(t *testing.T) {
	for _, outcome := range []string{"failed", "ready", "cancelled"} {
		t.Run(outcome, func(t *testing.T) {
			ctx := context.Background()
			svc := newTestService(t)
			defer svc.Close()
			release := make(chan struct{})
			defer func() {
				if release != nil {
					close(release)
				}
			}()
			root := filepath.Join(svc.runtimeDataRoot, "dependencies", "cuda")
			if err := os.MkdirAll(root, 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(filepath.Join(root, "cudart64_12.dll"), []byte("test-only artifact"), 0o600); err != nil {
				t.Fatal(err)
			}
			// The engine is a controlled boundary: this tests confirmation and
			// promotion, not downloading or executing a CUDA installation.
			mgr := &mockEngineManager{
				sharedAcceleratorDependencyRelease: release,
				sharedAcceleratorDependencyStatus: &engine.SharedAcceleratorDependencyStatus{
					DependencyID: cudaUserSpaceRuntimeDependencyID, State: engine.SharedAcceleratorDependencyRepairRequired,
					Source: "runtime_managed", CanonicalRoot: root, Version: engine.NVIDIACUDAUserSpaceRuntimeVersion, Detail: "fixture: dependency verification",
					RequiredArtifacts: []string{"cudart64_12.dll"},
				},
			}
			if outcome == "failed" {
				mgr.ensureManagedImageBackendErr = errors.New("fixture: verification failed")
			}
			svc.SetEngineManager(mgr)
			selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.TextEmbedCapabilityContract, capabilitydriver.LlamaEmbedGGUFRecipeID, capabilitydriver.Identity{
				ImplementationID: capabilitydriver.LlamaEmbedImplementationID, DriverID: capabilitydriver.LlamaDriverID, DriverDialect: capabilitydriver.LlamaEmbedDriverDialect,
			})
			resolution := &runtimev1.ResolveLocalEnvironmentPlanRequest{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract, HostProfile: localEnvironmentNvidiaProfile()}
			initial, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
			if err != nil {
				t.Fatal(err)
			}
			var cuda, native *runtimev1.LocalEnvironmentPlanDependency
			for _, dep := range initial.GetPlan().GetDependencies() {
				switch dep.GetDependencyFamily() {
				case localEnvironmentFamilyCUDA:
					cuda = dep
				case localEnvironmentFamilyNativeLlama:
					native = dep
				}
			}
			if cuda == nil || native == nil || cuda.GetConsumerScope() != "llama.cpp.cuda" {
				t.Fatal("supported CUDA dependency absent")
			}
			// Keep the independent native dependency active without a materializer.
			if _, err := svc.startLocalEnvironmentDependencyJob(ctx, localEnvironmentDependencyJobRequest{
				EnvironmentKey: native.GetEnvironmentKey(), DependencyFamily: native.GetDependencyFamily(), DependencyID: native.GetDependencyId(),
				ConsumerScope: native.GetConsumerScope(), SourceKind: localEnvironmentSourceManaged,
			}, nil); err != nil {
				t.Fatal(err)
			}
			original := svc.upsertLocalEnvironmentSelectedSourceRecord(verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
				DependencyFamily: localEnvironmentFamilyCUDA, DependencyID: cuda.GetDependencyId(), EnvironmentKey: cuda.GetEnvironmentKey(),
				SourceKind: localEnvironmentSourceManaged, CanonicalRoot: root,
				SelectedConsumers: []string{stableDiffusionCUDAConsumerID}, RepairState: localEnvironmentRepairRequired,
			}))
			ownerRepair, err := svc.RepairLocalEnvironmentDependency(ctx, &runtimev1.RepairLocalEnvironmentDependencyRequest{
				EnvironmentKey: cuda.GetEnvironmentKey(), DependencyFamily: localEnvironmentFamilyCUDA,
				DependencyId: cuda.GetDependencyId(), ConsumerScope: stableDiffusionCUDAConsumerID, Confirmed: true,
			})
			if err != nil {
				t.Fatal(err)
			}
			awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t, svc, ownerRepair.GetJob().GetJobId(), 384, 1536)
			resolved, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
			if err != nil {
				t.Fatal(err)
			}
			for _, dep := range resolved.GetPlan().GetDependencies() {
				if dep.GetDependencyFamily() == localEnvironmentFamilyCUDA && (dep.GetState() != localEnvironmentStateRepairRequired || dep.GetSelectedSourceRecordId() != "") {
					t.Fatalf("new consumer must not own the broken source: %+v", dep)
				}
			}
			request := &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: resolved.GetPlan().GetPlanId()}
			if _, err := svc.ApplyLocalEnvironmentPlan(ctx, request); status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("unconfirmed apply: %v", err)
			}
			request.Confirmed = true
			request.ExpectedPlanId = "stale-plan"
			if _, err := svc.ApplyLocalEnvironmentPlan(ctx, request); status.Code(err) != codes.FailedPrecondition {
				t.Fatalf("stale plan: %v", err)
			}
			request.ExpectedPlanId = resolved.GetPlan().GetPlanId()
			applied, err := svc.ApplyLocalEnvironmentPlan(ctx, request)
			if err != nil {
				t.Fatalf("new consumer must enter confirmed preparation: %v", err)
			}
			var jobID string
			for _, job := range applied.GetJobs() {
				if job.GetDependencyFamily() == localEnvironmentFamilyCUDA {
					jobID = job.GetJobId()
				}
			}
			if jobID == "" {
				t.Fatal("CUDA preparation job missing")
			}
			if jobID != ownerRepair.GetJob().GetJobId() {
				t.Fatal("shared preparation started another physical installer")
			}
			repeated, err := svc.ApplyLocalEnvironmentPlan(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			for _, job := range repeated.GetJobs() {
				if job.GetDependencyFamily() == localEnvironmentFamilyCUDA && job.GetJobId() != jobID {
					t.Fatal("shared job was not reused")
				}
			}
			if mgr.ensureSharedAcceleratorDependencyCalls != 1 {
				t.Fatal("more than one materializer entered")
			}
			awaitLocalEnvironmentDependencyJobDownloadingProgressForTest(t, svc, jobID, 384, 1536)
			assertLocked := func() {
				t.Helper()
				raw, ok := svc.localEnvironmentSelectedSourceRecordForRepair(cuda.GetEnvironmentKey(), localEnvironmentFamilyCUDA, cuda.GetDependencyId(), "")
				if !ok || raw.RecordID != original.RecordID || raw.RepairState != localEnvironmentRepairRequired || len(raw.SelectedConsumers) != 1 || raw.SelectedConsumers[0] != stableDiffusionCUDAConsumerID {
					t.Fatalf("unverified setup changed the existing source: %+v", raw)
				}
				if _, ready, _ := svc.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, stableDiffusionCUDAConsumerID); ready {
					t.Fatal("repair lock allowed activation")
				}
			}
			assertLocked()
			if outcome == "cancelled" {
				if _, err := svc.CancelLocalEnvironmentDependencyJob(ctx, &runtimev1.CancelLocalEnvironmentDependencyJobRequest{JobId: jobID}); err != nil {
					t.Fatal(err)
				}
			}
			close(release)
			release = nil
			svc.localEnvironmentJobWG.Wait()
			terminal := awaitLocalEnvironmentDependencyJobTerminal(t, svc, jobID)
			if outcome != "ready" {
				if terminal.GetState() != outcome {
					t.Fatalf("unverified job state: %s", terminal.GetState())
				}
				assertLocked()
				if outcome == "failed" {
					if terminal.GetRetryable() {
						t.Fatal("verification failure must remain non-retryable")
					}
					if _, err := svc.RetryLocalEnvironmentDependencyJob(ctx, &runtimev1.RetryLocalEnvironmentDependencyJobRequest{JobId: jobID, Confirmed: true}); status.Code(err) != codes.FailedPrecondition {
						t.Fatalf("old failure unexpectedly became retryable: %v", err)
					}
					if _, err := svc.RepairLocalEnvironmentDependency(ctx, &runtimev1.RepairLocalEnvironmentDependencyRequest{
						EnvironmentKey: cuda.GetEnvironmentKey(), DependencyFamily: localEnvironmentFamilyCUDA,
						DependencyId: cuda.GetDependencyId(), ConsumerScope: cuda.GetConsumerScope(), Confirmed: true,
					}); status.Code(err) != codes.FailedPrecondition {
						t.Fatalf("unselected consumer gained Repair authority: %v", err)
					}
					prepareAgain := func() string {
						t.Helper()
						plan, err := svc.ResolveLocalEnvironmentPlan(ctx, resolution)
						if err != nil {
							t.Fatal(err)
						}
						request := &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: plan.GetPlan().GetPlanId()}
						if _, err := svc.ApplyLocalEnvironmentPlan(ctx, request); status.Code(err) != codes.FailedPrecondition {
							t.Fatalf("recovery without confirmation: %v", err)
						}
						request.Confirmed = true
						applied, err := svc.ApplyLocalEnvironmentPlan(ctx, request)
						if err != nil {
							t.Fatalf("explicit preparation after failure: %v", err)
						}
						for _, job := range applied.GetJobs() {
							if job.GetDependencyFamily() == localEnvironmentFamilyCUDA {
								return job.GetJobId()
							}
						}
						t.Fatal("recovery omitted CUDA Job")
						return ""
					}
					// Repeated failures must not make the next explicit preparation
					// depend on whether this consumer was the original Job owner.
					for attempt := 0; attempt < 2; attempt++ {
						nextID := prepareAgain()
						if nextID == jobID {
							t.Fatal("new preparation reused terminal Job")
						}
						svc.localEnvironmentJobWG.Wait()
						if next := awaitLocalEnvironmentDependencyJobTerminal(t, svc, nextID); next.GetState() != localEnvironmentStateFailed || next.GetRetryable() {
							t.Fatalf("unexpected preparation failure: %+v", next)
						}
						assertLocked()
					}
					// The selected owner can repair independently. Its success must
					// not strand the joining consumer behind its earlier failures.
					mgr.ensureManagedImageBackendErr = nil
					mgr.sharedAcceleratorDependencyRelease = nil
					mgr.sharedAcceleratorDependencyStatus.State = engine.SharedAcceleratorDependencyReadyManaged
					repaired, err := svc.RepairLocalEnvironmentDependency(ctx, &runtimev1.RepairLocalEnvironmentDependencyRequest{
						EnvironmentKey: cuda.GetEnvironmentKey(), DependencyFamily: localEnvironmentFamilyCUDA,
						DependencyId: cuda.GetDependencyId(), ConsumerScope: stableDiffusionCUDAConsumerID, Confirmed: true,
					})
					if err != nil {
						t.Fatal(err)
					}
					svc.localEnvironmentJobWG.Wait()
					if ready := awaitLocalEnvironmentDependencyJobTerminal(t, svc, repaired.GetJob().GetJobId()); ready.GetState() != localEnvironmentStateReadyManaged {
						t.Fatal("owner repair failed")
					}
					nextID := prepareAgain()
					svc.localEnvironmentJobWG.Wait()
					if ready := awaitLocalEnvironmentDependencyJobTerminal(t, svc, nextID); ready.GetState() != localEnvironmentStateReadyManaged {
						t.Fatal("joining consumer did not recover")
					}
					for _, consumer := range []string{cuda.GetConsumerScope(), stableDiffusionCUDAConsumerID} {
						if _, ready, detail := svc.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); !ready {
							t.Fatalf("consumer %s not ready: %s", consumer, detail)
						}
					}
					retained, _ := svc.localEnvironmentDependencyJob(jobID)
					if retained.State != localEnvironmentStateFailed || retained.Retryable {
						t.Fatal("old terminal failure changed")
					}
				}
				return
			}
			if terminal.GetState() != localEnvironmentStateReadyManaged {
				t.Fatalf("verified job state: %s", terminal.GetState())
			}
			record, ok := svc.localEnvironmentSelectedSourceRecordForDependency(cuda.GetEnvironmentKey(), localEnvironmentFamilyCUDA, cuda.GetDependencyId(), cuda.GetConsumerScope())
			if !ok || record.RecordID != original.RecordID || record.RepairState != localEnvironmentRepairNone || !stringSliceContains(record.SelectedConsumers, stableDiffusionCUDAConsumerID) {
				t.Fatalf("verified promotion lost shared ownership: %+v", record)
			}
			for _, consumer := range []string{cuda.GetConsumerScope(), stableDiffusionCUDAConsumerID} {
				if _, ready, detail := svc.readySelectedSourceForFamilyAndConsumer(localEnvironmentFamilyCUDA, consumer); !ready {
					t.Fatalf("verified source not ready for %s: %s", consumer, detail)
				}
			}
		})
	}
}
