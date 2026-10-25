package localservice

import (
	"context"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
	"google.golang.org/protobuf/proto"
)

func applyHostFixture(t *testing.T) (*Service, *runtimev1.ResolveLocalEnvironmentPlanRequest) {
	t.Helper()
	svc := newTestService(t)
	svc.SetEngineManager(&mockEngineManager{})
	selectEnvironmentLoadoutForTest(t, svc, capabilitydriver.TextEmbedCapabilityContract, capabilitydriver.LlamaEmbedGGUFRecipeID, capabilitydriver.Identity{
		ImplementationID: capabilitydriver.LlamaEmbedImplementationID,
		DriverID:         capabilitydriver.LlamaDriverID,
		DriverDialect:    capabilitydriver.LlamaEmbedDriverDialect,
	})
	return svc, &runtimev1.ResolveLocalEnvironmentPlanRequest{CapabilityContract: capabilitydriver.TextEmbedCapabilityContract}
}

func assertApplyHostStateUnchanged(t *testing.T, svc *Service, request, original *runtimev1.ApplyLocalEnvironmentPlanRequest, before *runtimev1.ListLocalEnvironmentDependencyJobsResponse) {
	t.Helper()
	if !proto.Equal(request, original) {
		t.Fatal("Apply modified the caller's resolution or host profile")
	}
	after, err := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{})
	if err != nil || !proto.Equal(before, after) {
		t.Fatalf("Apply changed dependency Jobs: before=%v after=%v err=%v", before, after, err)
	}
}

func TestApplyHostRejectsCallerSnapshotThatNoLongerMatchesCurrentHost(t *testing.T) {
	svc, resolution := applyHostFixture(t)
	resolution.HostProfile = collectDeviceProfile(context.Background())
	resolution.HostProfile.Gpu.Model = "previous Apple host"
	markLocalEnvironmentPlanReadyForTest(t, svc, localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "llama.cpp.metal", PackID: "local-text", HostProfile: resolution.HostProfile,
	})
	preview, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
	if err != nil || preview.GetPlan().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("caller-supplied previous-host preview fixture: plan=%v err=%v", preview, err)
	}
	request := &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: preview.GetPlan().GetPlanId(), Confirmed: true}
	original := proto.Clone(request).(*runtimev1.ApplyLocalEnvironmentPlanRequest)
	before, _ := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{})
	// newTestService's actual collector reports the controlled Apple host.
	// The read-only previous-host preview must not override that Apply-time fact.
	if _, err := svc.ApplyLocalEnvironmentPlan(context.Background(), request); status.Code(err) != codes.FailedPrecondition {
		t.Fatalf("stale caller host forced Apply: %v", err)
	}
	assertApplyHostStateUnchanged(t, svc, request, original, before)
}

func TestApplyHostUsesCurrentFactsAndPreservesCallerRequest(t *testing.T) {
	svc, resolution := applyHostFixture(t)
	current := collectDeviceProfile(context.Background())
	markLocalEnvironmentPlanReadyForTest(t, svc, localEnvironmentConsumerActivationGateRequest{
		ConsumerID: "llama.cpp.metal", PackID: "local-text", HostProfile: current,
	})
	preview, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
	if err != nil || preview.GetPlan().GetState() != localEnvironmentStateReadyManaged {
		t.Fatalf("current-host ready preview fixture: plan=%v err=%v", preview, err)
	}
	resolution.HostProfile = localEnvironmentNvidiaProfile()
	request := &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: preview.GetPlan().GetPlanId(), Confirmed: true}
	original := proto.Clone(request).(*runtimev1.ApplyLocalEnvironmentPlanRequest)
	before, _ := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{})
	applied, err := svc.ApplyLocalEnvironmentPlan(context.Background(), request)
	if err != nil || applied.GetPlan().GetPlanId() != preview.GetPlan().GetPlanId() || len(applied.GetJobs()) != 0 {
		t.Fatalf("fresh current-host plan was not applied: response=%v err=%v", applied, err)
	}
	assertApplyHostStateUnchanged(t, svc, request, original, before)
}

func TestApplyHostCancellationCannotUseCallerSnapshotOrChangeJobs(t *testing.T) {
	for _, when := range []string{"before", "during-collection"} {
		t.Run(when, func(t *testing.T) {
			svc, resolution := applyHostFixture(t)
			resolution.HostProfile = collectDeviceProfile(context.Background())
			markLocalEnvironmentPlanReadyForTest(t, svc, localEnvironmentConsumerActivationGateRequest{
				ConsumerID: "llama.cpp.metal", PackID: "local-text", HostProfile: resolution.HostProfile,
			})
			preview, err := svc.ResolveLocalEnvironmentPlan(context.Background(), resolution)
			if err != nil {
				t.Fatal(err)
			}
			request := &runtimev1.ApplyLocalEnvironmentPlanRequest{Resolution: resolution, ExpectedPlanId: preview.GetPlan().GetPlanId(), Confirmed: true}
			original := proto.Clone(request).(*runtimev1.ApplyLocalEnvironmentPlanRequest)
			before, _ := svc.ListLocalEnvironmentDependencyJobs(context.Background(), &runtimev1.ListLocalEnvironmentDependencyJobsRequest{})
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			if when == "before" {
				cancel()
			} else {
				previous := localRuntimeProbeRAM
				t.Cleanup(func() { localRuntimeProbeRAM = previous })
				localRuntimeProbeRAM = func() (int64, int64) {
					cancel()
					return 32 << 30, 16 << 30
				}
			}
			if _, err := svc.ApplyLocalEnvironmentPlan(ctx, request); status.Code(err) != codes.Canceled {
				t.Fatalf("Apply cancellation=%v, want Canceled", err)
			}
			assertApplyHostStateUnchanged(t, svc, request, original, before)
		})
	}
}
