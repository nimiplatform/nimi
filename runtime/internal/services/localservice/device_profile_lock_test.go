package localservice

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"github.com/nimiplatform/nimi/runtime/internal/localexecution"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestResolveLocalExecutionProbesDeviceProfileOutsideMutationLocks(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract

	loadoutA := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "Embed A", asset).GetPrepareId(), false)
	loadoutB := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "Embed B", asset).GetPrepareId(), false)
	if _, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     contract,
		LoadoutId:              loadoutA.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatalf("select loadoutA: %v", err)
	}

	probeEntered := make(chan struct{})
	releaseProbe := make(chan struct{})
	svc.mu.Lock()
	svc.admissionDeviceProfile = func(probeCtx context.Context) *runtimev1.LocalDeviceProfile {
		close(probeEntered)
		select {
		case <-releaseProbe:
		case <-probeCtx.Done():
		}
		return collectDeviceProfile(context.Background())
	}
	svc.mu.Unlock()

	type resolveResult struct {
		assembly *localexecution.SelectedLocalExecution
		err      error
	}
	done := make(chan resolveResult, 1)
	go func() {
		assembly, err := svc.ResolveSelectedLocalExecution(contract)
		done <- resolveResult{assembly: assembly, err: err}
	}()

	select {
	case <-probeEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("device profile probe did not start")
	}

	// While the slow device probe is running, both loadoutMutationMu and
	// modelAssetMutationMu must remain unblocked so concurrent writes proceed
	// without waiting for device probing.
	writeStart := time.Now()
	if _, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     contract,
		LoadoutId:              loadoutB.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		close(releaseProbe)
		t.Fatalf("concurrent SelectLoadout blocked or failed while probing: %v", err)
	}
	loadoutWriteElapsed := time.Since(writeStart)

	assetLockStart := time.Now()
	lockCtx, cancelLock := context.WithTimeout(ctx, 500*time.Millisecond)
	defer cancelLock()
	if err := svc.modelAssetMutationMu.LockContext(lockCtx); err != nil {
		close(releaseProbe)
		t.Fatalf("modelAssetMutationMu was held during device probe: %v", err)
	}
	svc.modelAssetMutationMu.Unlock()
	assetLockElapsed := time.Since(assetLockStart)

	close(releaseProbe)
	result := <-done
	if result.err != nil {
		t.Fatalf("ResolveSelectedLocalExecution failed: %v", result.err)
	}
	if result.assembly.LoadoutID != loadoutB.GetLoadoutId() || result.assembly.LoadoutRevision != loadoutB.GetRevision() {
		t.Fatalf("resolved assembly mixed stale pre-switch Loadout: got id=%q rev=%q, want id=%q rev=%q",
			result.assembly.LoadoutID, result.assembly.LoadoutRevision, loadoutB.GetLoadoutId(), loadoutB.GetRevision())
	}
	if len(result.assembly.ExactBindings) != 1 || result.assembly.ExactBindings[0].ModelAssetID != asset.GetModelAssetId() {
		t.Fatalf("resolved bindings mismatch: %+v", result.assembly.ExactBindings)
	}
	if len(result.assembly.ExactDependencySources) == 0 {
		t.Fatal("resolved assembly missing dependency sources")
	}
	t.Logf("concurrent write wait during blocked device probe: loadoutSelect=%v modelAssetLock=%v", loadoutWriteElapsed, assetLockElapsed)
}

func TestResolveNamedLocalExecutionAfterConcurrentDeleteFailsTypedAfterProbe(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract

	loadoutA := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "Embed Delete Race", asset).GetPrepareId(), false)

	probeEntered := make(chan struct{})
	releaseProbe := make(chan struct{})
	svc.mu.Lock()
	svc.admissionDeviceProfile = func(probeCtx context.Context) *runtimev1.LocalDeviceProfile {
		close(probeEntered)
		select {
		case <-releaseProbe:
		case <-probeCtx.Done():
		}
		return collectDeviceProfile(context.Background())
	}
	svc.mu.Unlock()

	errCh := make(chan error, 1)
	go func() {
		_, err := svc.ResolveLocalExecution(contract, loadoutA.GetLoadoutId())
		errCh <- err
	}()

	select {
	case <-probeEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("device profile probe did not start")
	}

	if _, err := svc.DeleteLoadout(ctx, &runtimev1.DeleteLoadoutRequest{
		LoadoutId:              loadoutA.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		close(releaseProbe)
		t.Fatalf("concurrent DeleteLoadout failed during probe: %v", err)
	}

	close(releaseProbe)
	err := <-errCh
	if status.Code(err) != codes.NotFound || grpcReasonForTest(err) != runtimev1.ReasonCode_AI_LOADOUT_NOT_FOUND {
		t.Fatalf("named resolve after concurrent delete = code:%s reason:%s err:%v", status.Code(err), grpcReasonForTest(err), err)
	}
}

func TestCaptureLocalExecutionCancellationDuringDeviceProbeDoesNotBlockWriters(t *testing.T) {
	svc, asset := loadoutEmbeddingFixture(t)
	ctx := context.Background()
	contract := capabilitydriver.TextEmbedCapabilityContract

	loadoutA := commitLoadoutForTest(t, svc, ctx, prepareEmbeddingLoadoutForTest(t, svc, ctx, "", "Capture Cancel", asset).GetPrepareId(), false)
	if _, err := svc.SelectLoadout(ctx, &runtimev1.SelectLoadoutRequest{
		CapabilityContract:     contract,
		LoadoutId:              loadoutA.GetLoadoutId(),
		ConfirmedMachineImpact: true,
	}); err != nil {
		t.Fatal(err)
	}

	probeEntered := make(chan struct{})
	svc.mu.Lock()
	svc.admissionDeviceProfile = func(probeCtx context.Context) *runtimev1.LocalDeviceProfile {
		close(probeEntered)
		<-probeCtx.Done()
		return &runtimev1.LocalDeviceProfile{}
	}
	svc.mu.Unlock()

	captureCtx, cancelCapture := context.WithCancel(ctx)
	errCh := make(chan error, 1)
	go func() {
		_, err := svc.CaptureLocalExecution(captureCtx, contract, "")
		errCh <- err
	}()

	select {
	case <-probeEntered:
	case <-time.After(3 * time.Second):
		t.Fatal("device probe did not enter during CaptureLocalExecution")
	}

	cancelCapture()
	err := <-errCh
	if status.Code(err) != codes.Canceled {
		t.Fatalf("canceled CaptureLocalExecution during probe = code:%s err:%v, want Canceled", status.Code(err), err)
	}
}
