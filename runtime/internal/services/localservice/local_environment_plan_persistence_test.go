package localservice

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"maps"
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

func TestEnvironmentPlanKnownContractsDoNotRewriteObservationState(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	requests := []localEnvironmentPlanRequest{
		{PackID: "local-text", ConsumerScope: "llama.cpp.metal", HostProfile: localEnvironmentAppleSilicon128GBProfile()},
		{PackID: "media-codec", ConsumerScope: "media-codec", HostProfile: localEnvironmentAppleSilicon128GBProfile()},
		{PackID: "local-nlp", ConsumerScope: engine.TextAnnotationConsumerID, HostProfile: localEnvironmentAppleSilicon128GBProfile()},
	}
	for _, req := range requests {
		resolveEnvironmentPlanForTest(t, svc, req)
	}
	previous, err := os.ReadFile(svc.stateStorePath)
	if err != nil {
		t.Fatal(err)
	}
	changedSnapshots := 0
	var rewrittenBytes int
	var latest localEnvironmentPlan
	for index := range 17 {
		req := requests[index%len(requests)]
		req.HostProfile = cloneDeviceProfile(req.HostProfile)
		req.HostProfile.AvailableRamBytes = int64(index + 1)
		latest = resolveEnvironmentPlanForTest(t, svc, req)
		current, err := os.ReadFile(svc.stateStorePath)
		if err != nil {
			t.Fatal(err)
		}
		if !bytes.Equal(previous, current) {
			changedSnapshots++
			rewrittenBytes += len(current)
		}
		previous = current
	}
	if changedSnapshots != 0 {
		t.Fatalf("17 known-contract resolutions rewrote %d state snapshots (%d serialized bytes); want no observation-only writes", changedSnapshots, rewrittenBytes)
	}
	if observed := svc.localEnvironmentHostProfiles[latest.HostProfileID].AvailableRAMBytes; observed != 17 {
		t.Fatalf("host facts were cached instead of observing the current request: %d", observed)
	}
}

func TestEnvironmentPlanPersistenceFailureDoesNotPublishContractAndCanRetry(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	blockedParent := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blockedParent, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc.stateStorePath = filepath.Join(blockedParent, "local-state.json")
	req := &runtimev1.ResolveLocalEnvironmentPlanRequest{MediaCodec: true, HostProfile: localEnvironmentAppleSilicon128GBProfile()}
	for range 2 {
		response, err := svc.ResolveLocalEnvironmentPlan(context.Background(), req)
		if response != nil || status.Code(err) != codes.Internal {
			t.Fatalf("failed persistence published a plan: response=%+v err=%v", response, err)
		}
		if len(svc.localEnvironmentPlanDependencyContracts) != 0 {
			t.Fatal("failed contract write became the next attempt's durable baseline")
		}
	}
	if err := os.Remove(blockedParent); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(blockedParent, 0o700); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.ResolveLocalEnvironmentPlan(context.Background(), req); err != nil {
		t.Fatalf("retry after storage recovery: %v", err)
	}
	snapshot, err := loadLocalStateSnapshot(svc.stateStorePath)
	if err != nil || len(snapshot.LocalEnvironmentPlanContracts) != 1 {
		t.Fatalf("retry did not actually write the missing contract: %+v, %v", snapshot.LocalEnvironmentPlanContracts, err)
	}
}

func TestEnvironmentPlanFailedDeltaPreservesExistingDurableContracts(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	resolveEnvironmentPlanForTest(t, svc, localEnvironmentPlanRequest{PackID: "media-codec", HostProfile: localEnvironmentAppleSilicon128GBProfile()})
	before := maps.Clone(svc.localEnvironmentPlanDependencyContracts)
	blockedParent := filepath.Join(t.TempDir(), "blocked")
	if err := os.WriteFile(blockedParent, []byte("not a directory"), 0o600); err != nil {
		t.Fatal(err)
	}
	svc.stateStorePath = filepath.Join(blockedParent, "state.json")
	if _, err := svc.resolveLocalEnvironmentPlan(context.Background(), localEnvironmentPlanRequest{
		PackID: "local-text", ConsumerScope: "llama.cpp.metal", HostProfile: localEnvironmentAppleSilicon128GBProfile(),
	}); status.Code(err) != codes.Internal {
		t.Fatalf("failed delta did not reach the caller: %v", err)
	}
	if !maps.Equal(before, svc.localEnvironmentPlanDependencyContracts) {
		t.Fatal("failed delta replaced or changed previously durable contracts")
	}
}

