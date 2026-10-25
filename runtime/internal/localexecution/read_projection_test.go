package localexecution

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
)

func TestReadProjectionDeviceProfileIsLazyConcurrentAndCloned(t *testing.T) {
	ctx := WithReadProjection(context.Background())
	var calls atomic.Int32
	source := &runtimev1.LocalDeviceProfile{AvailableRamBytes: 42, Gpu: &runtimev1.LocalGpuProfile{AvailableVramBytes: 84}}
	entered, release := make(chan struct{}), make(chan struct{})
	collect := func(context.Context) (*runtimev1.LocalDeviceProfile, error) {
		calls.Add(1)
		close(entered)
		<-release
		return source, nil
	}
	if calls.Load() != 0 {
		t.Fatal("creating a read pass sampled a device")
	}
	var consumers sync.WaitGroup
	profiles := make(chan *runtimev1.LocalDeviceProfile, 8)
	for range 8 {
		consumers.Add(1)
		go func() {
			defer consumers.Done()
			profile, err := ReadProjectionDeviceProfile(ctx, collect)
			if err != nil {
				t.Errorf("profile: %v", err)
				return
			}
			profiles <- profile
		}()
	}
	<-entered
	close(release)
	consumers.Wait()
	close(profiles)
	if calls.Load() != 1 || len(profiles) != 8 {
		t.Fatalf("samples=%d, consumers=%d", calls.Load(), len(profiles))
	}
	for profile := range profiles {
		if profile.GetAvailableRamBytes() != 42 || profile.GetGpu().GetAvailableVramBytes() != 84 {
			t.Fatalf("consumer changed another consumer's facts: %+v", profile)
		}
		profile.AvailableRamBytes = -1
		profile.Gpu.AvailableVramBytes = -1
	}
	source.AvailableRamBytes = 99
	source.Gpu.AvailableVramBytes = 100
	profile, err := ReadProjectionDeviceProfile(ctx, collect)
	if err != nil || profile.GetAvailableRamBytes() != 42 || profile.GetGpu().GetAvailableVramBytes() != 84 {
		t.Fatalf("collector or consumer changed captured facts: %+v, %v", profile, err)
	}
	fresh, err := ReadProjectionDeviceProfile(WithReadProjection(ctx), func(context.Context) (*runtimev1.LocalDeviceProfile, error) {
		calls.Add(1)
		return source, nil
	})
	if err != nil || fresh.GetAvailableRamBytes() != 99 || calls.Load() != 2 {
		t.Fatalf("next read reused stale facts: %+v, %v, calls=%d", fresh, err, calls.Load())
	}
}

func TestReadProjectionDeviceProfileCancellationDiscardsPartialFacts(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	ctx := WithReadProjection(parent)
	entered, finished := make(chan struct{}), make(chan struct{})
	var calls atomic.Int32
	collect := func(ctx context.Context) (*runtimev1.LocalDeviceProfile, error) {
		calls.Add(1)
		close(entered)
		<-ctx.Done()
		defer close(finished)
		return &runtimev1.LocalDeviceProfile{AvailableRamBytes: 1}, nil
	}
	results := make(chan error, 2)
	for range 2 {
		go func() {
			profile, err := ReadProjectionDeviceProfile(ctx, collect)
			if profile != nil {
				t.Errorf("canceled read returned partial facts: %+v", profile)
			}
			results <- err
		}()
	}
	<-entered
	cancel()
	for range 2 {
		select {
		case err := <-results:
			if !errors.Is(err, context.Canceled) {
				t.Fatalf("cancellation = %v", err)
			}
		case <-time.After(time.Second):
			t.Fatal("canceled consumer remained blocked")
		}
	}
	<-finished
	if profile, err := ReadProjectionDeviceProfile(ctx, collect); profile != nil || !errors.Is(err, context.Canceled) || calls.Load() != 1 {
		t.Fatalf("canceled pass restarted or exposed partial facts: %+v, %v, calls=%d", profile, err, calls.Load())
	}
}

func TestReadProjectionDeviceProfilePreservesFailureAndUnscopedFreshness(t *testing.T) {
	ctx := WithReadProjection(context.Background())
	want := errors.New("probe failed")
	calls := 0
	collect := func(context.Context) (*runtimev1.LocalDeviceProfile, error) {
		calls++
		return &runtimev1.LocalDeviceProfile{AvailableRamBytes: 1}, want
	}
	for range 2 {
		if profile, err := ReadProjectionDeviceProfile(ctx, collect); profile != nil || !errors.Is(err, want) {
			t.Fatalf("failed probe published facts: %+v, %v", profile, err)
		}
	}
	if calls != 1 {
		t.Fatalf("failed read repeatedly probed: %d", calls)
	}
	for range 2 {
		_, _ = ReadProjectionDeviceProfile(context.Background(), collect)
	}
	if calls != 3 {
		t.Fatalf("unscoped call reused a read pass: %d", calls)
	}
}
