package localservice

import (
	"bytes"
	"context"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"github.com/nimiplatform/nimi/runtime/internal/capabilitydriver"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func resolveEnvironmentPlanForTest(t *testing.T, service *Service, req localEnvironmentPlanRequest) localEnvironmentPlan {
	t.Helper()
	plan, err := service.resolveLocalEnvironmentPlan(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

func resolveEnvironmentGateForTest(t *testing.T, service *Service, req localEnvironmentConsumerActivationGateRequest) localEnvironmentConsumerActivationGate {
	t.Helper()
	gate, err := service.resolveLocalEnvironmentConsumerActivationGate(context.Background(), req)
	if err != nil {
		t.Fatal(err)
	}
	return gate
}

type projectionWaitContext struct {
	context.Context
	entered chan struct{}
	once    sync.Once
}

func (ctx *projectionWaitContext) Err() error {
	err := ctx.Context.Err()
	ctx.once.Do(func() { close(ctx.entered) })
	return err
}

func TestProjectionCancellationAfterLoadoutLock(t *testing.T) {
	for name, invoke := range map[string]func(*Service, context.Context) error{
		"selected": func(s *Service, ctx context.Context) error {
			_, _, err := s.ProjectSelectedLocalLoadout(ctx, "text.generate")
			return err
		},
		"machine": func(s *Service, ctx context.Context) error {
			_, err := s.GetMachineLoadouts(ctx, &runtimev1.GetMachineLoadoutsRequest{})
			return err
		},
		"one": func(s *Service, ctx context.Context) error {
			_, err := s.GetLoadout(ctx, &runtimev1.GetLoadoutRequest{LoadoutId: "pending"})
			return err
		},
	} {
		t.Run(name, func(t *testing.T) {
			s := &Service{}
			s.loadoutMutationMu.Lock()
			parent, cancel := context.WithCancel(context.Background())
			defer cancel()
			ctx := &projectionWaitContext{Context: parent, entered: make(chan struct{})}
			finished := make(chan error, 1)
			go func() { finished <- invoke(s, ctx) }()
			<-ctx.entered // The first pre-lock check returned nil.
			cancel()
			s.loadoutMutationMu.Unlock()
			select {
			case err := <-finished:
				if !errors.Is(err, context.Canceled) && status.Code(err) != codes.Canceled {
					t.Fatalf("canceled projection = %v", err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("canceled lock waiter did not leave")
			}
			// Ending one view must not fence the independent owner or later reads.
			response, err := s.GetMachineLoadouts(context.Background(), &runtimev1.GetMachineLoadoutsRequest{})
			if err != nil || response.GetAggregate() == nil {
				t.Fatalf("independent read = %v, %v", response, err)
			}
		})
	}
}

func TestProjectionCancellationStopsDeviceProbeBeforePlanPersistence(t *testing.T) {
	oldLookPath, oldOutput, oldRAM := localRuntimeLookPath, localRuntimeCommandOutput, localRuntimeProbeRAM
	t.Cleanup(func() {
		localRuntimeLookPath, localRuntimeCommandOutput, localRuntimeProbeRAM = oldLookPath, oldOutput, oldRAM
	})
	entered := make(chan struct{})
	localRuntimeLookPath = func(name string) (string, error) {
		if name != "nvidia-smi" {
			t.Errorf("canceled profile started another probe: %s", name)
		}
		return name, nil
	}
	localRuntimeProbeRAM = func() (int64, int64) { return 32 << 30, 16 << 30 }
	localRuntimeCommandOutput = func(ctx context.Context, _ string, _ ...string) ([]byte, error) {
		close(entered)
		<-ctx.Done()
		return nil, ctx.Err()
	}
	root := t.TempDir()
	s := &Service{runtimeDataRoot: root, stateStorePath: filepath.Join(root, "local-state.json")}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	finished := make(chan error, 1)
	go func() {
		_, err := s.ResolveLocalEnvironmentPlan(ctx, &runtimev1.ResolveLocalEnvironmentPlanRequest{MediaCodec: true})
		finished <- err
	}()
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("profile did not start")
	}
	cancel()
	select {
	case err := <-finished:
		if status.Code(err) != codes.Canceled {
			t.Fatalf("RPC cancellation = %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("profile ignored request cancellation")
	}
	if len(s.localEnvironmentHostProfiles) != 0 {
		t.Fatal("canceled profile was persisted as current")
	}
	if _, err := os.Stat(s.stateStorePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("canceled read wrote local state: %v", err)
	}
}

func TestProjectionCancellationDoesNotBecomeModelDamageOrVisitNextAxis(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	loadout := &runtimev1.Loadout{ModelAxes: []*runtimev1.LoadoutModelAxis{
		{SlotId: "first", ModelAssetId: "one", ExpectedContentId: "one"},
		{SlotId: "second", ModelAssetId: "two", ExpectedContentId: "two"},
	}}
	requirements := []*runtimev1.LocalCapabilityRequirement{{RequirementId: "first"}, {RequirementId: "second"}}
	calls := 0
	result, err := (&Service{}).validateLoadoutWithAxisResolver(ctx, loadout, capabilitydriver.LlamaTextDriver{}, requirements,
		func(*runtimev1.Loadout, capabilitydriver.Driver, *runtimev1.LocalCapabilityRequirement, *runtimev1.LoadoutModelAxis) (resolvedLoadoutAxis, runtimev1.ReasonCode, error) {
			calls++
			cancel()
			return resolvedLoadoutAxis{}, runtimev1.ReasonCode_AI_LOADOUT_MODEL_ASSET_CONTENT_MISMATCH, context.Canceled
		})
	if !errors.Is(err, context.Canceled) || calls != 1 || len(result.reasons) != 0 {
		t.Fatalf("interrupted axis = %+v calls=%d err=%v", result, calls, err)
	}
	if loadout.GetValidationState() != runtimev1.LoadoutValidationState_LOADOUT_VALIDATION_STATE_UNSPECIFIED {
		t.Fatal("canceled validation mutated the Loadout")
	}
}

func TestProjectionCancellationStopsProbeReadersAndKeepsDeadlineStatus(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	data := bytes.NewReader([]byte("valid bytes"))
	if _, err := (projectionReader{ctx: ctx, reader: data}).Read(make([]byte, 4)); !errors.Is(err, context.Canceled) || data.Len() != len("valid bytes") {
		t.Fatalf("sequential read continued: %v", err)
	}
	if _, err := (projectionReaderAt{ctx: ctx, reader: data}).ReadAt(make([]byte, 4), 0); !errors.Is(err, context.Canceled) {
		t.Fatalf("structured read continued: %v", err)
	}
	expired, done := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer done()
	if _, err := (&Service{}).CollectDeviceProfile(expired, &runtimev1.CollectDeviceProfileRequest{}); status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("deadline status = %v", err)
	}
	if _, err := (&Service{}).ResolveLocalEnvironmentActivationGate(expired, &runtimev1.ResolveLocalEnvironmentActivationGateRequest{}); status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("activation gate deadline status = %v", err)
	}
	// Apply shares the read resolver, but already admitted Jobs retain their
	// own lifetime. A canceled response must not be encoded as Unknown.
	if _, err := (&Service{}).resolveLocalEnvironmentPlanForApply(expired, &runtimev1.ResolveLocalEnvironmentPlanRequest{}); status.Code(err) != codes.DeadlineExceeded {
		t.Fatalf("apply projection deadline status = %v", err)
	}
}