func TestEnvironmentPlanReadStillValidatesCurrentSourceWithoutWriting(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	defer svc.Close()
	req := localEnvironmentPlanRequest{PackID: "local-text", ConsumerScope: "llama.cpp.metal", HostProfile: localEnvironmentAppleSilicon128GBProfile()}
	plan := resolveEnvironmentPlanForTest(t, svc, req)
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyNativeLlama)
	binaryPath := filepath.Join(svc.runtimeDataRoot, "environments", "llama", "llama-server")
	record := verifiedSelectedSourceRecordForTest(localEnvironmentSelectedSourceRecordState{
		DependencyFamily: dep.DependencyFamily, DependencyID: dep.DependencyID, EnvironmentKey: dep.EnvironmentKey,
		SourceKind: localEnvironmentSourceManaged, CanonicalRoot: binaryPath,
		VerifiedArtifacts: []string{binaryPath}, SelectedConsumers: []string{req.ConsumerScope},
	})
	writeSelectedSourceLocalArtifactsForTest(t, record)
	svc.upsertLocalEnvironmentSelectedSourceRecord(record)
	ready := resolveEnvironmentPlanForTest(t, svc, req)
	if findLocalEnvironmentDependency(t, ready, localEnvironmentFamilyNativeLlama).State != localEnvironmentStateReadyManaged {
		t.Fatal("fixture source is not ready before removal")
	}
	before, err := os.ReadFile(svc.stateStorePath)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(binaryPath); err != nil {
		t.Fatal(err)
	}
	current := resolveEnvironmentPlanForTest(t, svc, req)
	if findLocalEnvironmentDependency(t, current, localEnvironmentFamilyNativeLlama).State != localEnvironmentStateRepairRequired {
		t.Fatal("read reused stale readiness after its verified artifact disappeared")
	}
	after, err := os.ReadFile(svc.stateStorePath)
	if err != nil || !bytes.Equal(before, after) {
		t.Fatalf("current-source validation required an unrelated observation write: %v", err)
	}
}

func TestEnvironmentPlanDurableContractAdmitsStartAfterReopen(t *testing.T) {
	svc := newLocalEnvironmentTestService(t)
	plan := resolveEnvironmentPlanForTest(t, svc, localEnvironmentPlanRequest{
		PackID: "local-nlp", ConsumerScope: engine.TextAnnotationConsumerID, HostProfile: localEnvironmentAppleSilicon128GBProfile(),
	})
	dep := findLocalEnvironmentDependency(t, plan, localEnvironmentFamilyPythonUV)
	statePath, dataRoot := svc.stateStorePath, svc.runtimeDataRoot
	svc.Close()
	reopened, err := NewWithProductControlDataRoot(slog.Default(), nil, statePath, 10, filepath.Join(dataRoot, "models"), dataRoot)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if reopened.engineManagerOrNil() != nil {
		t.Fatal("fixture must not have an engine that can materialize dependencies")
	}
	if _, ok := reopened.localEnvironmentPlanDependencyContract(dep.EnvironmentKey, dep.DependencyFamily, dep.DependencyID, dep.ConsumerScope); !ok {
		t.Fatal("returned plan's dependency contract was not durable")
	}
	response, err := reopened.StartLocalEnvironmentDependencyJob(context.Background(), &runtimev1.StartLocalEnvironmentDependencyJobRequest{
		EnvironmentKey: dep.EnvironmentKey, DependencyFamily: dep.DependencyFamily, DependencyId: dep.DependencyID,
		ConsumerScope: dep.ConsumerScope, SourceKind: dep.SourceKind, Confirmed: true,
	})
	if err != nil || response.GetJob().GetJobId() == "" {
		t.Fatalf("Start lost the previously returned plan contract after reopen: %+v, %v", response, err)
	}
	// This checks durable Start admission only. Without an Engine the isolated
	// job must fail, and cannot download, install, or report ready.
	job := pollLocalEnvironmentDependencyJobToTerminal(t, reopened, response.GetJob().GetJobId())
	if job.State != localEnvironmentStateFailed || !strings.Contains(job.FailureDetail, "engine manager unavailable") {
		t.Fatalf("unexpected fixture execution: %+v", job)
	}
}

func TestEnvironmentPlanContractCancellationBeforeAndAfterLock(t *testing.T) {
	deps := []localEnvironmentPlanDependency{{EnvironmentKey: "env-test", DependencyFamily: localEnvironmentFamilyPythonUV, DependencyID: "uv", ConsumerScope: engine.TextAnnotationConsumerID}}
	for _, alreadyCanceled := range []bool{true, false} {
		t.Run(map[bool]string{true: "before-lock", false: "waiting-for-lock"}[alreadyCanceled], func(t *testing.T) {
			svc := &Service{stateStorePath: filepath.Join(t.TempDir(), "state.json")}
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &projectionWaitContext{Context: parent, entered: make(chan struct{})}
			if alreadyCanceled {
				cancel()
			}
			svc.mu.Lock()
			result := make(chan error, 1)
			go func() { result <- svc.rememberLocalEnvironmentPlanDependencyContracts(ctx, deps) }()
			<-ctx.entered
			if !alreadyCanceled {
				cancel()
				svc.mu.Unlock()
			}
			select {
			case err := <-result:
				if !errors.Is(err, context.Canceled) {
					t.Errorf("canceled contract update = %v", err)
				}
			case <-time.After(2 * time.Second):
				t.Error("canceled contract update remained blocked")
			}
			if alreadyCanceled {
				svc.mu.Unlock()
			}
			if len(svc.localEnvironmentPlanDependencyContracts) != 0 {
				t.Fatal("canceled read published dependency contracts")
			}
			if _, err := os.Stat(svc.stateStorePath); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("canceled read wrote a state file: %v", err)
			}
		})
	}
}
