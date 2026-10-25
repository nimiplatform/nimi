package localservice

import (
	"context"
	"os/exec"
	"testing"

	runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func TestListLoadoutRecipesCancelsDeviceObservation(t *testing.T) {
	for _, before := range []bool{true, false} {
		t.Run(map[bool]string{true: "before", false: "during"}[before], func(t *testing.T) {
			s := newTestService(t)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			oldRAM, oldLookPath := localRuntimeProbeRAM, localRuntimeLookPath
			t.Cleanup(func() { localRuntimeProbeRAM, localRuntimeLookPath = oldRAM, oldLookPath })
			ramCalls, programLookups := 0, 0
			localRuntimeProbeRAM = func() (int64, int64) {
				ramCalls++
				cancel()
				return 8 << 30, 4 << 30
			}
			localRuntimeLookPath = func(string) (string, error) { programLookups++; return "", exec.ErrNotFound }
			if before {
				cancel()
			}
			response, err := s.ListLoadoutRecipes(ctx, &runtimev1.ListLoadoutRecipesRequest{})
			if status.Code(err) != codes.Canceled || response != nil {
				t.Fatalf("cancelled recipe projection = response %v, error %v", response != nil, err)
			}
			if programLookups != 0 || before && ramCalls != 0 || !before && ramCalls != 1 {
				t.Fatalf("cancelled observation continued: RAM=%d, program lookups=%d", ramCalls, programLookups)
			}
			// Cancellation belongs to this read, never a fence on future callers.
			fresh, err := s.ListLoadoutRecipes(context.Background(), &runtimev1.ListLoadoutRecipesRequest{})
			if err != nil || len(fresh.GetRecipes()) == 0 {
				t.Fatalf("next independent projection unavailable: %v", err)
			}
		})
	}
}
